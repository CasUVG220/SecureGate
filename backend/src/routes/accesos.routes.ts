import { Router } from 'express';
import { verifyToken } from '../middleware/auth.middleware';
import { registrarAcceso } from '../controllers/accesos.controller';

const router = Router();

router.post('/', verifyToken, registrarAcceso);

export default router;
