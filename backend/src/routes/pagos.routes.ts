import { Router } from 'express';
import { verifyToken } from '../middleware/auth.middleware';
import {
  getPagos, createPago, aprobarPago, rechazarPago,
  crearTransferencia, getPendientesVerificacion, getMisPagos,
} from '../controllers/pagos.controller';

const router = Router();

router.get('/pendientes-verificacion', verifyToken, getPendientesVerificacion);
router.get('/mis',                     verifyToken, getMisPagos);
router.post('/transferencia',          verifyToken, crearTransferencia);
router.get('/',                        verifyToken, getPagos);
router.post('/',                       verifyToken, createPago);
router.put('/:id/aprobar',             verifyToken, aprobarPago);
router.put('/:id/rechazar',            verifyToken, rechazarPago);

export default router;
