import { Router } from 'express';
import { verifyToken, requireAdminSucursal } from '../middleware/auth.middleware';
import {
  getPagos, createPago, aprobarPago, rechazarPago,
  crearTransferencia, getPendientesVerificacion, getMisPagos, getMiResumenMes,
  pagarConTarjeta,
} from '../controllers/pagos.controller';
import { auditLog } from '../middleware/audit.middleware';

const router = Router();

router.get('/pendientes-verificacion', verifyToken, requireAdminSucursal, getPendientesVerificacion);
router.get('/mis',                     verifyToken, getMisPagos);
router.get('/mi-resumen',              verifyToken, getMiResumenMes);
router.post('/transferencia',          verifyToken, crearTransferencia);
router.post('/tarjeta',                verifyToken, auditLog({ accion: 'PAGO_TARJETA_SIMULADO', tabla: 'pagos' }), pagarConTarjeta);
// Listado de toda la sucursal: es de administración. El residente consulta lo
// suyo por /mis y /mi-resumen, que sí filtran por su propio residente_id.
router.get('/',                        verifyToken, requireAdminSucursal, getPagos);
router.post('/',                       verifyToken, requireAdminSucursal, auditLog({ accion: 'PAGO_EFECTIVO',  tabla: 'pagos' }), createPago);
router.put('/:id/aprobar',             verifyToken, requireAdminSucursal, auditLog({ accion: 'PAGO_APROBADO',  tabla: 'pagos' }), aprobarPago);
router.put('/:id/rechazar',            verifyToken, requireAdminSucursal, auditLog({ accion: 'PAGO_RECHAZADO', tabla: 'pagos' }), rechazarPago);

export default router;
