import { Request, Response } from 'express';
import pool from '../db/pool';
import { tenantFilter, ownershipClause, ownershipParams, resolverSucursal } from '../utils/tenant';
import { serverError } from '../utils/http';

const PRIORIDADES = ['normal', 'importante', 'urgente'];

// Ordena urgente > importante > normal
const PRIORIDAD_ORDER = `CASE a.prioridad
  WHEN 'urgente'    THEN 3
  WHEN 'importante' THEN 2
  ELSE 1 END`;

// ── Admin ───────────────────────────────────────────────────────────────────

export const getAnuncios = async (req: Request, res: Response) => {
  const ts = tenantFilter(req.user!, 'a');
  try {
    const result = await pool.query(
      `SELECT a.id, a.sucursal_id, a.titulo, a.contenido, a.prioridad,
              a.vigente_desde, a.vigente_hasta, a.creado_por, a.created_at,
              s.nombre AS sucursal_nombre,
              COALESCE(u.nombre, 'Sistema') AS creado_por_nombre,
              (SELECT COUNT(*) FROM anuncio_lecturas al WHERE al.anuncio_id = a.id) AS total_lecturas
       FROM anuncios a
       JOIN sucursales s ON a.sucursal_id = s.id
       LEFT JOIN usuarios u ON a.creado_por = u.id
       ${ts.joinClause}
       WHERE ${ts.whereClause}
         AND a.residente_id IS NULL
       ORDER BY ${PRIORIDAD_ORDER} DESC, a.created_at DESC`,
      ts.params
    );
    res.json(result.rows);
  } catch (error) {
    serverError(res, error, 'Error al obtener anuncios');
  }
};

export const createAnuncio = async (req: Request, res: Response) => {
  const { titulo, contenido, prioridad, vigente_desde, vigente_hasta, sucursal_id: bodySucursalId } = req.body;

  if (!titulo || !contenido) {
    return res.status(400).json({ error: 'Campos requeridos: titulo, contenido' });
  }
  const prioridadFinal: string = prioridad ?? 'normal';
  if (!PRIORIDADES.includes(prioridadFinal)) {
    return res.status(400).json({ error: 'prioridad debe ser: normal, importante o urgente' });
  }

  const sucResuelta = await resolverSucursal(req.user!, bodySucursalId, pool);
  if (sucResuelta.ok === false) {
    return res.status(sucResuelta.status).json({ error: sucResuelta.error });
  }
  const sucursal_id = sucResuelta.id;

  try {
    const result = await pool.query(
      `INSERT INTO anuncios
         (sucursal_id, titulo, contenido, prioridad, vigente_desde, vigente_hasta, creado_por)
       VALUES ($1, $2, $3, $4, COALESCE($5, NOW()), $6, $7)
       RETURNING *`,
      [
        sucursal_id, titulo, contenido, prioridadFinal,
        vigente_desde || null, vigente_hasta || null, req.user!.id,
      ]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    serverError(res, error, 'Error al crear anuncio');
  }
};

export const updateAnuncio = async (req: Request, res: Response) => {
  const { id } = req.params;
  const { titulo, contenido, prioridad, vigente_desde, vigente_hasta } = req.body;

  if (prioridad && !PRIORIDADES.includes(prioridad)) {
    return res.status(400).json({ error: 'prioridad debe ser: normal, importante o urgente' });
  }

  try {
    const result = await pool.query(
      `UPDATE anuncios
       SET titulo        = COALESCE($1, titulo),
           contenido     = COALESCE($2, contenido),
           prioridad     = COALESCE($3, prioridad),
           vigente_desde = COALESCE($4, vigente_desde),
           vigente_hasta = $5
       WHERE id = $6
         AND residente_id IS NULL
         AND ${ownershipClause('anuncios', 7)}
       RETURNING *`,
      [
        titulo ?? null, contenido ?? null, prioridad ?? null,
        vigente_desde ?? null,
        vigente_hasta === undefined ? null : (vigente_hasta || null),
        id,
        ...ownershipParams(req.user!),
      ]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Anuncio no encontrado o sin acceso' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    serverError(res, error, 'Error al actualizar anuncio');
  }
};

export const deleteAnuncio = async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const result = await pool.query(
      `DELETE FROM anuncios
       WHERE id = $1
         AND residente_id IS NULL
         AND ${ownershipClause('anuncios', 2)}
       RETURNING id`,
      [id, ...ownershipParams(req.user!)]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Anuncio no encontrado o sin acceso' });
    }
    res.json({ message: 'Anuncio eliminado', id: result.rows[0].id });
  } catch (error) {
    serverError(res, error, 'Error al eliminar anuncio');
  }
};

