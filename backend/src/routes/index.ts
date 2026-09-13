import { Router } from 'express';
import pool from '../db/pool';
import rateLimit from 'express-rate-limit';
import authRouter from './auth.routes';
import residentesRouter from './residentes.routes';
import accesosRouter from './accesos.routes';
import cargosRouter from './cargos.routes';
import pagosRouter from './pagos.routes';
import preautorizacionesRouter from './preautorizaciones.routes';
import invitacionesQrRouter from './invitacionesQr.routes';
import configQrRouter from './configQr.routes';
import ocrRouter from './ocr.routes';
import reportesRouter from './reportes.routes';
import configuracionCargosRouter from './configuracion-cargos.routes';
import empresasRouter from './empresas.routes';
import sucursalesRouter from './sucursales.routes';
import usuariosRouter from './usuarios.routes';
import blacklistRouter from './blacklist.routes';
import visitantesRouter from './visitantes.routes';
import cargosProgramadosRouter from './cargos-programados.routes';
import anunciosRouter from './anuncios.routes';
import ticketsRouter from './tickets.routes';
import areasRouter from './areas.routes';
import reservasRouter from './reservas.routes';
import configReservasRouter from './config-reservas.routes';
import { verifyToken, requireOwner, requireAdminEmpresa, requireAdminSucursal } from '../middleware/auth.middleware';
import { getDashboard } from '../controllers/dashboard.controller';
import { getAuditLogs } from '../controllers/audit.controller';
import { revisarEstadosMora } from '../jobs/mora.job';
import { enviarRecordatoriosReservas } from '../jobs/recordatoriosReservas.job';

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  // Override sólo para pruebas de carga (RATE_LIMIT_LOGIN_MAX) — sin la env
  // var, el límite de producción sigue siendo 10.
  max: parseInt(process.env.RATE_LIMIT_LOGIN_MAX || '10', 10),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados intentos de login' },
});

const router = Router();

router.use('/auth', loginLimiter, authRouter);
router.use('/empresas',   verifyToken, empresasRouter);
router.use('/sucursales', verifyToken, requireAdminEmpresa,    sucursalesRouter);
// El guard de administración va ruta por ruta: /usuarios/me/preferencias lo
// usa cualquier usuario para guardar su tema e idioma.
router.use('/usuarios',   verifyToken, usuariosRouter);
router.use('/residentes', residentesRouter);
router.use('/accesos', accesosRouter);
router.use('/cargos', cargosRouter);
router.use('/pagos', pagosRouter);
router.use('/preautorizaciones', preautorizacionesRouter);
router.use('/ocr', ocrRouter);
router.use('/reportes', reportesRouter);
router.use('/configuracion-cargos', configuracionCargosRouter);

router.use('/blacklist',          verifyToken, blacklistRouter);
router.use('/visitantes',         verifyToken, visitantesRouter);
router.use('/cargos-programados', verifyToken, cargosProgramadosRouter);
router.use('/anuncios',           verifyToken, anunciosRouter);
router.use('/tickets',            verifyToken, ticketsRouter);
router.use('/areas',              verifyToken, areasRouter);
router.use('/reservas',           verifyToken, reservasRouter);
router.use('/config-reservas',    verifyToken, configReservasRouter);
router.use('/invitaciones-qr',    verifyToken, invitacionesQrRouter);
router.use('/config-qr',          configQrRouter);

router.get('/dashboard',   verifyToken, getDashboard);
router.get('/audit-logs', verifyToken, requireOwner, getAuditLogs);

// Dispara manualmente la revisión del ciclo de mora (demo/testing)
router.post('/admin/ejecutar-revision-mora', verifyToken, requireOwner, async (_req, res) => {
  try {
    const resumen = await revisarEstadosMora();
    res.json({ ejecutado: true, ...resumen });
  } catch (error) {
    res.status(500).json({ error: 'Error al ejecutar revisión de mora', detail: String(error) });
  }
});

// Dispara manualmente los recordatorios de reservas (demo/testing)
router.post('/admin/ejecutar-recordatorios-reservas', verifyToken, requireOwner, async (_req, res) => {
  try {
    const resumen = await enviarRecordatoriosReservas();
    res.json({ ejecutado: true, ...resumen });
  } catch (error) {
    res.status(500).json({ error: 'Error al ejecutar recordatorios de reservas', detail: String(error) });
  }
});

router.get('/status', async (req, res) => {
  try {
    const result = await pool.query('SELECT NOW() as tiempo, current_database() as base_datos');
    res.json({
      backend: 'conectado',
      base_datos: 'conectada',
      info: result.rows[0],
    });
  } catch (error) {
    res.status(500).json({ backend: 'conectado', base_datos: 'error', error: String(error) });
  }
});

export default router;