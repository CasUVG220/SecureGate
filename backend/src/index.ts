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
import { runMigrations } from './db/migrate';
import { APP_TZ } from './utils/reservas';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Security headers
app.use(helmet());
app.use(helmet.contentSecurityPolicy({
  directives: {
    defaultSrc: ["'self'"],
    scriptSrc:  ["'self'"],
    styleSrc:   ["'self'", "'unsafe-inline'"],
    imgSrc:     ["'self'", 'data:', 'https:'],
  },
}));

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

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'SecureGate Backend', version: '1.0.0' });
});

app.use('/api', apiRouter);

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

// Guarda de migraciones: pone el esquema al día antes de aceptar tráfico.
runMigrations().finally(() => {
  app.listen(PORT, () => {
    console.log(`SecureGate Backend corriendo en puerto ${PORT}`);
  });
});
