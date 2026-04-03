import { Router } from 'express';
import pool from '../db/pool';

const router = Router();

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
