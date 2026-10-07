import { Request, Response } from 'express';
import pool from '../db/pool';
import { esUuid } from '../utils/http';
import { revocarAccesoDeEmpresa, revocarAccesoDeUsuario } from '../utils/revocacion';
import { revocarSesionesDeUsuario } from './auth.controller';
import { serverError } from '../utils/http';

export const getEmpresas = async (_req: Request, res: Response) => {
  try {
    const result = await pool.query(
      // Sin filtrar por activo: es la vista del owner, que necesita ver (y
      // poder reactivar) las empresas dadas de baja o suspendidas.
      // `tiene_admin` / `invitacion_pendiente` alimentan el aviso «sin administrador»:
      // una empresa recién creada no sirve de nada hasta que alguien la administre.
      `SELECT e.*, COUNT(s.id)::int AS total_sucursales,
              EXISTS (SELECT 1 FROM usuarios a
                       WHERE a.empresa_id = e.id AND a.rol = 'admin_empresa' AND a.activo = TRUE) AS tiene_admin,
              EXISTS (SELECT 1 FROM invitaciones i
                       WHERE i.empresa_id = e.id AND i.rol_invitado = 'admin_empresa'
                         AND i.estado = 'pendiente' AND i.expira_en > NOW()) AS invitacion_pendiente
       FROM empresas e
       LEFT JOIN sucursales s ON s.empresa_id = e.id AND s.activo = TRUE
       GROUP BY e.id
       ORDER BY e.activo DESC, e.suspendida ASC, e.created_at DESC`
    );
    res.json(result.rows);
  } catch (error) {
    serverError(res, error, 'Error al obtener empresas');
  }
};

/**
 * El logo se pinta como <img src>. Se acepta:
 *   - una URL http(s) razonable (las que ya existían), o
 *   - una imagen subida como archivo: data URI PNG / JPEG / WebP en base64 de hasta 200 KB (el navegador la reescala
 *     antes de enviarla). Nada de SVG: puede llevar scripts y aquí no hay motivo para aceptarlo.
 */
