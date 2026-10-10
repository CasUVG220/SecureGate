import { Router } from 'express';
import pool from '../db/pool';
import { auditLog } from '../middleware/audit.middleware';
import { crearLimitador } from '../middleware/limitadores';
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
import licenciasRouter from './licencias.routes';
import syncRouter from './sync.routes';
import invitacionesRouter from './invitaciones.routes';
import { verifyToken, requireOwner, requireAdminEmpresa, requireAdminSucursal, requireStaff } from '../middleware/auth.middleware';
import { getDashboard } from '../controllers/dashboard.controller';
import { getAuditLogs, getAuditAcciones } from '../controllers/audit.controller';
import { revisarEstadosMora } from '../jobs/mora.job';
import { enviarRecordatoriosReservas } from '../jobs/recordatoriosReservas.job';
import { expirarInvitaciones } from '../jobs/invitaciones.job';
import { serverError } from '../utils/http';

const router = Router();

// Los límites de intentos viven en auth.routes.ts (por IP y por cuenta).
router.use('/auth', authRouter);
router.use('/empresas',   verifyToken, empresasRouter);
router.use('/sucursales', verifyToken, requireAdminEmpresa,    sucursalesRouter);
// El guard de administración va ruta por ruta: /usuarios/me/preferencias lo
// usa cualquier usuario para guardar su tema e idioma.
router.use('/usuarios',   verifyToken, usuariosRouter);
// residentes/accesos/preautorizaciones/pagos aplican verifyToken y su guard de
// rol ruta por ruta (hay rutas /me y /mis abiertas al residente).
router.use('/residentes', residentesRouter);
router.use('/accesos', accesosRouter);
// Configuración de cargos por sucursal: sólo administración. Antes /cargos no
// tenía NINGÚN middleware de autenticación.
router.use('/cargos', verifyToken, requireAdminSucursal, cargosRouter);
router.use('/pagos', pagosRouter);
router.use('/preautorizaciones', preautorizacionesRouter);
// Proxy hacia Google Vision con nuestra API key: sólo personal autenticado y
// con límite propio (cuesta dinero por llamada). Antes era anónimo.
const ocrLimiter = crearLimitador({
  nombre: 'ocr-usuario',
  windowMs: 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_OCR_MAX || '30', 10),
  // Por usuario (antes por IP): varios agentes detrás del mismo NAT no se agotan el cupo entre sí. Los bloqueos quedan auditados.
  porUsuario: true,
  accion: 'OCR_ESCANEO',
  mensaje: 'Demasiadas lecturas de documento, espera un momento',
});
router.use('/ocr', verifyToken, requireStaff, ocrLimiter, ocrRouter);
// Los CSV traen DPI y nombre de todos los visitantes: administración.
router.use('/reportes', verifyToken, requireAdminSucursal, reportesRouter);
router.use('/configuracion-cargos', verifyToken, requireAdminSucursal, configuracionCargosRouter);

router.use('/blacklist',          verifyToken, blacklistRouter);
router.use('/visitantes',         verifyToken, requireStaff, visitantesRouter);
router.use('/cargos-programados', verifyToken, requireAdminSucursal, cargosProgramadosRouter);
router.use('/anuncios',           verifyToken, anunciosRouter);
router.use('/tickets',            verifyToken, ticketsRouter);
router.use('/areas',              verifyToken, areasRouter);
router.use('/reservas',           verifyToken, reservasRouter);
router.use('/config-reservas',    verifyToken, configReservasRouter);
router.use('/invitaciones-qr',    verifyToken, invitacionesQrRouter);
router.use('/config-qr',          configQrRouter);
// App de escritorio (Sprint 8): licencias por dispositivo y espejo offline.
router.use('/licencias',          licenciasRouter);
router.use('/sync',               syncRouter);
// Aprovisionamiento en cascada (owner → admin_empresa → admin_sucursal). Va
// sin verifyToken global: GET /:token y POST /:token/aceptar son públicos.
router.use('/invitaciones',       invitacionesRouter);

router.get('/dashboard',   verifyToken, requireStaff, getDashboard);
router.get('/audit-logs/acciones', verifyToken, requireOwner, getAuditAcciones);
router.get('/audit-logs', verifyToken, requireOwner, getAuditLogs);

// Dispara manualmente la revisión del ciclo de mora (demo/testing)
router.post('/admin/ejecutar-revision-mora', verifyToken, requireOwner, auditLog({ accion: 'JOB_MORA_EJECUTADO' }), async (_req, res) => {
  try {
    const resumen = await revisarEstadosMora();
    res.json({ ejecutado: true, ...resumen });
  } catch (error) {
    serverError(res, error, 'Error al ejecutar revisión de mora');
  }
});

// Dispara manualmente los recordatorios de reservas (demo/testing)
router.post('/admin/ejecutar-recordatorios-reservas', verifyToken, requireOwner, auditLog({ accion: 'JOB_RECORDATORIOS_EJECUTADO' }), async (_req, res) => {
  try {
    const resumen = await enviarRecordatoriosReservas();
    res.json({ ejecutado: true, ...resumen });
  } catch (error) {
    serverError(res, error, 'Error al ejecutar recordatorios de reservas');
  }
});

// Dispara manualmente la expiración de invitaciones (demo/testing)
router.post('/admin/ejecutar-expiracion-invitaciones', verifyToken, requireOwner, auditLog({ accion: 'JOB_INVITACIONES_EJECUTADO' }), async (_req, res) => {
  try {
    const resumen = await expirarInvitaciones();
    res.json({ ejecutado: true, ...resumen });
  } catch (error) {
    serverError(res, error, 'Error al expirar invitaciones');
  }
});

// Público a propósito (monitoreo), pero sin filtrar nada de la base: antes
// devolvía el nombre de la base y el texto crudo del error.
router.get('/status', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ backend: 'conectado', base_datos: 'conectada' });
  } catch {
    res.status(503).json({ backend: 'conectado', base_datos: 'error' });
  }
});

export default router;