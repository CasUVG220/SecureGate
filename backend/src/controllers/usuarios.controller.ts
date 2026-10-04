import { Request, Response } from 'express';
import pool from '../db/pool';
import { alcanceSobreUsuarios, ownershipParams, resolverSucursal } from '../utils/tenant';
import { validarPassword, BCRYPT_COST } from '../utils/password';
import { revocarAccesoDeUsuario } from '../utils/revocacion';
import { revocarSesionesDeUsuario } from './auth.controller';
import { serverError, esUuid, esConflictoUnico } from '../utils/http';
import { puedeUsar2fa } from '../utils/twofa';

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
              s.nombre AS sucursal_nombre,
              (f.usuario_id IS NOT NULL) AS dos_pasos
         FROM usuarios u
         LEFT JOIN sucursales s ON s.id = u.sucursal_id
         LEFT JOIN usuario_2fa f ON f.usuario_id = u.id AND f.activado = TRUE
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

/**
 * DELETE /usuarios/:id/2fa — restablece la verificación en dos pasos de alguien que perdió el teléfono Y los códigos de
 * recuperación (SCRUM-123). Mismo alcance que la baja (`alcanceSobreUsuarios`); fuera de él responde 404. Nadie restablece
 * la propia: eso se hace con la contraseña y un código (POST /auth/2fa/desactivar).
 *
 * Cierra las sesiones de la persona: quien pide un restablecimiento a veces lo hace porque el teléfono se perdió o se lo
 * robaron, y una sesión abierta no debe sobrevivir. La persona entra sólo con su contraseña y puede volver a activarla.
 * Al owner no lo restablece nadie desde la aplicación (ver docs/verificacion_dos_pasos.md: se hace desde la consola).
 */
export const restablecerDosPasos = async (req: Request, res: Response) => {
  const { id } = req.params;
  const user = req.user!;
  if (!esUuid(id)) return res.status(400).json({ error: 'id de usuario inválido' });
  if (id === user.id) {
    return res.status(400).json({ error: 'Para desactivar la tuya usa tu cuenta: se pide tu contraseña y un código' });
  }
  try {
    const r = await pool.query<{ id: string; tenia: boolean }>(
      `WITH objetivo AS (
         SELECT u.id FROM usuarios u WHERE u.id = $1 AND ${alcanceSobreUsuarios('u', 2)}
       ), codigos AS (
         DELETE FROM usuario_2fa_recuperacion c USING objetivo o WHERE c.usuario_id = o.id
       ), borrada AS (
         DELETE FROM usuario_2fa f USING objetivo o WHERE f.usuario_id = o.id RETURNING f.usuario_id
       )
       SELECT o.id, EXISTS (SELECT 1 FROM borrada) AS tenia FROM objetivo o`,
      [id, ...ownershipParams(user)],
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'Usuario no encontrado o sin acceso' });
    if (!r.rows[0].tenia) return res.status(409).json({ error: 'Esta persona no tiene la verificación en dos pasos activada' });

    await revocarSesionesDeUsuario(pool, id);
    revocarAccesoDeUsuario(id);
    res.locals.auditoria = { sesiones_cerradas: true };
    res.json({ restablecido: true });
  } catch (error) {
    serverError(res, error, 'Error al restablecer la verificación en dos pasos');
  }
};

