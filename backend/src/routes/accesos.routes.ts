import { Router } from 'express';
import { verifyToken } from '../middleware/auth.middleware';
import { registrarAcceso, registrarSalida, registrarSalidaPut, getAccesoActivo, getAccesosActivos, getMisAccesos } from '../controllers/accesos.controller';
import { auditLog } from '../middleware/audit.middleware';

const router = Router();

router.get('/activos', verifyToken, getAccesosActivos);
router.get('/activo',  verifyToken, getAccesoActivo);
router.get('/mis',     verifyToken, getMisAccesos);
router.post('/',            verifyToken, auditLog({ accion: 'REGISTRO_ENTRADA', tabla: 'registros_acceso' }), registrarAcceso);
router.patch('/:id/salida', verifyToken, registrarSalida);
router.put('/:id/salida',   verifyToken, auditLog({ accion: 'REGISTRO_SALIDA',  tabla: 'registros_acceso' }), registrarSalidaPut);

export default router;
