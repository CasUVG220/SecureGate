import { Router } from 'express';
import { verifyToken } from '../middleware/auth.middleware';
import { registrarAcceso, registrarSalida, registrarSalidaPut } from '../controllers/accesos.controller';
import { registrarAcceso, registrarSalida, registrarSalidaPut, getAccesoActivo } from '../controllers/accesos.controller';

const router = Router();

router.post('/', verifyToken, registrarAcceso);
router.get('/activo',       verifyToken, getAccesoActivo);
router.post('/',            verifyToken, registrarAcceso);
router.patch('/:id/salida', verifyToken, registrarSalida);
router.put('/:id/salida',   verifyToken, registrarSalidaPut);