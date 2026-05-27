import { Request, Response } from 'express';
import pool from '../db/pool';
import { checkPreautorizacion } from './preautorizaciones.controller';
import { tenantFilter, ownershipClause, ownershipParams } from '../utils/tenant';

export const registrarAcceso = async (req: Request, res: Response) => {
  const { nombre_visitante, numero_dpi, foto, residente_id, agente_id, placa, notas } = req.body;

  if (!nombre_visitante || !numero_dpi || !residente_id || !agente_id) {
    return res.status(400).json({
      error: 'Campos requeridos: nombre_visitante, numero_dpi, residente_id, agente_id',
    });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Verify residente exists and get their sucursal_id
    const residenteResult = await client.query(
      'SELECT id, estado_pago, sucursal_id FROM residentes WHERE id = $1',
      [residente_id]
    );
    if (residenteResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Residente no encontrado' });
    }

    // Resolve sucursal_id: from JWT (agente/admin_sucursal) or from residente record
    const sucursal_id: string = req.user!.sucursal_id ?? residenteResult.rows[0].sucursal_id;
    if (!sucursal_id) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'No se pudo determinar la sucursal del registro' });
    }

    // Verify agente exists with a valid staff role
    const agenteResult = await client.query(
      `SELECT id FROM usuarios
       WHERE id = $1 AND activo = TRUE
         AND rol IN ('agente', 'admin_sucursal', 'admin_empresa', 'owner')`,
      [agente_id]
    );
    if (agenteResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Agente no encontrado o inactivo' });
    }

    const preautorizado = await checkPreautorizacion(numero_dpi, residente_id);

    // Upsert visitante
    const visitanteExistente = await client.query(
      'SELECT id FROM visitantes WHERE numero_dpi = $1',
      [numero_dpi]
    );
    let visitante_id: string;
    let visitante: object;
    if (visitanteExistente.rows.length > 0) {
      visitante_id = visitanteExistente.rows[0].id;
      const v = await client.query('SELECT * FROM visitantes WHERE id = $1', [visitante_id]);
      visitante = v.rows[0];
    } else {
      const nuevoVisitante = await client.query(
        'INSERT INTO visitantes (nombre, numero_dpi, foto) VALUES ($1, $2, $3) RETURNING *',
        [nombre_visitante, numero_dpi, foto || null]
      );
      visitante_id = nuevoVisitante.rows[0].id;
      visitante = nuevoVisitante.rows[0];
    }

    // Register vehicle if plate provided
    let vehiculo_id: string | null = null;
    if (placa) {
      const vehiculoResult = await client.query(
        'INSERT INTO vehiculos (visitante_id, placa) VALUES ($1, $2) RETURNING id',
        [visitante_id, placa]
      );
      vehiculo_id = vehiculoResult.rows[0].id;
    }

    // Create access record with sucursal_id
    const registroResult = await client.query(
      `INSERT INTO registros_acceso
         (sucursal_id, visitante_id, residente_id, vehiculo_id, agente_id, tipo, notas)
       VALUES ($1, $2, $3, $4, $5, 'entrada', $6)
       RETURNING *`,
      [sucursal_id, visitante_id, residente_id, vehiculo_id, agente_id, notas || null]
    );
    const registro = registroResult.rows[0];

    // Auto-charge if residente is in mora — filtered by sucursal
    let cargo_generado = null;
    if (residenteResult.rows[0].estado_pago === 'mora') {
      const configResult = await client.query(
        `SELECT id, nombre, monto FROM configuracion_cargos
         WHERE activo = TRUE AND sucursal_id = $1
         LIMIT 1`,
        [sucursal_id]
      );
      if (configResult.rows.length > 0) {
        const config = configResult.rows[0];
        const cargoResult = await client.query(
          `INSERT INTO cargos_automaticos (registro_acceso_id, residente_id, monto, descripcion)
           VALUES ($1, $2, $3, $4)
           RETURNING *`,
          [registro.id, residente_id, config.monto, `Cargo por acceso con mora — ${config.nombre}`]
        );
        cargo_generado = cargoResult.rows[0];
      }
    }

    await client.query('COMMIT');
    res.status(201).json({ registro, visitante, cargo_generado, preautorizado });
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Error al registrar acceso', detail: String(error) });
  } finally {
    client.release();
  }
};

export const registrarSalida = async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const result = await pool.query(
      `UPDATE registros_acceso
       SET tipo = 'salida', timestamp_salida = NOW()
       WHERE id = $1
         AND timestamp_salida IS NULL
         AND ${ownershipClause('registros_acceso', 2)}
       RETURNING *`,
      [id, ...ownershipParams(req.user!)]
    );
    if (result.rows.length === 0) {
      const existe = await pool.query(
        'SELECT id, timestamp_salida FROM registros_acceso WHERE id = $1', [id]
      );
      if (existe.rows.length === 0) {
        return res.status(404).json({ error: 'Registro de acceso no encontrado' });
      }
      if (existe.rows[0].timestamp_salida !== null) {
        return res.status(409).json({ error: 'La salida ya fue registrada para este acceso' });
      }
      return res.status(403).json({ error: 'Sin acceso a este registro' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: 'Error al registrar salida', detail: String(error) });
  }
};

