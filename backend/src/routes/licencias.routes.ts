import { Router } from 'express';
import { body } from 'express-validator';
import { verifyToken, requireAdminSucursal } from '../middleware/auth.middleware';
import { validateRequest } from '../middleware/validate.middleware';
import { auditLog } from '../middleware/audit.middleware';
import { crearLimitador } from '../middleware/limitadores';
import {
  crearLicencia, getLicencias, revocarLicencia, activarLicencia, heartbeatLicencia,
} from '../controllers/licencias.controller';

const router = Router();

// Activación: sin sesión (la app todavía no tiene agente). Límite estricto por
// IP para que no sirva para adivinar códigos.
const activarLimiter = crearLimitador({
  nombre: 'activar-licencia-ip',
  windowMs: 15 * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_ACTIVAR_MAX || '10', 10),
  accion: 'LICENCIA_ACTIVADA',
  tabla: 'licencias_dispositivo',
  mensaje: 'Demasiados intentos de activación',
});

router.post(
  '/activar',
  activarLimiter,
  auditLog({ accion: 'LICENCIA_ACTIVADA', tabla: 'licencias_dispositivo' }),
  body('codigo').isString().isLength({ min: 8, max: 40 }),
  body('fingerprint').isString().isLength({ min: 32, max: 128 }),
  body('nombre_dispositivo').optional({ nullable: true, checkFalsy: true }).isString().isLength({ max: 100 }),
  validateRequest,
  activarLicencia,
);
// El heartbeat se autentica con el token de licencia; el límite por IP evita que
// se use para sondear tokens (1 cada 15 min por equipo en uso normal).
const heartbeatLimiter = crearLimitador({
  nombre: 'heartbeat-ip',
  windowMs: 15 * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_HEARTBEAT_MAX || '60', 10),
  accion: 'LICENCIA_HEARTBEAT',
  tabla: 'licencias_dispositivo',
  mensaje: 'Demasiados heartbeats',
});
router.post('/heartbeat', heartbeatLimiter, heartbeatLicencia);

// Administración (emitir / listar / revocar).
router.get('/',  verifyToken, requireAdminSucursal, getLicencias);
router.post('/', verifyToken, requireAdminSucursal,
  auditLog({ accion: 'LICENCIA_EMITIDA', tabla: 'licencias_dispositivo' }), crearLicencia);
router.patch('/:id/revocar', verifyToken, requireAdminSucursal,
  auditLog({ accion: 'LICENCIA_REVOCADA', tabla: 'licencias_dispositivo' }), revocarLicencia);

export default router;
