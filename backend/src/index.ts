import './utils/asyncErrors';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import cron from 'node-cron';
import apiRouter from './routes';
import { revisarEstadosMora } from './jobs/mora.job';
import { enviarRecordatoriosReservas } from './jobs/recordatoriosReservas.job';
import { expirarInvitaciones } from './jobs/invitaciones.job';
import { runMigrations } from './db/migrate';
import { APP_TZ } from './utils/reservas';
import { validarEntorno, trustProxyHops } from './config/env';
import { esErrorDeDatos, esConflictoUnico, soloQueryTexto } from './utils/http';
import { cabecerasApi, noEncontrado } from './middleware/hardening.middleware';

dotenv.config();

// Falla rápido y en voz alta si el entorno no es seguro (secreto JWT público o
// ausente en producción, CORS sin allowlist…). Ver config/env.ts.
try {
  validarEntorno();
} catch (err) {
  console.error(`[env] ${(err as Error).message}`);
  process.exit(1);
}

const app = express();
const PORT = process.env.PORT || 3000;

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
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  // Override sólo para pruebas de carga (RATE_LIMIT_GENERAL_MAX) — sin la env
  // var, el límite de producción sigue siendo 1000.
  max: parseInt(process.env.RATE_LIMIT_GENERAL_MAX || '1000', 10),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas solicitudes, intenta mas tarde' },
  // El health check lo consulta Docker cada pocos segundos y no debe consumir
  // el cupo de nadie.
  skip: req => req.path === '/health',
});
app.use(generalLimiter);

// Límite de cuerpo: 100 kb por defecto. Antes eran 50 MB para TODA la API y
// antes de autenticar, lo que permitía tumbar el proceso con unas pocas
// peticiones. Sólo las rutas que reciben una imagen en base64 (foto del
// documento para OCR, imagen de un área, comprobante de transferencia) tienen
// margen mayor.
const RUTAS_CON_IMAGEN = ['/api/ocr', '/api/areas', '/api/pagos/transferencia'];
const jsonPequeno = express.json({ limit: '100kb' });
const jsonConImagen = express.json({ limit: '8mb' });
app.use((req, res, next) => {
  const conImagen = RUTAS_CON_IMAGEN.some(p => req.path === p || req.path.startsWith(`${p}/`));
  return (conImagen ? jsonConImagen : jsonPequeno)(req, res, next);
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

// Revisión diaria del ciclo de mora a las 00:05
cron.schedule('5 0 * * *', () => {
  revisarEstadosMora()
    .then(r => console.log(
      `[mora.job] Revisión completada — pendiente: ${r.movidos_a_pendiente}, mora: ${r.movidos_a_mora}`
    ))
    .catch(err => console.error('[mora.job] Error en revisión de mora:', err));
});

// Recordatorios de las reservas de mañana, a las 08:00 hora local.
// El `timezone` es imprescindible: el contenedor corre en UTC, así que sin él
// esto dispararía a las 02:00 de Guatemala.
cron.schedule('0 8 * * *', () => {
  enviarRecordatoriosReservas()
    .then(r => console.log(
      `[recordatorios.job] Recordatorios: ${r.recordatorios_enviados}, completadas: ${r.reservas_completadas}`
    ))
    .catch(err => console.error('[recordatorios.job] Error en recordatorios de reservas:', err));
}, { timezone: APP_TZ });

// Invitaciones administrativas vencidas → 'expirada', a diario a las 00:15.
cron.schedule('15 0 * * *', () => {
  expirarInvitaciones()
    .then(r => console.log(`[invitaciones.job] Invitaciones expiradas: ${r.expiradas}`))
    .catch(err => console.error('[invitaciones.job] Error al expirar invitaciones:', err));
}, { timezone: APP_TZ });

// Guarda de migraciones: pone el esquema al día antes de aceptar tráfico.
// (runMigrations documenta que no lanza, pero si la base está caída al arrancar
// `pool.connect()` sí rechaza: sin este catch era una unhandledRejection.)
runMigrations()
  .catch(err => console.error('[migrate] No se pudo conectar para migrar; el backend arranca igual:', (err as Error).message))
  .finally(() => {
    app.listen(PORT, () => {
      console.log(`SecureGate Backend corriendo en puerto ${PORT}`);
    });
  });
