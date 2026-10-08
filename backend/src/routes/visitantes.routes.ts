import { Router, Request, Response } from 'express';
import pool from '../db/pool';
import { tenantFilter } from '../utils/tenant';
import { serverError, esUuid } from '../utils/http';
import { normalizarPlaca, sqlPlacaNormalizada } from '../utils/placa';

const router = Router();

/** Escapa % _ \ para que un patrón ILIKE del usuario no sea un comodín. */
const escapeLike = (s: string): string => s.replace(/[\\%_]/g, m => `\\${m}`);

/**
 * `visitantes` es una tabla GLOBAL (un DPI = una fila para todos los
 * condominios). Por eso estas búsquedas sólo devuelven visitantes que ya
 * pasaron por el alcance de quien consulta (su sucursal o, para admin de
 * empresa, las de su empresa). Antes cualquier usuario autenticado enumeraba
 * los DPI de todos los tenants con tres caracteres.
 *
 * El acceso ya está restringido a personal en el montaje (routes/index.ts).
 */

// GET /api/visitantes?dpi=X  |  GET /api/visitantes?placa=X — usado por el modal de blacklist
// («Buscar visitante por DPI o placa»). La placa se compara normalizada (sin guiones ni
// espacios, en mayúsculas) contra los vehículos del visitante, también los guardados antes
// de que existiera la normalización.
router.get('/', async (req: Request, res: Response) => {
  const { dpi, placa } = req.query as { dpi?: string; placa?: string };
  const porPlaca = placa !== undefined;
  if (dpi !== undefined && porPlaca) {
    return res.status(400).json({ error: 'Busca por dpi o por placa, no por las dos a la vez' });
  }
  if (!porPlaca && (!dpi || dpi.trim().length < 3)) {
    return res.status(400).json({ error: 'Indica dpi o placa (mínimo 3 caracteres)' });
  }
  const placaNorm = porPlaca ? normalizarPlaca(placa) : '';
  if (porPlaca && placaNorm.length < 3) {
    return res.status(400).json({ error: 'Indica dpi o placa (mínimo 3 caracteres)' });
  }

  const ts = tenantFilter(req.user!, 'ra');
  const alcance = `EXISTS (
           SELECT 1 FROM registros_acceso ra ${ts.joinClause}
            WHERE ra.visitante_id = v.id AND ${ts.whereClause}
         )`;
  try {
    const result = porPlaca
      ? await pool.query(
          `SELECT v.id, v.nombre, v.numero_dpi,
                  (SELECT veh.placa FROM vehiculos veh
                    WHERE veh.visitante_id = v.id AND ${sqlPlacaNormalizada('veh.placa')} LIKE $${ts.params.length + 1}
                    ORDER BY veh.created_at DESC LIMIT 1) AS placa
             FROM visitantes v
            WHERE EXISTS (SELECT 1 FROM vehiculos veh
                           WHERE veh.visitante_id = v.id AND ${sqlPlacaNormalizada('veh.placa')} LIKE $${ts.params.length + 1})
              AND ${alcance}
            LIMIT 10`,
          [...ts.params, `%${escapeLike(placaNorm)}%`]
        )
      : await pool.query(
          `SELECT v.id, v.nombre, v.numero_dpi FROM visitantes v
           WHERE v.numero_dpi ILIKE $${ts.params.length + 1}
             AND ${alcance}
           LIMIT 10`,
          [...ts.params, `%${escapeLike((dpi as string).trim())}%`]
        );
    res.json(result.rows);
  } catch (error) {
    serverError(res, error, 'Error al buscar visitantes');
  }
});

// GET /api/visitantes/buscar?q=TEXT&residente_id=UUID — autocompletado de la garita
router.get('/buscar', async (req: Request, res: Response) => {
  const { q, residente_id } = req.query as { q?: string; residente_id?: string };
  if (!q || q.trim().length < 4) {
    return res.json([]);
  }
  if (residente_id !== undefined && !esUuid(residente_id)) {
    return res.status(400).json({ error: 'residente_id inválido' });
  }

  const ts = tenantFilter(req.user!, 'ra');
  const patron = `%${escapeLike(q.trim())}%`;
  const params: unknown[] = [...ts.params, patron];
  const iPatron = ts.params.length + 1;
  let residenteFiltro = '';
  if (residente_id) {
    params.push(residente_id);
    residenteFiltro = `AND ra.residente_id = $${params.length}`;
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
       JOIN registros_acceso ra ON ra.visitante_id = v.id
       ${ts.joinClause}
       LEFT JOIN LATERAL (
         SELECT placa FROM vehiculos WHERE visitante_id = v.id ORDER BY created_at DESC LIMIT 1
       ) veh ON TRUE
       WHERE (v.nombre ILIKE $${iPatron} OR v.numero_dpi ILIKE $${iPatron})
         AND ${ts.whereClause}
         ${residenteFiltro}
       GROUP BY v.id, v.nombre, v.numero_dpi, veh.placa
       ORDER BY MAX(ra.timestamp_entrada) DESC NULLS LAST
       LIMIT 5`,
      params
    );
    res.json(result.rows);
  } catch (error) {
    serverError(res, error, 'Error al buscar visitantes');
  }
});

export default router;
