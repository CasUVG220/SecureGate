import { Router } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import * as ctrl from '../controllers/empresas.controller';
import { requireOwner, requireAdminEmpresa } from '../middleware/auth.middleware';
import { auditLog, registrarAuditoria } from '../middleware/audit.middleware';

const router = Router();

router.get('/',               requireOwner,        ctrl.getEmpresas);
router.post('/',              requireOwner,        auditLog({ accion: 'EMPRESA_CREADA',   tabla: 'empresas' }), ctrl.createEmpresa);
router.get('/:id/stats',      requireAdminEmpresa, ctrl.getEmpresaStats);
router.put('/:id',            requireOwner,        auditLog({ accion: 'EMPRESA_ACTUALIZADA', tabla: 'empresas' }), ctrl.updateEmpresa);
router.delete('/:id',         requireOwner,        auditLog({ accion: 'EMPRESA_ELIMINADA', tabla: 'empresas' }), ctrl.deleteEmpresa);
router.post('/:id/admin',     requireOwner,        auditLog({ accion: 'ADMIN_EMPRESA_ASIGNADO', tabla: 'usuarios' }), ctrl.assignAdminEmpresa);
// Suspensión de operaciones (reversible): impago, incumplimiento, etc.
router.patch('/:id/suspender', requireOwner,       auditLog({ accion: 'EMPRESA_SUSPENDIDA', tabla: 'empresas' }), ctrl.suspenderEmpresa);
// Borrado físico con contraseña del owner. Límite estricto: la contraseña
// se comprueba aquí y no debe poder adivinarse a fuerza bruta.
//
// El cupo es POR USUARIO (el owner del JWT), no por IP (hallazgo S-07 de
// backend/securitytest): con un JWT de owner robado, un límite por IP permitía
// 5 intentos de contraseña por CADA IP distinta, y a la vez un tercero desde la
// IP del owner le agotaba el cupo. Los intentos bloqueados (429) también quedan
// en audit_logs: antes el limitador corría antes de auditLog y quien insistía
// tras el bloqueo no dejaba rastro.
export const eliminarLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_ELIMINAR_MAX || '5', 10),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: req => `owner:${req.user?.id ?? ipKeyGenerator(req.ip ?? '')}`,
  handler: (req, res) => {
    registrarAuditoria(req, { accion: 'EMPRESA_ELIMINADA_DEFINITIVO', tabla: 'empresas' }, 429);
    res.status(429).json({ error: 'Demasiados intentos; espera 15 minutos' });
  },
});
router.post('/:id/eliminar-definitivo', requireOwner, eliminarLimiter,
  auditLog({ accion: 'EMPRESA_ELIMINADA_DEFINITIVO', tabla: 'empresas' }), ctrl.eliminarEmpresaDefinitivo);
router.patch('/:id/reactivar', requireOwner,       auditLog({ accion: 'EMPRESA_REACTIVADA', tabla: 'empresas' }), ctrl.reactivarEmpresa);

export default router;
