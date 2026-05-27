import { Router, Request, Response } from 'express';
import pool from '../db/pool';

const router = Router();

// GET /api/visitantes?dpi=X — used by blacklist modal
router.get('/', async (req: Request, res: Response) => {
  const { dpi } = req.query as { dpi?: string };
  if (!dpi || dpi.trim().length < 3) {
    return res.status(400).json({ error: 'Parámetro dpi requerido (mínimo 3 caracteres)' });
  }
  try {
    const result = await pool.query(
      `SELECT id, nombre, numero_dpi FROM visitantes
       WHERE numero_dpi ILIKE $1
       LIMIT 10`,
      [`%${dpi.trim()}%`]
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: 'Error al buscar visitantes', detail: String(error) });
  }
});

// GET /api/visitantes/buscar?q=TEXT&residente_id=UUID — used by garita autocomplete
router.get('/buscar', async (req: Request, res: Response) => {
  const { q, residente_id } = req.query as { q?: string; residente_id?: string };
  if (!q || q.trim().length < 4) {
    return res.json([]);
  }
  const pattern = `%${q.trim()}%`;
  const params: unknown[] = [pattern, pattern];
  let residenteJoin = '';

  if (residente_id) {
    residenteJoin = `AND EXISTS (
      SELECT 1 FROM registros_acceso ra2
      WHERE ra2.visitante_id = v.id AND ra2.residente_id = $${params.length + 1}
    )`;
    params.push(residente_id);
  }

  try {
    const result = await pool.query(
      `SELECT
         v.id,
         v.nombre,
         v.numero_dpi,
         veh.placa,
         MAX(ra.timestamp_entrada) AS ultima_visita
       FROM visitantes v
       LEFT JOIN LATERAL (
         SELECT placa FROM vehiculos WHERE visitante_id = v.id ORDER BY created_at DESC LIMIT 1
       ) veh ON TRUE
       LEFT JOIN registros_acceso ra ON ra.visitante_id = v.id
       WHERE (v.nombre ILIKE $1 OR v.numero_dpi ILIKE $2)
         ${residenteJoin}
       GROUP BY v.id, v.nombre, v.numero_dpi, veh.placa
       ORDER BY MAX(ra.timestamp_entrada) DESC NULLS LAST
       LIMIT 5`,
      params
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: 'Error al buscar visitantes', detail: String(error) });
  }
});

export default router;
