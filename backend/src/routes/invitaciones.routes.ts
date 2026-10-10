import { Router } from 'express';
import { body } from 'express-validator';
import { verifyToken, requireAdminEmpresa } from '../middleware/auth.middleware';
import { validateRequest } from '../middleware/validate.middleware';
import { auditLog } from '../middleware/audit.middleware';
import { crearLimitador } from '../middleware/limitadores';
import {
  crearInvitacion, getInvitaciones, getInvitacionPorToken, aceptarInvitacion,
  revocarInvitacion, reenviarInvitacion,
} from '../controllers/invitaciones.controller';

const router = Router();

// Endpoints públicos (el invitado aún no tiene cuenta). El token tiene 256
// bits, así que el límite no es contra fuerza bruta sino contra abuso.
const publicoLimiter = crearLimitador({
  nombre: 'invitacion-publica-ip',
  windowMs: 15 * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_INVITACION_MAX || '30', 10),
  accion: 'INVITACION_ACEPTADA',
  tabla: 'invitaciones',
  mensaje: 'Demasiados intentos',
});

// Administración. El guard fino (owner para admin_empresa, admin_empresa
// para admin_sucursal) lo aplica el controller según a quién se invita.
router.get('/',  verifyToken, requireAdminEmpresa, getInvitaciones);
router.post('/', verifyToken, requireAdminEmpresa,
  body('email').isEmail(),
  body('rol_invitado').isIn(['admin_empresa', 'admin_sucursal']),
  body('empresa_id').optional({ nullable: true, checkFalsy: true }).isUUID(),
  body('sucursal_id').optional({ nullable: true, checkFalsy: true }).isUUID(),
  body('empresa_nombre').optional({ nullable: true, checkFalsy: true }).isString().isLength({ min: 2, max: 150 }),
  validateRequest,
  auditLog({ accion: 'INVITACION_CREADA', tabla: 'invitaciones' }),
  crearInvitacion,
);
router.patch('/:id/revocar', verifyToken, requireAdminEmpresa,
  auditLog({ accion: 'INVITACION_REVOCADA', tabla: 'invitaciones' }), revocarInvitacion);
router.post('/:id/reenviar', verifyToken, requireAdminEmpresa,
  auditLog({ accion: 'INVITACION_REENVIADA', tabla: 'invitaciones' }), reenviarInvitacion);

// Públicos.
router.get('/:token', publicoLimiter, getInvitacionPorToken);
router.post('/:token/aceptar', publicoLimiter,
  body('nombre').isString().isLength({ min: 2, max: 100 }),
  body('password').isString().isLength({ min: 8, max: 72 }),
  validateRequest,
  auditLog({ accion: 'INVITACION_ACEPTADA', tabla: 'invitaciones' }),
  aceptarInvitacion,
);

export default router;
