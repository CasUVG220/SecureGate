import { Router } from 'express';
import { reporteAccesos, reportePagos } from '../controllers/reportes.controller';
import { getEstadisticas } from '../controllers/estadisticas.controller';
import { verifyToken } from '../middleware/auth.middleware';
import { auditLog } from '../middleware/audit.middleware';

const router = Router();

// Los CSV traen DPI, nombre y placa de todos los visitantes: descargarlos es una acción sensible aunque sea una lectura.
router.get('/accesos',      verifyToken, auditLog({ accion: 'REPORTE_ACCESOS_EXPORTADO', tabla: 'registros_acceso' }), reporteAccesos);
router.get('/pagos',        verifyToken, auditLog({ accion: 'REPORTE_PAGOS_EXPORTADO', tabla: 'pagos' }), reportePagos);
router.get('/estadisticas', verifyToken, getEstadisticas);

export default router;
