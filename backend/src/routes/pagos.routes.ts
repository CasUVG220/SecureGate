import { Router } from 'express';
import { verifyToken } from '../middleware/auth.middleware';
import {
  getPagos, createPago, aprobarPago, rechazarPago,
  crearTransferencia, getPendientesVerificacion, getMisPagos, getMiResumenMes,
} from '../controllers/pagos.controller';
import { auditLog } from '../middleware/audit.middleware';

const router = Router();

router.get('/pendientes-verificacion', verifyToken, getPendientesVerificacion);
router.get('/mis',                     verifyToken, getMisPagos);
router.get('/mi-resumen',              verifyToken, getMiResumenMes);
router.post('/transferencia',          verifyToken, crearTransferencia);
router.get('/',                        verifyToken, getPagos);
router.post('/',                       verifyToken, auditLog({ accion: 'PAGO_EFECTIVO',  tabla: 'pagos' }), createPago);
router.put('/:id/aprobar',             verifyToken, auditLog({ accion: 'PAGO_APROBADO',  tabla: 'pagos' }), aprobarPago);
router.put('/:id/rechazar',            verifyToken, auditLog({ accion: 'PAGO_RECHAZADO', tabla: 'pagos' }), rechazarPago);

export default router;
