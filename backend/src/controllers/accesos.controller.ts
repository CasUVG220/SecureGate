import { Request, Response } from 'express';
import pool from '../db/pool';
import { checkPreautorizacion } from './preautorizaciones.controller';

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

    // 1. Verificar que el residente existe
    const residenteResult = await client.query(
      'SELECT id, estado_pago FROM residentes WHERE id = $1',
      [residente_id]
    );
    if (residenteResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Residente no encontrado' });
    }

    // 2. Verificar que el agente existe
    const agenteResult = await client.query(
      "SELECT id FROM usuarios WHERE id = $1 AND activo = TRUE AND rol IN ('agente', 'admin')",
      [agente_id]
    );
    if (agenteResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Agente no encontrado o inactivo' });
    }

    // 3. Upsert visitante por numero_dpi
    // 3. Verificar preautorización (lectura simple, no afecta la transacción)
    const preautorizado = await checkPreautorizacion(numero_dpi, residente_id);

    // 4. Upsert visitante por numero_dpi
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

    // 4. Registrar vehículo si se proporcionó placa
    // 5. Registrar vehículo si se proporcionó placa
    let vehiculo_id: string | null = null;
    if (placa) {
      const vehiculoResult = await client.query(
        'INSERT INTO vehiculos (visitante_id, placa) VALUES ($1, $2) RETURNING id',
        [visitante_id, placa]
      );
      vehiculo_id = vehiculoResult.rows[0].id;
    }

    // 5. Crear registro de acceso
    // 6. Crear registro de acceso
    const registroResult = await client.query(
      `INSERT INTO registros_acceso (visitante_id, residente_id, vehiculo_id, agente_id, tipo, notas)
       VALUES ($1, $2, $3, $4, 'entrada', $5)
       RETURNING *`,
      [visitante_id, residente_id, vehiculo_id, agente_id, notas || null]
    );
    const registro = registroResult.rows[0];

    // 6. Generar cargo automático si el residente está en mora
    // 7. Generar cargo automático si el residente está en mora
    let cargo_generado = null;
    const estado_pago = residenteResult.rows[0].estado_pago;
    if (estado_pago === 'mora') {
      const configResult = await client.query(
        'SELECT id, nombre, monto FROM configuracion_cargos WHERE activo = TRUE LIMIT 1'
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

    res.status(201).json({ registro, visitante, cargo_generado });
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
       WHERE id = $1 AND timestamp_salida IS NULL
       RETURNING *`,
      [id]
    );
    if (result.rows.length === 0) {
      const existe = await pool.query('SELECT id, timestamp_salida FROM registros_acceso WHERE id = $1', [id]);
      if (existe.rows.length === 0) {
        return res.status(404).json({ error: 'Registro de acceso no encontrado' });
      }
      return res.status(409).json({ error: 'La salida ya fue registrada para este acceso' });
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
       WHERE UPPER(veh.placa) = UPPER($1)
         AND ra.timestamp_salida IS NULL
       ORDER BY ra.timestamp_entrada DESC
       LIMIT 1`,
      [placa]
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
      'SELECT id, timestamp_salida FROM registros_acceso WHERE id = $1',
      [id]
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
       RETURNING *`,
      [id]
    );
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: 'Error al registrar salida', detail: String(error) });
  }
};