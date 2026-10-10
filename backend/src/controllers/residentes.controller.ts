import { Request, Response } from 'express';
import pool from '../db/pool';
import { tenantFilter, ownershipClause, ownershipParams, resolverSucursal } from '../utils/tenant';
import { serverError } from '../utils/http';
import { validarPassword, BCRYPT_COST } from '../utils/password';
import { revocarSesionesDeUsuario } from './auth.controller';
import { revocarAccesoDeUsuario } from '../utils/revocacion';

export const getResidentes = async (req: Request, res: Response) => {
  const ts = tenantFilter(req.user!, 'r');
  try {
    const result = await pool.query(
      `SELECT r.id, r.usuario_id, r.numero_casa, r.estado_pago, r.telefono, r.saldo_pendiente,
              u.nombre, u.email
       FROM residentes r
       JOIN usuarios u ON r.usuario_id = u.id
       ${ts.joinClause}
       WHERE ${ts.whereClause}
       ORDER BY r.numero_casa`,
      ts.params
    );
    res.json(result.rows);
  } catch (error) {
    serverError(res, error, 'Error al obtener residentes');
  }
};

export const getResidenteById = async (req: Request, res: Response) => {
  const { id } = req.params;
  const ts = tenantFilter(req.user!, 'r');
  const idOffset = ts.params.length + 1;

  try {
    const result = await pool.query(
      `SELECT r.id, r.usuario_id, r.numero_casa, r.estado_pago, r.telefono, r.saldo_pendiente,
              u.nombre, u.email
       FROM residentes r
       JOIN usuarios u ON r.usuario_id = u.id
       ${ts.joinClause}
       WHERE ${ts.whereClause}
         AND r.id = $${idOffset}`,
      [...ts.params, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Residente no encontrado' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    serverError(res, error, 'Error al obtener residente');
  }
};

export const createResidente = async (req: Request, res: Response) => {
  const { nombre, email, password, numero_casa, telefono, sucursal_id: bodySucursalId } = req.body;

  if (!nombre || !email || !password || !numero_casa) {
    return res.status(400).json({ error: 'Campos requeridos: nombre, email, password, numero_casa' });
  }
  const correo = String(email).trim().toLowerCase();
  const problemaPassword = validarPassword(password, correo);
  if (problemaPassword) return res.status(400).json({ error: problemaPassword });

  const sucResuelta = await resolverSucursal(req.user!, bodySucursalId, pool);
  if (sucResuelta.ok === false) {
    return res.status(sucResuelta.status).json({ error: sucResuelta.error });
  }
  const sucursal_id = sucResuelta.id;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const usuarioResult = await client.query(
      `INSERT INTO usuarios (nombre, email, password_hash, rol, sucursal_id)
       VALUES ($1, $2, crypt($3, gen_salt('bf', ${BCRYPT_COST})), 'residente', $4)
       RETURNING id`,
      [String(nombre).trim(), correo, password, sucursal_id]
    );
    const usuario_id = usuarioResult.rows[0].id;

    const residenteResult = await client.query(
      `INSERT INTO residentes (usuario_id, sucursal_id, numero_casa, telefono)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [usuario_id, sucursal_id, numero_casa, telefono || null]
    );

    await client.query('COMMIT');
    res.status(201).json({ ...residenteResult.rows[0], nombre, email: correo });
  } catch (error: any) {
    await client.query('ROLLBACK');
    if (error.code === '23505') {
      return res.status(409).json({ error: 'El email o numero_casa ya existe' });
    }
    serverError(res, error, 'Error al crear residente');
  } finally {
    client.release();
  }
};

export const updateResidente = async (req: Request, res: Response) => {
  const { id } = req.params;
  const { numero_casa, estado_pago, telefono, saldo_pendiente } = req.body;

  const estadosValidos = ['al_dia', 'mora', 'pendiente'];
  if (estado_pago && !estadosValidos.includes(estado_pago)) {
    return res.status(400).json({ error: 'estado_pago debe ser: al_dia, mora o pendiente' });
  }

  try {
    const result = await pool.query(
      `UPDATE residentes
       SET numero_casa     = COALESCE($1, numero_casa),
           estado_pago     = COALESCE($2, estado_pago),
           telefono        = COALESCE($3, telefono),
           saldo_pendiente = COALESCE($4, saldo_pendiente)
       WHERE id = $5
         AND ${ownershipClause('residentes', 6)}
       RETURNING *`,
      [
        numero_casa || null, estado_pago || null, telefono || null, saldo_pendiente ?? null,
        id,
        ...ownershipParams(req.user!),
      ]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Residente no encontrado o sin acceso' });
    }
    res.json(result.rows[0]);
  } catch (error: any) {
    if (error.code === '23505') {
      return res.status(409).json({ error: 'El numero_casa ya existe' });
    }
    serverError(res, error, 'Error al actualizar residente');
  }
};

/**
 * Elimina el perfil de residente y da de baja su cuenta de usuario (antes la
 * cuenta quedaba activa, con sesión válida y sin perfil). Si el residente ya
 * tiene historial (pagos, accesos…) las FK lo impiden: se responde 409 en vez
 * de un 500 y hay que desactivarlo desde Usuarios.
 */
export const deleteResidente = async (req: Request, res: Response) => {
  const { id } = req.params;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `DELETE FROM residentes
       WHERE id = $1
         AND ${ownershipClause('residentes', 2)}
       RETURNING id, usuario_id`,
      [id, ...ownershipParams(req.user!)]
    );

    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Residente no encontrado o sin acceso' });
    }
    const { usuario_id } = result.rows[0];
    await client.query('UPDATE usuarios SET activo = FALSE WHERE id = $1', [usuario_id]);
    await client.query('COMMIT');

    await revocarSesionesDeUsuario(pool, usuario_id);
    revocarAccesoDeUsuario(usuario_id);
    res.json({ message: 'Residente eliminado correctamente', id: result.rows[0].id });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if ((error as { code?: string }).code === '23503') {
      return res.status(409).json({ error: 'El residente tiene historial (pagos o accesos) y no puede eliminarse' });
    }
    serverError(res, error, 'Error al eliminar residente');
  } finally {
    client.release();
  }
};

export const getResidenteMe = async (req: Request, res: Response) => {
  const usuarioId = req.user?.id;
  try {
    const r = await pool.query(
      `SELECT r.id, r.numero_casa, r.estado_pago, r.saldo_pendiente, r.telefono,
              u.nombre, u.email
       FROM residentes r
       JOIN usuarios u ON r.usuario_id = u.id
       WHERE r.usuario_id = $1`,
      [usuarioId]
    );
    if (r.rows.length === 0) {
      return res.status(404).json({ error: 'Residente no encontrado para este usuario' });
    }

    const pagos = await pool.query(
      `SELECT id, monto, fecha_pago, metodo, estado
       FROM pagos
       WHERE residente_id = $1
         AND estado <> 'rechazado'
       ORDER BY fecha_pago DESC
       LIMIT 10`,
      [r.rows[0].id]
    );

    res.json({ ...r.rows[0], pagos_recientes: pagos.rows });
  } catch (error) {
    serverError(res, error, 'Error al obtener datos del residente');
  }
};

export const getResidentePago = async (req: Request, res: Response) => {
  const { id } = req.params;
  const ts = tenantFilter(req.user!, 'r');
  const idOffset = ts.params.length + 1;

  try {
    const r = await pool.query(
      `SELECT r.estado_pago, r.saldo_pendiente
       FROM residentes r
       ${ts.joinClause}
       WHERE ${ts.whereClause}
         AND r.id = $${idOffset}`,
      [...ts.params, id]
    );
    if (r.rows.length === 0) {
      return res.status(404).json({ error: 'Residente no encontrado' });
    }

    const pagos = await pool.query(
      `SELECT id, monto, fecha_pago, metodo, estado
       FROM pagos
       WHERE residente_id = $1
         AND estado <> 'rechazado'
       ORDER BY fecha_pago DESC
       LIMIT 5`,
      [id]
    );

    const cargos = await pool.query(
      `SELECT id, monto, descripcion, created_at
       FROM cargos_automaticos
       WHERE residente_id = $1 AND aplicado = FALSE
       ORDER BY created_at DESC`,
      [id]
    );

    res.json({
      estado_pago:      r.rows[0].estado_pago,
      saldo_pendiente:  r.rows[0].saldo_pendiente,
      pagos_recientes:  pagos.rows,
      cargos_pendientes: cargos.rows,
    });
  } catch (error) {
    serverError(res, error, 'Error al obtener estado de pago');
  }
};
