import { Request, Response } from 'express';
import pool from '../db/pool';
import { getConfigQrEfectiva } from './configQr.controller';
import { serverError } from '../utils/http';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const getResidenteIdFromUser = async (
  usuarioId: string
): Promise<{ id: string; sucursal_id: string } | null> => {
  const r = await pool.query(
    'SELECT id, sucursal_id FROM residentes WHERE usuario_id = $1', [usuarioId]
  );
  return r.rows.length > 0 ? r.rows[0] : null;
};

export const getMisInvitaciones = async (req: Request, res: Response) => {
  const residente = await getResidenteIdFromUser(req.user!.id);
  if (!residente) return res.status(404).json({ error: 'Residente no encontrado' });

  try {
    const result = await pool.query(
      `SELECT id, tipo, etiqueta, nombre_visitante, numero_dpi, placa,
              fecha_inicio, fecha_fin, usos_maximos, usos_actuales, activo, created_at
       FROM invitaciones_qr
       WHERE residente_id = $1 AND activo = TRUE
       ORDER BY created_at DESC`,
      [residente.id]
    );
    res.json(result.rows);
  } catch (error) {
    serverError(res, error, 'Error al obtener invitaciones QR');
  }
};

export const createMisInvitacion = async (req: Request, res: Response) => {
  const { tipo, etiqueta, nombre_visitante, numero_dpi, placa, fecha_inicio, fecha_fin, usos_maximos } = req.body;

  if (tipo !== 'grupal' && tipo !== 'individual') {
    return res.status(400).json({ error: "tipo debe ser 'grupal' o 'individual'" });
  }
  if (!fecha_inicio) {
    return res.status(400).json({ error: 'Campo requerido: fecha_inicio' });
  }

  const residente = await getResidenteIdFromUser(req.user!.id);
  if (!residente) return res.status(404).json({ error: 'Residente no encontrado' });

  const config = await getConfigQrEfectiva(pool, residente.sucursal_id);

  if (tipo === 'individual' && !nombre_visitante) {
    return res.status(400).json({ error: 'Para invitaciones individuales se requiere nombre_visitante' });
  }
  if (tipo === 'individual' && config.dpi_obligatorio_individual && !numero_dpi) {
    return res.status(400).json({
      error: 'Esta sucursal exige DPI/licencia para invitaciones individuales',
    });
  }
  if (config.requiere_placa && !placa) {
    return res.status(400).json({
      error: 'Esta sucursal exige registrar la placa del vehículo para invitaciones QR',
    });
  }

  const usosMaximosFinal: number | null =
    tipo === 'individual'
      ? (usos_maximos != null ? Number(usos_maximos) : 1)
      : (usos_maximos != null ? Number(usos_maximos) : null);

  if (usosMaximosFinal !== null && (!Number.isFinite(usosMaximosFinal) || usosMaximosFinal < 1)) {
    return res.status(400).json({ error: 'usos_maximos debe ser mayor a 0' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO invitaciones_qr
         (sucursal_id, residente_id, tipo, etiqueta, nombre_visitante, numero_dpi, placa,
          fecha_inicio, fecha_fin, usos_maximos)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [
        residente.sucursal_id, residente.id, tipo, etiqueta || null,
        tipo === 'individual' ? nombre_visitante : (nombre_visitante || null),
        numero_dpi || null,
        placa || null,
        fecha_inicio, fecha_fin || null, usosMaximosFinal,
      ]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    serverError(res, error, 'Error al crear invitación QR');
  }
};

export const deleteMisInvitacion = async (req: Request, res: Response) => {
  const { id } = req.params;

  const residente = await getResidenteIdFromUser(req.user!.id);
  if (!residente) return res.status(404).json({ error: 'Residente no encontrado' });

  try {
    const result = await pool.query(
      `UPDATE invitaciones_qr SET activo = FALSE
       WHERE id = $1 AND residente_id = $2 AND activo = TRUE
       RETURNING id`,
      [id, residente.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Invitación QR no encontrada' });
    }
    res.json({ message: 'Invitación QR revocada' });
  } catch (error) {
    serverError(res, error, 'Error al revocar invitación QR');
  }
};

/**
 * Valida una invitación QR escaneada en garita. Sólo consulta — el uso
 * (incremento de usos_actuales) se confirma dentro de la transacción de
 * registrarAcceso, para evitar condiciones de carrera entre "verificar" y
 * "autorizar" cuando dos garitas escanean el mismo código casi a la vez.
 */
export const verificarInvitacion = async (req: Request, res: Response) => {
  const { id } = req.params;
  if (!UUID_RE.test(id)) {
    return res.status(400).json({ error: 'Código QR inválido' });
  }

  try {
    const result = await pool.query(
      `SELECT i.*, r.numero_casa, u.nombre AS residente_nombre,
              (i.fecha_inicio <= CURRENT_DATE) AS ya_vigente,
              (i.fecha_fin IS NULL OR i.fecha_fin >= CURRENT_DATE) AS no_vencida
       FROM invitaciones_qr i
       JOIN residentes r ON i.residente_id = r.id
       JOIN usuarios   u ON r.usuario_id   = u.id
       WHERE i.id = $1`,
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Invitación QR no encontrada' });
    }
    const inv = result.rows[0];

    if (inv.sucursal_id !== req.user!.sucursal_id) {
      return res.status(403).json({ error: 'Esta invitación pertenece a otra sucursal' });
    }
    if (!inv.activo) {
      return res.status(409).json({ error: 'Invitación QR revocada' });
    }
    if (inv.bloqueado_hasta && new Date(inv.bloqueado_hasta) > new Date()) {
      return res.status(409).json({ error: 'Invitación QR bloqueada temporalmente por intentos fallidos' });
    }
    if (!inv.ya_vigente) {
      return res.status(409).json({ error: 'Invitación QR aún no vigente' });
    }
    if (!inv.no_vencida) {
      return res.status(409).json({ error: 'Invitación QR vencida' });
    }
    if (inv.usos_maximos != null && inv.usos_actuales >= inv.usos_maximos) {
      return res.status(409).json({ error: 'Invitación QR ya alcanzó el máximo de usos' });
    }

    res.json({
      id: inv.id,
      tipo: inv.tipo,
      etiqueta: inv.etiqueta,
      nombre_visitante: inv.nombre_visitante,
      numero_dpi: inv.numero_dpi,
      placa: inv.placa,
      residente_id: inv.residente_id,
      numero_casa: inv.numero_casa,
      residente_nombre: inv.residente_nombre,
      usos_maximos: inv.usos_maximos,
      usos_actuales: inv.usos_actuales,
    });
  } catch (error) {
    serverError(res, error, 'Error al verificar invitación QR');
  }
};
