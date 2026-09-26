import { Request, Response } from 'express';
import pool from '../db/pool';
import { ownershipParams, resolverSucursal } from '../utils/tenant';
import { validarPassword, BCRYPT_COST } from '../utils/password';
import { revocarAccesoDeUsuario } from '../utils/revocacion';
import { revocarSesionesDeUsuario } from './auth.controller';
import { serverError } from '../utils/http';

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
    serverError(res, err, 'Error al obtener usuarios');
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
    serverError(res, err, 'Error al obtener usuarios');
  }
};

/**
 * Baja lógica de un usuario. Cada rol sólo puede dar de baja a quien tiene por
 * debajo y dentro de su alcance:
 *
 *   owner            → cualquiera menos otro owner
 *   admin_empresa    → admin_sucursal / agente / residente de SU empresa
 *   admin_sucursal   → admin_sucursal / agente / residente de SU sucursal
 *
 * Nadie se da de baja a sí mismo. Antes el UPDATE no filtraba nada: un admin de
 * sucursal de la empresa X podía desactivar al owner o a los admins de otras
 * empresas con sólo conocer el UUID.
 */
export const deleteUsuario = async (req: Request, res: Response) => {
  const { id } = req.params;
  const user = req.user!;
  try {
    const result = await pool.query(
      `UPDATE usuarios u SET activo = FALSE
        WHERE u.id = $1
          AND u.id <> $2
          AND u.activo = TRUE
          AND (
            ($3::text = 'owner' AND u.rol <> 'owner')
            OR ($3::text = 'admin_empresa'
                AND u.rol IN ('admin_sucursal', 'agente', 'residente')
                AND EXISTS (SELECT 1 FROM sucursales s WHERE s.id = u.sucursal_id AND s.empresa_id = $4))
            OR ($3::text = 'admin_sucursal'
                AND u.rol IN ('admin_sucursal', 'agente', 'residente')
                AND u.sucursal_id = $5)
          )
        RETURNING u.id, u.nombre, u.email, u.rol, u.activo`,
      [id, user.id, ...ownershipParams(user)]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Usuario no encontrado o sin acceso' });
    }
    // Sin refresh token no renueva la sesión, y el access token vigente se corta ya.
    await revocarSesionesDeUsuario(pool, id);
    revocarAccesoDeUsuario(id);
    res.json(result.rows[0]);
  } catch (error) {
    serverError(res, error, 'Error al eliminar usuario');
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

  const correo = email.trim().toLowerCase();
  const problemaPassword = validarPassword(password, correo);
  if (problemaPassword) return res.status(400).json({ error: problemaPassword });

  // La sucursal sale del JWT; owner/admin_empresa deben indicarla y se comprueba
  // que sea de su alcance (antes se aceptaba cualquier sucursal_id del body).
  const sucResuelta = await resolverSucursal(user, req.body.sucursal_id, pool);
  if (sucResuelta.ok === false) {
    return res.status(sucResuelta.status).json({ error: sucResuelta.error });
  }
  const resolvedSucursalId = sucResuelta.id;

  const sucCheck = await pool.query(
    'SELECT empresa_id FROM sucursales WHERE id = $1',
    [resolvedSucursalId]
  );
  const resolvedEmpresaId: string | null = sucCheck.rows[0]?.empresa_id ?? user.empresa_id;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const userResult = await client.query(
      `INSERT INTO usuarios (nombre, email, password_hash, rol, sucursal_id, empresa_id, activo)
       VALUES ($1, $2, crypt($3, gen_salt('bf', ${BCRYPT_COST})), $4, $5, $6, TRUE)
       RETURNING id, nombre, email, rol, sucursal_id, empresa_id, activo, created_at`,
      [nombre.trim(), correo, password, rol, resolvedSucursalId, resolvedEmpresaId]
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
    serverError(res, err, 'Error al crear usuario');
  } finally {
    client.release();
  }
};

const IDIOMAS = ['es', 'en'];
const TEMAS   = ['dark', 'light'];

/**
 * Actualiza las preferencias propias. Acepta un campo o los dos.
 *
 * Antes exigía idioma Y tema a la vez, y eso obligaba a quien sólo cambiaba uno
 * a inventar el otro. El selector de idioma leía el tema de localStorage y, al
 * iniciar sesión, lo leía antes de que el tema del perfil llegara a escribirse:
 * mandaba el valor por defecto y pisaba en la base la preferencia real del
 * usuario. Al aceptar parciales, cada preferencia viaja sola y no puede
 * sobrescribir a la otra.
 */
export const updatePreferencias = async (req: Request, res: Response) => {
  const { idioma, tema } = req.body ?? {};

  if (idioma === undefined && tema === undefined) {
    return res.status(400).json({ error: 'Indica al menos idioma o tema' });
  }
  if (idioma !== undefined && !IDIOMAS.includes(idioma)) {
    return res.status(400).json({ error: `idioma debe ser uno de: ${IDIOMAS.join(', ')}` });
  }
  if (tema !== undefined && !TEMAS.includes(tema)) {
    return res.status(400).json({ error: `tema debe ser uno de: ${TEMAS.join(', ')}` });
  }

  try {
    await pool.query(
      `UPDATE usuarios
          SET idioma = COALESCE($1, idioma),
              tema   = COALESCE($2, tema)
        WHERE id = $3`,
      [idioma ?? null, tema ?? null, req.user!.id]
    );
    res.json({ message: 'Preferencias actualizadas' });
  } catch (error) {
    serverError(res, error, 'Error al actualizar preferencias');
  }
};