export const getAccesoActivo = async (req: Request, res: Response) => {
  const { placa } = req.query as { placa?: string };
  if (!placa) {
    return res.status(400).json({ error: 'Parámetro requerido: placa' });
  }

  const ts = tenantFilter(req.user!, 'ra');
  const placaOffset = ts.params.length + 1;

  try {
    const result = await pool.query(
      `SELECT
         ra.id              AS registro_id,
         ra.timestamp_entrada,
         v.id               AS visitante_id,
         v.nombre           AS visitante_nombre,
         v.numero_dpi       AS visitante_dpi,
         r.id               AS residente_id,
         r.numero_casa      AS residente_casa,
         u.nombre           AS residente_nombre,
         veh.placa
       FROM registros_acceso ra
       JOIN visitantes  v   ON ra.visitante_id  = v.id
       JOIN residentes  r   ON ra.residente_id  = r.id
       JOIN usuarios    u   ON r.usuario_id     = u.id
       JOIN vehiculos   veh ON ra.vehiculo_id   = veh.id
       ${ts.joinClause}
       WHERE ${ts.whereClause}
         AND UPPER(veh.placa) = UPPER($${placaOffset})
         AND ra.timestamp_salida IS NULL
       ORDER BY ra.timestamp_entrada DESC
       LIMIT 1`,
      [...ts.params, placa]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'No hay acceso activo para esa placa' });
    }
    const row = result.rows[0];
    res.json({
      registro_id:       row.registro_id,
      timestamp_entrada: row.timestamp_entrada,
      visitante: {
        id:         row.visitante_id,
        nombre:     row.visitante_nombre,
        numero_dpi: row.visitante_dpi,
      },
      residente: {
        id:          row.residente_id,
        numero_casa: row.residente_casa,
        nombre:      row.residente_nombre,
      },
      placa: row.placa,
    });
  } catch (error) {
    res.status(500).json({ error: 'Error al buscar acceso activo', detail: String(error) });
  }
};

export const registrarSalidaPut = async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const existe = await pool.query(
      'SELECT id, timestamp_salida FROM registros_acceso WHERE id = $1', [id]
    );
    if (existe.rows.length === 0) {
      return res.status(404).json({ error: 'Registro de acceso no encontrado' });
    }
    if (existe.rows[0].timestamp_salida !== null) {
      return res.status(409).json({ error: 'La salida ya fue registrada para este acceso' });
    }

    const result = await pool.query(
      `UPDATE registros_acceso
       SET timestamp_salida = NOW()
       WHERE id = $1
         AND ${ownershipClause('registros_acceso', 2)}
       RETURNING *`,
      [id, ...ownershipParams(req.user!)]
    );
    if (result.rows.length === 0) {
      return res.status(403).json({ error: 'Sin acceso a este registro' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: 'Error al registrar salida', detail: String(error) });
  }
};

export const getAccesosActivos = async (req: Request, res: Response) => {
  const ts = tenantFilter(req.user!, 'ra');
  try {
    const result = await pool.query(
      `SELECT
         ra.id              AS registro_id,
         ra.timestamp_entrada,
         v.id               AS visitante_id,
         v.nombre           AS visitante_nombre,
         v.numero_dpi       AS visitante_dpi,
         r.id               AS residente_id,
         r.numero_casa      AS residente_casa,
         u.nombre           AS residente_nombre,
         veh.placa
       FROM registros_acceso ra
       JOIN visitantes  v   ON ra.visitante_id  = v.id
       JOIN residentes  r   ON ra.residente_id  = r.id
       JOIN usuarios    u   ON r.usuario_id     = u.id
       LEFT JOIN vehiculos  veh ON ra.vehiculo_id = veh.id
       ${ts.joinClause}
       WHERE ${ts.whereClause}
         AND ra.timestamp_salida IS NULL
       ORDER BY ra.timestamp_entrada DESC`,
      ts.params
    );
    res.json(result.rows.map(row => ({
      registro_id:       row.registro_id,
      timestamp_entrada: row.timestamp_entrada,
      visitante: {
        id:         row.visitante_id,
        nombre:     row.visitante_nombre,
        numero_dpi: row.visitante_dpi,
      },
      residente: {
        id:          row.residente_id,
        numero_casa: row.residente_casa,
        nombre:      row.residente_nombre,
      },
      placa: row.placa ?? null,
    })));
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener accesos activos', detail: String(error) });
  }
};

export const getMisAccesos = async (req: Request, res: Response) => {
  const usuarioId = req.user?.id;
  try {
    const r = await pool.query(
      'SELECT id FROM residentes WHERE usuario_id = $1', [usuarioId]
    );
    if (r.rows.length === 0) {
      return res.status(404).json({ error: 'Residente no encontrado' });
    }
    const residenteId = r.rows[0].id;

    const result = await pool.query(
      `SELECT ra.id, ra.timestamp_entrada, ra.timestamp_salida,
              v.nombre AS nombre_visitante, v.numero_dpi, ve.placa
       FROM registros_acceso ra
       JOIN visitantes v ON ra.visitante_id = v.id
       LEFT JOIN vehiculos ve ON ra.vehiculo_id = ve.id
       WHERE ra.residente_id = $1
       ORDER BY ra.timestamp_entrada DESC
       LIMIT 20`,
      [residenteId]
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener historial de accesos', detail: String(error) });
  }
};