const LOGO_URL_RE = /^https?:\/\/[^\s"'<>]{4,500}$/i;
const LOGO_DATA_RE = /^data:image\/(?:png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/;
export const LOGO_MAX_BYTES = 200 * 1024;

const logoInvalido = (v: unknown): boolean => {
  if (v === undefined || v === null || v === '') return false;
  if (typeof v !== 'string') return true;
  if (LOGO_URL_RE.test(v)) return false;
  const m = LOGO_DATA_RE.exec(v);
  if (!m) return true;
  const relleno = (m[1].match(/=+$/)?.[0].length ?? 0);
  return Math.floor((m[1].length * 3) / 4) - relleno > LOGO_MAX_BYTES;
};

const ERROR_LOGO = 'El logo debe ser una URL http(s) o una imagen PNG, JPG o WebP de hasta 200 KB';

export const createEmpresa = async (req: Request, res: Response) => {
  const { nombre, nit, logo_url } = req.body;
  if (!nombre) {
    return res.status(400).json({ error: 'Campo requerido: nombre' });
  }
  if (logoInvalido(logo_url)) {
    return res.status(400).json({ error: ERROR_LOGO });
  }

  try {
    const result = await pool.query(
      `INSERT INTO empresas (nombre, nit, logo_url)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [nombre, nit ?? null, logo_url ?? null]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    serverError(res, error, 'Error al crear empresa');
  }
};


/**
 * Cierra las sesiones vivas de todos los usuarios de la empresa (admins,
 * agentes y residentes de sus sucursales). Los access tokens caducan solos
 * en ≤ 1 h; sin refresh no vuelven a entrar.
 */
export const revocarSesionesDeEmpresa = async (db: import('pg').PoolClient | import('pg').Pool, empresaId: string) => {
  // Access tokens vigentes de toda la empresa: se cortan ya (utils/revocacion.ts).
  revocarAccesoDeEmpresa(empresaId);
  await db.query(
    `UPDATE refresh_tokens SET revoked = TRUE, revoked_at = NOW()
     WHERE revoked = FALSE AND usuario_id IN (
       SELECT u.id FROM usuarios u
       LEFT JOIN sucursales s ON s.id = u.sucursal_id
       WHERE u.empresa_id = $1 OR s.empresa_id = $1
     )`,
    [empresaId],
  );
};

/**
 * PATCH /empresas/:id/suspender — pausa reversible (impago, incumplimiento).
 * Desde este momento el login y las licencias de garita (activar, heartbeat,
 * sync) de la empresa responden 423 con el motivo; nada se borra ni se
 * desactiva. Las sesiones que YA estaban abiertas se cortan aquí mismo
 * (access tokens y refresh tokens revocados). Su siguiente /auth/refresh responde
 * 423 con el motivo (aunque el token ya esté revocado, S-11): el cliente muestra
 * el aviso en vez de caer al login sin explicación. Con la empresa reactivada
 * ese mismo token sigue revocado y responde 401: hay que iniciar sesión de nuevo.
 */
export const suspenderEmpresa = async (req: Request, res: Response) => {
  const { id } = req.params;
  const motivo = String((req.body as { motivo?: string }).motivo ?? '').trim();
  if (motivo.length < 3 || motivo.length > 300) {
    return res.status(400).json({ error: 'motivo es requerido (3-300 caracteres)' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query(
      `UPDATE empresas SET suspendida = TRUE, suspension_motivo = $2, suspendida_en = NOW()
       WHERE id = $1 AND activo = TRUE RETURNING *`,
      [id, motivo],
    );
    if (r.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Empresa no encontrada o inactiva' });
    }
    await revocarSesionesDeEmpresa(client, id);
    await client.query('COMMIT');
    res.json(r.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    serverError(res, error, 'Error al suspender empresa');
  } finally {
    client.release();
  }
};

/** PATCH /empresas/:id/reactivar — levanta la suspensión. */
export const reactivarEmpresa = async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const r = await pool.query(
      `UPDATE empresas SET suspendida = FALSE, suspension_motivo = NULL, suspendida_en = NULL
       WHERE id = $1 AND suspendida = TRUE RETURNING *`,
      [id],
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'Empresa no encontrada o no está suspendida' });
    res.json(r.rows[0]);
  } catch (error) {
    serverError(res, error, 'Error al reactivar empresa');
  }
};

export const updateEmpresa = async (req: Request, res: Response) => {
  const { id } = req.params;
  const { nombre, nit, logo_url, activo } = req.body;
  if (logoInvalido(logo_url)) {
    return res.status(400).json({ error: ERROR_LOGO });
  }

  // `logo_url` ausente = no se toca; presente pero vacío / null = se quita el logo; con valor = se reemplaza.
  const tocaLogo = Object.prototype.hasOwnProperty.call(req.body, 'logo_url');

  try {
    const result = await pool.query(
      `UPDATE empresas
       SET nombre   = COALESCE($1, nombre),
           nit      = COALESCE($2, nit),
           logo_url = CASE WHEN $3::boolean THEN $4::text ELSE logo_url END,
           activo   = COALESCE($5, activo)
       WHERE id = $6
       RETURNING *`,
      [nombre ?? null, nit ?? null, tocaLogo, logo_url || null, activo ?? null, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Empresa no encontrada' });
    }

    // Desactivar es bloquear el acceso (login/refresh/licencias lo comprueban);
    // las sesiones que ya estaban abiertas se cierran aquí.
    if (activo === false) await revocarSesionesDeEmpresa(pool, id);

    res.json(result.rows[0]);
  } catch (error) {
    serverError(res, error, 'Error al actualizar empresa');
  }
};

export const deleteEmpresa = async (req: Request, res: Response) => {
  const { id } = req.params;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Get all sucursal IDs for this empresa
    const sucRes = await client.query(
      `SELECT id FROM sucursales WHERE empresa_id = $1`,
      [id]
    );
    const sucIds: string[] = sucRes.rows.map((r: { id: string }) => r.id);

    if (sucIds.length > 0) {
      // Deactivate cargos automáticos for residents of these sucursales
      await client.query(
        `UPDATE cargos_automaticos SET aplicado = TRUE
         WHERE residente_id IN (
           SELECT id FROM residentes WHERE sucursal_id = ANY($1::uuid[])
         )`,
        [sucIds]
      );

      // Deactivate preautorizaciones
      await client.query(
        `UPDATE preautorizaciones SET activo = FALSE
         WHERE sucursal_id = ANY($1::uuid[])`,
        [sucIds]
      );

      // Deactivate pagos
      await client.query(
        `UPDATE pagos SET estado = 'rechazado'
         WHERE sucursal_id = ANY($1::uuid[]) AND estado = 'pendiente'`,
        [sucIds]
      );

      // Deactivate residentes
      await client.query(
        `UPDATE residentes SET estado_pago = 'pendiente'
         WHERE sucursal_id = ANY($1::uuid[])`,
        [sucIds]
      );

      // Deactivate all staff users in those sucursales
      await client.query(
        `UPDATE usuarios SET activo = FALSE
         WHERE sucursal_id = ANY($1::uuid[])`,
        [sucIds]
      );

      // Kill switch de los equipos de garita: el siguiente heartbeat falla.
      await client.query(
        `UPDATE licencias_dispositivo SET estado = 'revocada', revocado_en = NOW()
         WHERE sucursal_id = ANY($1::uuid[]) AND estado = 'activa'`,
        [sucIds]
      );

      // Deactivate all sucursales
      await client.query(
        `UPDATE sucursales SET activo = FALSE WHERE empresa_id = $1`,
        [id]
      );
    }

    // Invitaciones administrativas pendientes de la empresa dejan de servir.
    await client.query(
      `UPDATE invitaciones SET estado = 'revocada', revocada_en = NOW()
       WHERE empresa_id = $1 AND estado = 'pendiente'`,
      [id]
    );

    // Sesiones abiertas de cualquiera de la empresa.
    await revocarSesionesDeEmpresa(client, id);

    // Deactivate empresa-level users (admin_empresa)
    await client.query(
      `UPDATE usuarios SET activo = FALSE, empresa_id = NULL
       WHERE empresa_id = $1 AND rol = 'admin_empresa'`,
      [id]
    );

    // Deactivate empresa
    const result = await client.query(
      `UPDATE empresas SET activo = FALSE WHERE id = $1 RETURNING id`,
      [id]
    );

    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Empresa no encontrada' });
    }

    await client.query('COMMIT');
    res.json({ message: 'Empresa y todos sus recursos desactivados', id });
  } catch (error) {
    await client.query('ROLLBACK');
    serverError(res, error, 'Error al eliminar empresa');
  } finally {
    client.release();
  }
};


/**
 * POST /empresas/:id/eliminar-definitivo — borrado físico, irreversible.
 *
 * A diferencia de deleteEmpresa (baja suave), esto elimina la empresa y TODO
 * lo que cuelga de ella: sucursales, usuarios, residentes, accesos, pagos,
 * reservas, tickets, anuncios, licencias de garita, invitaciones… Se
 * conservan `audit_logs` (las FKs hacen SET NULL: queda el rastro de que
 * existió) y los `visitantes`/`vehiculos`, que son globales.
 *
 * Exige la contraseña del owner que lo ejecuta: el JWT no basta para una
 * acción que no se puede deshacer. Las FKs son RESTRICT, así que el orden de
 * los DELETE es el de las dependencias, dentro de una sola transacción.
 */
export const eliminarEmpresaDefinitivo = async (req: Request, res: Response) => {
  const { id } = req.params;
  const { password } = req.body as { password?: string };
  if (!password) return res.status(400).json({ error: 'Se requiere la contraseña del owner' });

  const client = await pool.connect();
  try {
    const owner = await client.query(
      `SELECT 1 FROM usuarios WHERE id = $1 AND rol = 'owner' AND activo = TRUE
         AND password_hash = crypt($2, password_hash)`,
      [req.user!.id, password],
    );
    if (owner.rows.length === 0) {
      return res.status(403).json({ error: 'Contraseña incorrecta' });
    }

    await client.query('BEGIN');
    const emp = await client.query('SELECT id, nombre FROM empresas WHERE id = $1 FOR UPDATE', [id]);
    if (emp.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Empresa no encontrada' });
    }

    const suc = await client.query('SELECT id FROM sucursales WHERE empresa_id = $1', [id]);
    const S: string[] = suc.rows.map((r: { id: string }) => r.id);
    const usr = await client.query(
      'SELECT id FROM usuarios WHERE empresa_id = $1 OR sucursal_id = ANY($2::uuid[])',
      [id, S],
    );
    const U: string[] = usr.rows.map((r: { id: string }) => r.id);
    const resd = await client.query('SELECT id FROM residentes WHERE sucursal_id = ANY($1::uuid[])', [S]);
    const R: string[] = resd.rows.map((r: { id: string }) => r.id);

    // Orden: primero lo que referencia (RESTRICT) a residentes/usuarios/
    // sucursales, luego residentes, usuarios, sucursales y la empresa.
    const pasos: Array<[string, string, unknown[]]> = [
      ['cargos_automaticos',            `DELETE FROM cargos_automaticos WHERE residente_id = ANY($1::uuid[]) OR registro_acceso_id IN (SELECT id FROM registros_acceso WHERE sucursal_id = ANY($2::uuid[]))`, [R, S]],
      ['registros_acceso',              `DELETE FROM registros_acceso WHERE sucursal_id = ANY($1::uuid[]) OR residente_id = ANY($2::uuid[]) OR agente_id = ANY($3::uuid[])`, [S, R, U]],
      ['reservas_areas',                `DELETE FROM reservas_areas WHERE residente_id = ANY($1::uuid[]) OR area_id IN (SELECT id FROM areas_comunes WHERE sucursal_id = ANY($2::uuid[]))`, [R, S]],
      ['areas_comunes',                 `DELETE FROM areas_comunes WHERE sucursal_id = ANY($1::uuid[])`, [S]],
      ['pagos',                         `DELETE FROM pagos WHERE sucursal_id = ANY($1::uuid[]) OR residente_id = ANY($2::uuid[]) OR registrado_por = ANY($3::uuid[])`, [S, R, U]],
      ['cargos_programados_historial',  `DELETE FROM cargos_programados_historial WHERE residente_id = ANY($1::uuid[]) OR aplicado_por = ANY($2::uuid[]) OR cargo_programado_id IN (SELECT id FROM cargos_programados WHERE sucursal_id = ANY($3::uuid[]))`, [R, U, S]],
      ['cargos_programados',            `DELETE FROM cargos_programados WHERE sucursal_id = ANY($1::uuid[]) OR creado_por = ANY($2::uuid[])`, [S, U]],
      ['configuracion_cargos',          `DELETE FROM configuracion_cargos WHERE sucursal_id = ANY($1::uuid[])`, [S]],
      ['invitaciones_qr',               `DELETE FROM invitaciones_qr WHERE sucursal_id = ANY($1::uuid[]) OR residente_id = ANY($2::uuid[])`, [S, R]],
      ['preautorizaciones',             `DELETE FROM preautorizaciones WHERE sucursal_id = ANY($1::uuid[]) OR residente_id = ANY($2::uuid[])`, [S, R]],
      ['tickets',                       `DELETE FROM tickets WHERE sucursal_id = ANY($1::uuid[]) OR residente_id = ANY($2::uuid[])`, [S, R]],
      ['ticket_mensajes',               `DELETE FROM ticket_mensajes WHERE autor_id = ANY($1::uuid[])`, [U]],
      ['anuncios',                      `DELETE FROM anuncios WHERE sucursal_id = ANY($1::uuid[]) OR residente_id = ANY($2::uuid[]) OR creado_por = ANY($3::uuid[])`, [S, R, U]],
      ['visitante_blacklist',           `DELETE FROM visitante_blacklist WHERE sucursal_id = ANY($1::uuid[]) OR creado_por = ANY($2::uuid[])`, [S, U]],
      ['residente_visitante_blacklist', `DELETE FROM residente_visitante_blacklist WHERE residente_id = ANY($1::uuid[]) OR creado_por = ANY($2::uuid[])`, [R, U]],
      ['licencias_dispositivo',         `DELETE FROM licencias_dispositivo WHERE sucursal_id = ANY($1::uuid[])`, [S]],
      ['invitaciones',                  `DELETE FROM invitaciones WHERE empresa_id = $1 OR sucursal_id = ANY($2::uuid[]) OR invitado_por = ANY($3::uuid[]) OR usuario_id = ANY($3::uuid[])`, [id, S, U]],
      ['refresh_tokens',                `DELETE FROM refresh_tokens WHERE usuario_id = ANY($1::uuid[])`, [U]],
      ['residentes',                    `DELETE FROM residentes WHERE id = ANY($1::uuid[])`, [R]],
      ['usuarios',                      `DELETE FROM usuarios WHERE id = ANY($1::uuid[])`, [U]],
      ['sucursales',                    `DELETE FROM sucursales WHERE id = ANY($1::uuid[])`, [S]],
      ['empresas',                      `DELETE FROM empresas WHERE id = $1`, [id]],
    ];
    const eliminado: Record<string, number> = {};
    for (const [tabla, sql, params] of pasos) {
      const r = await client.query(sql, params);
      eliminado[tabla] = r.rowCount ?? 0;
    }
    await client.query('COMMIT');
    res.json({ message: 'Empresa eliminada definitivamente', id, nombre: emp.rows[0].nombre, eliminado });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    serverError(res, error, 'Error al eliminar la empresa definitivamente');
  } finally {
    client.release();
  }
};

export const assignAdminEmpresa = async (req: Request, res: Response) => {
  const { id } = req.params; // empresa_id
  const { usuario_id } = req.body;

  if (!usuario_id) {
    return res.status(400).json({ error: 'Campo requerido: usuario_id' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Verify empresa exists
    const empCheck = await client.query(
      'SELECT id FROM empresas WHERE id = $1 AND activo = TRUE',
      [id]
    );
    if (empCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Empresa no encontrada' });
    }

    // El nuevo admin no puede ser un owner (se le quitaría el rol) ni un
    // residente. Se comprueba ANTES de degradar al admin actual.
    const candidato = await client.query(
      `SELECT id FROM usuarios WHERE id = $1 AND rol IN ('admin_empresa', 'admin_sucursal', 'agente')`,
      [usuario_id]
    );
    if (candidato.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Usuario no encontrado o su rol no permite ser admin de empresa' });
    }

    // Remove current admin_empresa of this empresa (demote to agente)
    const degradados = await client.query(
      `UPDATE usuarios SET rol = 'agente', empresa_id = NULL
       WHERE empresa_id = $1 AND rol = 'admin_empresa' AND id <> $2
       RETURNING id`,
      [id, usuario_id]
    );

    // Assign new admin_empresa
    const result = await client.query(
      `UPDATE usuarios
       SET rol = 'admin_empresa', empresa_id = $1, activo = TRUE
       WHERE id = $2
       RETURNING id, nombre, email, rol, empresa_id`,
      [id, usuario_id]
    );

    await client.query('COMMIT');

    // Los cambios de rol se aplican de inmediato: sesiones cerradas.
    for (const u of [...degradados.rows.map((r: { id: string }) => r.id), usuario_id]) {
      await revocarSesionesDeUsuario(pool, u);
      revocarAccesoDeUsuario(u);
    }
    res.json(result.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    serverError(res, error, 'Error al asignar admin empresa');
  } finally {
    client.release();
  }
};

export const getEmpresaStats = async (req: Request, res: Response) => {
  const { id } = req.params;
  // Un admin de empresa sólo ve las métricas de la suya (antes veía cualquiera).
  if (!esUuid(id) || (req.user!.rol === 'admin_empresa' && req.user!.empresa_id !== id)) {
    return res.status(403).json({ error: 'Sin acceso a esta empresa' });
  }

  try {
    const [
      sucursalesRes,
      residentesRes,
      accesosRes,
      pagosRes,
      sucursalesDetalle,
    ] = await Promise.all([
      pool.query(
        `SELECT COUNT(*)::int AS total
         FROM sucursales
         WHERE empresa_id = $1 AND activo = TRUE`,
        [id]
      ),
      pool.query(
        `SELECT COUNT(DISTINCT r.id)::int AS total
         FROM residentes r
         JOIN sucursales s ON r.sucursal_id = s.id
         WHERE s.empresa_id = $1`,
        [id]
      ),
      pool.query(
        `SELECT COUNT(*)::int AS total
         FROM registros_acceso ra
         JOIN sucursales s ON ra.sucursal_id = s.id
         WHERE s.empresa_id = $1
           AND DATE(ra.timestamp_entrada) = CURRENT_DATE`,
        [id]
      ),
      pool.query(
        `SELECT COUNT(*)::int AS total
         FROM pagos p
         JOIN sucursales s ON p.sucursal_id = s.id
         WHERE s.empresa_id = $1 AND p.estado = 'pendiente'`,
        [id]
      ),
      pool.query(
        `SELECT s.id, s.nombre, COUNT(ra.id)::int AS accesos_hoy
         FROM sucursales s
         LEFT JOIN registros_acceso ra
           ON ra.sucursal_id = s.id
           AND DATE(ra.timestamp_entrada) = CURRENT_DATE
         WHERE s.empresa_id = $1 AND s.activo = TRUE
         GROUP BY s.id, s.nombre
         ORDER BY s.nombre`,
        [id]
      ),
    ]);

    res.json({
      total_sucursales:       sucursalesRes.rows[0].total,
      total_residentes:       residentesRes.rows[0].total,
      total_accesos_hoy:      accesosRes.rows[0].total,
      total_pagos_pendientes: pagosRes.rows[0].total,
      sucursales:             sucursalesDetalle.rows,
    });
  } catch (error) {
    serverError(res, error, 'Error al obtener estadísticas');
  }
};
