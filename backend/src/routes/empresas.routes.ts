import { Router } from 'express';
import * as ctrl from '../controllers/empresas.controller';
import * as planes from '../controllers/planes.controller';
import { requireOwner, requireAdminEmpresa } from '../middleware/auth.middleware';
import { auditLog } from '../middleware/audit.middleware';
import { crearLimitador } from '../middleware/limitadores';

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
export const eliminarLimiter = crearLimitador({
  nombre: 'eliminar-empresa-usuario',
  windowMs: 15 * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_ELIMINAR_MAX || '5', 10),
  porUsuario: true,
  accion: 'EMPRESA_ELIMINADA_DEFINITIVO',
  tabla: 'empresas',
  mensaje: 'Demasiados intentos; espera 15 minutos',
});
router.post('/:id/eliminar-definitivo', requireOwner, eliminarLimiter,
  auditLog({ accion: 'EMPRESA_ELIMINADA_DEFINITIVO', tabla: 'empresas' }), ctrl.eliminarEmpresaDefinitivo);
// Suscripción al plan SaaS y consumo (T10). El admin de empresa solo ve la suya; cambiarla es del owner.
router.get('/:id/suscripcion',           requireAdminEmpresa, planes.getSuscripcion);
router.get('/:id/suscripcion/historial', requireAdminEmpresa, planes.getHistorialSuscripcion);
router.get('/:id/uso',                   requireAdminEmpresa, planes.getUsoEmpresa);
router.put('/:id/suscripcion',           requireOwner,        auditLog({ accion: 'SUSCRIPCION_ACTUALIZADA', tabla: 'suscripciones' }), planes.putSuscripcion);
router.patch('/:id/reactivar', requireOwner,       auditLog({ accion: 'EMPRESA_REACTIVADA', tabla: 'empresas' }), ctrl.reactivarEmpresa);

export default router;
