import { Router } from 'express';
import pool from '../db/pool';
import authRouter from './auth.routes';
import residentesRouter from './residentes.routes';
import accesosRouter from './accesos.routes';
import cargosRouter from './cargos.routes';
import pagosRouter from './pagos.routes';

const router = Router();

router.use('/auth', authRouter);
router.use('/residentes', residentesRouter);
router.use('/accesos', accesosRouter);
router.use('/cargos', cargosRouter);
router.use('/pagos', pagosRouter);

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