/** Roles que se pueden asignar al editar a alguien del personal (los demás tienen su propio flujo). */
const ROLES_ASIGNABLES = ['agente', 'admin_sucursal'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Edición de un usuario del personal: nombre, correo, rol y, opcionalmente,
 * contraseña nueva. Mismo alcance que la baja (`deleteUsuario`):
 *
 *   owner            → cualquiera menos otro owner
 *   admin_empresa    → admin_sucursal / agente / residente de SU empresa
 *   admin_sucursal   → admin_sucursal / agente / residente de SU sucursal
 *
 * - Un objetivo fuera del alcance responde 404 (igual que no existente), para no
 *   confirmar que el UUID existe en otra empresa.
 * - Nadie se edita a sí mismo por aquí (cambiar el propio rol o contraseña sin
 *   pedir la actual abriría una escalada o un robo de sesión persistente).
 * - Solo se puede pasar de `agente` a `admin_sucursal` y al revés. El resto de
 *   roles (owner, admin_empresa, residente) no cambia de rol en esta ruta.
 * - Cambiar la contraseña cierra todas sus sesiones (refresh tokens + access
 *   token); cambiar el rol invalida el access token vigente, que lleva el rol
 *   viejo, y el siguiente refresh trae el nuevo.
 * - La auditoría deja `USUARIO_EDITADO` con usuario, IP y la lista de campos
 *   que cambiaron. La contraseña nunca se registra, ni siquiera cifrada.
 */
export const updateUsuario = async (req: Request, res: Response) => {
  const { id } = req.params;
  const user = req.user!;
  const body = (req.body ?? {}) as Record<string, unknown>;

  if (!esUuid(id)) return res.status(400).json({ error: 'id de usuario inválido' });
  if (id === user.id) {
    return res.status(400).json({ error: 'No puedes editar tu propio usuario desde aquí' });
  }

  const { nombre, email, rol, password } = body;
  for (const [campo, valor] of Object.entries({ nombre, email, rol, password })) {
    if (valor !== undefined && typeof valor !== 'string') {
      return res.status(400).json({ error: `${campo} debe ser texto` });
    }
  }
  if (nombre === undefined && email === undefined && rol === undefined && password === undefined) {
    return res.status(400).json({ error: 'Indica al menos un campo a modificar: nombre, email, rol o password' });
  }

  const nombreLimpio = typeof nombre === 'string' ? nombre.trim() : undefined;
  if (nombreLimpio !== undefined && (nombreLimpio.length === 0 || nombreLimpio.length > 100)) {
    return res.status(400).json({ error: 'El nombre es requerido y no puede superar 100 caracteres' });
  }
  const correo = typeof email === 'string' ? email.trim().toLowerCase() : undefined;
  if (correo !== undefined && (!EMAIL_RE.test(correo) || correo.length > 150)) {
    return res.status(400).json({ error: 'El correo no es válido' });
  }
  if (typeof rol === 'string' && !ROLES_ASIGNABLES.includes(rol)) {
    return res.status(400).json({ error: `Rol no permitido: ${rol}. Usa uno de: ${ROLES_ASIGNABLES.join(', ')}` });
  }
  // Una cadena vacía en `password` significa «no cambiar»: el formulario la manda así.
  const passwordNueva = typeof password === 'string' && password.length > 0 ? password : undefined;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const actual = await client.query(
      `SELECT u.id, u.nombre, u.email, u.rol, u.sucursal_id, u.empresa_id, u.activo
         FROM usuarios u
        WHERE u.id = $1
          AND (
            ($2::text = 'owner' AND u.rol <> 'owner')
            OR ($2::text = 'admin_empresa'
                AND u.rol IN ('admin_sucursal', 'agente', 'residente')
                AND EXISTS (SELECT 1 FROM sucursales s WHERE s.id = u.sucursal_id AND s.empresa_id = $3))
            OR ($2::text = 'admin_sucursal'
                AND u.rol IN ('admin_sucursal', 'agente', 'residente')
                AND u.sucursal_id = $4)
          )
        FOR UPDATE OF u`,
      [id, ...ownershipParams(user)],
    );
    if (actual.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Usuario no encontrado o sin acceso' });
    }
    const previo = actual.rows[0] as { rol: string; nombre: string; email: string };

    const cambiaRol = typeof rol === 'string' && rol !== previo.rol;
    if (cambiaRol && !(ROLES_ASIGNABLES.includes(previo.rol) && ROLES_ASIGNABLES.includes(rol as string))) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'El rol de este usuario no se puede cambiar' });
    }
    if (passwordNueva !== undefined) {
      const problema = validarPassword(passwordNueva, correo ?? previo.email);
      if (problema) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: problema });
      }
    }

    const cambios: string[] = [];
    if (nombreLimpio !== undefined && nombreLimpio !== previo.nombre) cambios.push('nombre');
    if (correo !== undefined && correo !== previo.email) cambios.push('email');
    if (cambiaRol) cambios.push('rol');
    if (passwordNueva !== undefined) cambios.push('password');

    const result = await client.query(
      `UPDATE usuarios
          SET nombre = COALESCE($2, nombre),
              email  = COALESCE($3, email),
              rol    = COALESCE($4, rol),
              password_hash = CASE WHEN $5::text IS NULL THEN password_hash
                                   ELSE crypt($5::text, gen_salt('bf', ${BCRYPT_COST})) END
        WHERE id = $1
        RETURNING id, nombre, email, rol, sucursal_id, empresa_id, activo, created_at`,
      [id, nombreLimpio ?? null, correo ?? null, cambiaRol ? rol : null, passwordNueva ?? null],
    );
    // Un rol que ya no puede usar la verificación en dos pasos (administrador → agente de garita) se queda sin ella: la app de
    // escritorio no tiene segundo paso y la web no admite agentes, así que con el segundo factor activo la persona quedaría
    // atrapada sin poder entrar a ningún lado hasta que alguien se lo restablezca (SCRUM-123). Lo hace quien la degrada, que
    // ya tiene autoridad sobre la cuenta; bajar de rol por SQL o por otra vía NO lo quita (el ingreso lo sigue exigiendo).
    let dosPasosQuitada = false;
    if (cambiaRol && !puedeUsar2fa(rol as string)) {
      await client.query('DELETE FROM usuario_2fa_recuperacion WHERE usuario_id = $1', [id]);
      dosPasosQuitada = ((await client.query('DELETE FROM usuario_2fa WHERE usuario_id = $1', [id])).rowCount ?? 0) > 0;
    }
    await client.query('COMMIT');

    if (passwordNueva !== undefined) {
      await revocarSesionesDeUsuario(pool, id);
      revocarAccesoDeUsuario(id);
    } else if (cambiaRol) {
      revocarAccesoDeUsuario(id);
    }

    res.locals.auditoria = {
      campos: cambios,
      ...(cambiaRol ? { rol_anterior: previo.rol, rol_nuevo: rol } : {}),
      ...(dosPasosQuitada ? { dos_pasos_quitada: true } : {}),
    };
    res.json(result.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    if (esConflictoUnico((err as { code?: string }).code)) {
      return res.status(409).json({ error: 'El email ya está registrado' });
    }
    serverError(res, err, 'Error al editar usuario');
  } finally {
    client.release();
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
