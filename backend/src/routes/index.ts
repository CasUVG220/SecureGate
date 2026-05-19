import { Router } from 'express';
import pool from '../db/pool';
import rateLimit from 'express-rate-limit';
import authRouter from './auth.routes';
import residentesRouter from './residentes.routes';
import accesosRouter from './accesos.routes';
import cargosRouter from './cargos.routes';
import pagosRouter from './pagos.routes';
import preautorizacionesRouter from './preautorizaciones.routes';
import ocrRouter from './ocr.routes';
import reportesRouter from './reportes.routes';
import configuracionCargosRouter from './configuracion-cargos.routes';
import empresasRouter from './empresas.routes';
import sucursalesRouter from './sucursales.routes';
import usuariosRouter from './usuarios.routes';
import { verifyToken, requireOwner, requireAdminEmpresa, requireAdminSucursal } from '../middleware/auth.middleware';
import { getDashboard } from '../controllers/dashboard.controller';

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados intentos de login' },
});

const router = Router();

router.use('/auth', loginLimiter, authRouter);
router.use('/empresas',   verifyToken, empresasRouter);
router.use('/sucursales', verifyToken, requireAdminEmpresa,    sucursalesRouter);
router.use('/usuarios',   verifyToken, requireAdminSucursal,   usuariosRouter);
router.use('/residentes', residentesRouter);
router.use('/accesos', accesosRouter);
router.use('/cargos', cargosRouter);
router.use('/pagos', pagosRouter);
router.use('/preautorizaciones', preautorizacionesRouter);
router.use('/ocr', ocrRouter);
router.use('/reportes', reportesRouter);
router.use('/configuracion-cargos', configuracionCargosRouter);

router.get('/dashboard', verifyToken, getDashboard);

router.get('/status', async (req, res) => {
  try {
    const result = await pool.query('SELECT NOW() as tiempo, current_database() as base_datos');
    res.json({
      backend: 'conectado',
      base_datos: 'conectada',
      info: result.rows[0],
    });
  } catch (error) {
    res.status(500).json({ backend: 'conectado', base_datos: 'error', error: String(error) });
  }
});

export default router;