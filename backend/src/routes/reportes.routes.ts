import { Router } from 'express';
import { reporteAccesos, reportePagos } from '../controllers/reportes.controller';
import { getEstadisticas } from '../controllers/estadisticas.controller';
import { verifyToken } from '../middleware/auth.middleware';

const router = Router();

router.get('/accesos',      verifyToken, reporteAccesos);
router.get('/pagos',        verifyToken, reportePagos);
router.get('/estadisticas', verifyToken, getEstadisticas);

export default router;