// ── Residente ────────────────────────────────────────────────────────────────

export const getMisAnuncios = async (req: Request, res: Response) => {
  const usuario_id = req.user?.id;
  try {
    const residente = await pool.query(
      'SELECT id, sucursal_id FROM residentes WHERE usuario_id = $1',
      [usuario_id]
    );
    if (residente.rows.length === 0) {
      return res.status(404).json({ error: 'Residente no encontrado' });
    }
    const { id: residente_id, sucursal_id } = residente.rows[0];

    const result = await pool.query(
      `SELECT a.id, a.titulo, a.contenido, a.prioridad,
              a.vigente_desde, a.vigente_hasta, a.created_at,
              (al.id IS NOT NULL) AS leido,
              al.leido_at,
              (a.residente_id IS NOT NULL) AS es_personal
       FROM anuncios a
       LEFT JOIN anuncio_lecturas al
         ON al.anuncio_id = a.id AND al.residente_id = $1
       WHERE a.sucursal_id = $2
         AND (a.residente_id IS NULL OR a.residente_id = $1)
         AND a.vigente_desde <= NOW()
         AND (a.vigente_hasta IS NULL OR a.vigente_hasta > NOW())
       ORDER BY ${PRIORIDAD_ORDER} DESC, a.created_at DESC`,
      [residente_id, sucursal_id]
    );
    res.json(result.rows);
  } catch (error) {
    serverError(res, error, 'Error al obtener anuncios');
  }
};

export const marcarLeido = async (req: Request, res: Response) => {
  const { id } = req.params;
  const usuario_id = req.user?.id;
  try {
    const residente = await pool.query(
      'SELECT id, sucursal_id FROM residentes WHERE usuario_id = $1',
      [usuario_id]
    );
    if (residente.rows.length === 0) {
      return res.status(404).json({ error: 'Residente no encontrado' });
    }
    const { id: residente_id, sucursal_id } = residente.rows[0];

    // Sólo se marca un anuncio que el residente PUEDE ver: de su sucursal y,
    // si es personal, dirigido a él (mismo criterio que getMisAnuncios). Antes se
    // insertaba la lectura sobre cualquier id: un residente de otra empresa
    // inflaba el contador de lecturas ajeno y el 200 confirmaba que el anuncio
    // existía (hallazgo S-05, backend/securitytest).
    const anuncio = await pool.query(
      `INSERT INTO anuncio_lecturas (anuncio_id, residente_id)
       SELECT a.id, $2 FROM anuncios a
        WHERE a.id = $1
          AND a.sucursal_id = $3
          AND (a.residente_id IS NULL OR a.residente_id = $2)
       ON CONFLICT (anuncio_id, residente_id) DO NOTHING
       RETURNING anuncio_id`,
      [id, residente_id, sucursal_id]
    );
    if (anuncio.rows.length === 0) {
      // O no existe / no es suyo, o ya estaba leído: se distingue sin filtrar ajenos.
      const visible = await pool.query(
        `SELECT 1 FROM anuncios a
          WHERE a.id = $1 AND a.sucursal_id = $2 AND (a.residente_id IS NULL OR a.residente_id = $3)`,
        [id, sucursal_id, residente_id]
      );
      if (visible.rows.length === 0) return res.status(404).json({ error: 'Anuncio no encontrado' });
    }
    res.json({ anuncio_id: id, leido: true });
  } catch (error) {
    serverError(res, error, 'Error al marcar anuncio como leído');
  }
};
