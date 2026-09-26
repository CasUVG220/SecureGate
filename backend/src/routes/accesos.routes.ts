import { Router } from 'express';
import { verifyToken, requireStaff } from '../middleware/auth.middleware';
import { registrarAcceso, registrarSalida, registrarSalidaPut, getAccesoActivo, getAccesosActivos, getMisAccesos } from '../controllers/accesos.controller';
import { auditLog } from '../middleware/audit.middleware';
import { licenciaOpcional } from '../middleware/licencia.middleware';

const router = Router();

router.get('/activos', verifyToken, requireStaff, getAccesosActivos);
router.get('/activo',  verifyToken, requireStaff, getAccesoActivo);
router.get('/mis',     verifyToken, getMisAccesos);
// licenciaOpcional: la app de escritorio manda X-Licencia-Token (y una licencia
// revocada rechaza el registro); la web no lo manda y sigue igual.
// requireStaff: un residente no registra entradas (antes bastaba con estar autenticado).
router.post('/',            verifyToken, requireStaff, licenciaOpcional, auditLog({ accion: 'REGISTRO_ENTRADA', tabla: 'registros_acceso' }), registrarAcceso);
router.patch('/:id/salida', verifyToken, requireStaff, auditLog({ accion: 'REGISTRO_SALIDA', tabla: 'registros_acceso' }), registrarSalida);
router.put('/:id/salida',   verifyToken, requireStaff, auditLog({ accion: 'REGISTRO_SALIDA',  tabla: 'registros_acceso' }), registrarSalidaPut);

export default router;
