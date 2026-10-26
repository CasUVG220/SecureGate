import './utils/asyncErrors';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import helmet from 'helmet';
import { crearLimitador } from './middleware/limitadores';
import apiRouter from './routes';
import { trustProxyHops } from './config/env';
import { esErrorDeDatos, esConflictoUnico, soloQueryTexto } from './utils/http';
import { cabecerasApi, noEncontrado } from './middleware/hardening.middleware';

dotenv.config();

/**
 * Aplicación Express SIN efectos de arranque: no escucha en un puerto, no
 * programa cron, no migra la base y no llama a process.exit. index.ts es el
 * punto de entrada que hace todo eso; las pruebas de integración importan esta
 * app directamente (supertest). La validación del entorno (JWT_SECRET, etc.)
 * vive en config/arranque.ts y la corre index.ts antes de importar este módulo.
 */
const app = express();
// `req.ip` (rate limit y auditoría) sólo confía en X-Forwarded-For si se declara
// cuántos proxies hay delante. Sin esto, cualquier cliente podía falsificar su
// IP con esa cabecera. Detrás de nginx: TRUST_PROXY=1.
app.set('trust proxy', trustProxyHops());

// Security headers. Una sola llamada: la API sólo devuelve JSON, así que el CSP
// puede ser el más restrictivo posible.
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc:     ["'none'"],
      frameAncestors: ["'none'"],
    },
  },
  crossOriginResourcePolicy: { policy: 'same-site' },
}));

app.use(cabecerasApi);

// CORS — credentials required for httpOnly refresh-token cookie.
//
// En produccion la allowlist es obligatoria (ALLOWED_ORIGINS). En desarrollo
// se refleja el origen del navegador: el frontend se sirve desde el mismo
// host que el backend (localhost o la IP de la VM de turno) y esa IP no se
// conoce de antemano, asi que fijarla obligaria a editar el compose en cada
// servidor nuevo.
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ?.split(',')
  .map(o => o.trim())
  .filter(Boolean);
const isProduction = process.env.NODE_ENV === 'production';

app.use(cors({
  origin: (origin, callback) => {
    // Peticiones sin Origin (curl, health checks, same-origin) siempre pasan.
    if (!origin) return callback(null, true);
    if (allowedOrigins?.length) return callback(null, allowedOrigins.includes(origin));
    return callback(null, !isProduction);
  },
  credentials: true,
}));

app.use(cookieParser());

/**
 * Límite general de peticiones.
 *
 * El tope anterior (100 por 15 minutos) estaba por debajo del uso normal: una
 * sesión de administración que recorre el sidebar completo gasta ~75 peticiones
 * en un par de minutos, y a partir de ahí el API devolvía 429 y las pantallas
 * mostraban "No se pudo cargar…" de forma intermitente. Como el contador es por
 * IP, varias personas de la misma administración (o detrás del mismo NAT)
 * comparten el cupo y lo agotaban todavía más rápido.
 *
 * 1000 por 15 minutos sigue frenando el scraping automatizado sin castigar a un
 * equipo trabajando. El límite estricto de credenciales sigue aparte, en
 * /api/auth (ver loginLimiter en routes/index.ts).
 */
const generalLimiter = crearLimitador({
  nombre: 'general-ip',
  windowMs: 15 * 60 * 1000,
  // Override sólo para pruebas de carga (RATE_LIMIT_GENERAL_MAX) — sin la env
  // var, el límite de producción sigue siendo 1000.
  max: parseInt(process.env.RATE_LIMIT_GENERAL_MAX || '1000', 10),
  mensaje: 'Demasiadas solicitudes, intenta mas tarde',
  // Los intentos bloqueados quedan auditados (RNF-10), pero una fila por IP y minuto: este límite es anónimo y lo ve
  // cualquiera, y una inundación no debe convertirse en una inundación de escrituras en la base.
  accion: 'LIMITE_TASA_GENERAL',
  coalescerAuditoriaMs: 60_000,
  // El health check lo consulta Docker cada pocos segundos y no debe consumir
  // el cupo de nadie.
  skip: req => req.path === '/health',
});
app.use(generalLimiter);

// Límite de cuerpo: 100 kb por defecto. Antes eran 50 MB para TODA la API y
// antes de autenticar, lo que permitía tumbar el proceso con unas pocas
// peticiones. Sólo las rutas que reciben una imagen en base64 (imagen de un
// área, comprobante de transferencia) tienen margen mayor. Las fotos de los
// documentos no llegan al servidor: el OCR es local en la garita.
const RUTAS_CON_IMAGEN = ['/api/areas', '/api/pagos/transferencia'];
const jsonPequeno = express.json({ limit: '100kb' });
const jsonConImagen = express.json({ limit: '8mb' });
// Logo de empresa: una imagen de hasta 200 KB en base64 (~270 KB de texto). Margen propio, mucho menor que el de las fotos.
const jsonConLogo = express.json({ limit: '400kb' });
// Evidencia del ANPR (Sprint 10): un JPEG de hasta 256 KB en base64 (~342 KB de texto). Mismo margen que el logo.
const RUTA_EVIDENCIA_ANPR = '/api/anpr/evidencias';
app.use((req, res, next) => {
  const conImagen = RUTAS_CON_IMAGEN.some(p => req.path === p || req.path.startsWith(`${p}/`));
  const conLogo = req.path === '/api/empresas' || /^\/api\/empresas\/[^/]+$/.test(req.path) || req.path === RUTA_EVIDENCIA_ANPR;
  return (conImagen ? jsonConImagen : conLogo ? jsonConLogo : jsonPequeno)(req, res, next);
});
app.use(express.urlencoded({ limit: '100kb', extended: false }));

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'SecureGate Backend', version: '1.0.0' });
});

app.use('/api', soloQueryTexto, apiRouter);

app.use(noEncontrado);

// Manejador central de errores: nunca devuelve el stack ni mensajes internos.
app.use((err: Error & { type?: string; status?: number }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'El cuerpo de la petición es demasiado grande' });
  if (err.type === 'entity.parse.failed' || err instanceof SyntaxError) return res.status(400).json({ error: 'JSON inválido' });
  // UUID/fecha mal formado, texto demasiado largo, byte NUL, CHECK/FK/NOT NULL…:
  // datos inválidos del cliente, no un fallo del servidor (ver utils/http.ts).
  const codigoPg = (err as { code?: string }).code;
  if (esConflictoUnico(codigoPg)) return res.status(409).json({ error: 'Ya existe un registro con esos datos' });
  if (esErrorDeDatos(codigoPg)) return res.status(400).json({ error: 'Identificador o valor con formato inválido' });
  console.error('[error] excepción no controlada', { message: err.message });
  res.status(err.status && err.status >= 400 && err.status < 500 ? err.status : 500)
    .json({ error: 'Error en el servidor' });
});

export default app;
