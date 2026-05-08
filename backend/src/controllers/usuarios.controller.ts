import { Request, Response } from 'express';
import pool from '../db/pool';

export const getUsuarios = async (req: Request, res: Response) => {
  const user = req.user!;
  try {
    let whereClause: string;
    const params: (string | null)[] = [];

    if (user.rol === 'owner') {
      whereClause = 'TRUE';
    } else if (user.rol === 'admin_empresa') {
      whereClause = `EXISTS (
        SELECT 1 FROM sucursales _es
        WHERE _es.id = u.sucursal_id AND _es.empresa_id = $1
      )`;
      params.push(user.empresa_id);
    } else {
      whereClause = 'u.sucursal_id = $1';
      params.push(user.sucursal_id);
    }

    const result = await pool.query(
      `SELECT u.id, u.nombre, u.email, u.rol, u.sucursal_id, u.empresa_id, u.activo, u.created_at,
              s.nombre AS sucursal_nombre
         FROM usuarios u
         LEFT JOIN sucursales s ON s.id = u.sucursal_id
        WHERE ${whereClause}
          AND u.rol != 'residente'
        ORDER BY u.nombre`,
      params
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener usuarios', detail: String(err) });
  }
};

export const getUsuariosSucursal = async (req: Request, res: Response) => {
  const user = req.user!;
  const sucursalId = user.sucursal_id;
  if (!sucursalId) {
    return res.status(400).json({ error: 'El usuario no tiene sucursal asignada' });
  }
  try {
    const result = await pool.query(
      `SELECT u.id, u.nombre, u.email, u.rol, u.activo, u.created_at
         FROM usuarios u
        WHERE u.sucursal_id = $1
          AND u.rol IN ('agente', 'admin_sucursal')
        ORDER BY u.rol, u.nombre`,
      [sucursalId]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener usuarios', detail: String(err) });
  }
};

export const deleteUsuario = async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const result = await pool.query(
      `UPDATE usuarios SET activo = FALSE WHERE id = $1 RETURNING id, nombre, email, rol, activo`,
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: 'Error al eliminar usuario', detail: String(error) });
  }
};

export const createUsuario = async (req: Request, res: Response) => {
  const user = req.user!;
  const { nombre, email, password, rol, numero_casa } = req.body as {
    nombre?: string;
    email?: string;
    password?: string;
    rol?: string;
    numero_casa?: string;
  };

  if (!nombre?.trim() || !email?.trim() || !password?.trim() || !rol?.trim()) {
    return res.status(400).json({ error: 'nombre, email, password y rol son requeridos' });
  }

  const rolesPermitidos = ['agente', 'admin_sucursal', 'residente'];
  if (!rolesPermitidos.includes(rol)) {
    return res.status(400).json({ error: `Rol no permitido: ${rol}` });
  }

  if (rol === 'residente' && !numero_casa?.trim()) {
    return res.status(400).json({ error: 'numero_casa es requerido para rol residente' });
  }

  let resolvedSucursalId: string | null = user.sucursal_id;
  if ((user.rol === 'owner' || user.rol === 'admin_empresa') && req.body.sucursal_id) {
    resolvedSucursalId = req.body.sucursal_id;
  }

  if (!resolvedSucursalId && user.rol !== 'owner') {
    return res.status(400).json({ error: 'No tienes sucursal asignada' });
  }

  let resolvedEmpresaId: string | null = user.empresa_id;

  if (resolvedSucursalId && !resolvedEmpresaId) {
    const sucCheck = await pool.query(
      'SELECT empresa_id FROM sucursales WHERE id = $1',
      [resolvedSucursalId]
    );
    if (sucCheck.rows.length > 0) {
      resolvedEmpresaId = sucCheck.rows[0].empresa_id as string;
    }
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const userResult = await client.query(
      `INSERT INTO usuarios (nombre, email, password_hash, rol, sucursal_id, empresa_id, activo)
       VALUES ($1, $2, crypt($3, gen_salt('bf')), $4, $5, $6, TRUE)
       RETURNING id, nombre, email, rol, sucursal_id, empresa_id, activo, created_at`,
      [nombre, email, password, rol, resolvedSucursalId, resolvedEmpresaId]
    );
    const newUser = userResult.rows[0] as { id: string };

    if (rol === 'residente' && resolvedSucursalId) {
      await client.query(
        `INSERT INTO residentes (usuario_id, sucursal_id, numero_casa, estado_pago, saldo_pendiente)
         VALUES ($1, $2, $3, 'al_dia', 0)`,
        [newUser.id, resolvedSucursalId, numero_casa!.trim()]
      );
    }

    await client.query('COMMIT');
    res.status(201).json(userResult.rows[0]);
  } catch (err: unknown) {
    await client.query('ROLLBACK');
    const e = err as { code?: string };
    if (e.code === '23505') {
      return res.status(409).json({ error: 'El email ya está registrado' });
    }
    res.status(500).json({ error: 'Error al crear usuario', detail: String(err) });
  } finally {
    client.release();
  }
};

export const updatePreferencias = async (req: Request, res: Response) => {
  const { idioma, tema } = req.body;
  if (!idioma || !tema) {
    return res.status(400).json({ error: 'Campos requeridos: idioma, tema' });
  }
  try {
    await pool.query(
      'UPDATE usuarios SET idioma = $1, tema = $2 WHERE id = $3',
      [idioma, tema, req.user!.id]
    );
    res.json({ message: 'Preferencias actualizadas' });
  } catch (error) {
    res.status(500).json({ error: 'Error al actualizar preferencias', detail: String(error) });
  }
};
