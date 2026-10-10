/**
 * Verificación en dos pasos (TOTP) de los administradores — SCRUM-123.
 *
 * Flujo de activación (sesión iniciada): `iniciar` entrega el secreto y la URL para el QR → la persona lo escanea con su
 * app de autenticación → `confirmar` con el primer código la activa y entrega, UNA vez, los 10 códigos de recuperación.
 *
 * Flujo de ingreso: `login` (auth.controller) responde `{ requiere_2fa, desafio }` en vez de la sesión; `verificar` canjea
 * el desafío más un código (TOTP o de recuperación) por la sesión.
 *
 * Intentos: cada comprobación de código —en el ingreso, al confirmar, al desactivar— pasa por `comprobarCodigo`, que lleva
 * la cuenta POR PERSONA en la base (5 fallos en 15 min → 15 min bloqueada), sin importar desde cuántas IPs lleguen; además
 * cada ruta tiene su límite de tasa. Un código TOTP vale una sola vez (`ultimo_paso`) y uno de recuperación también.
 *
 * Los códigos y el secreto jamás van a `audit_logs`: el detalle sólo dice por qué vía entró o por qué falló.
 *
 * Estados HTTP: las rutas con sesión responden 400 —nunca 401— cuando el código o la contraseña están mal, porque el
 * cliente trata todo 401 como «sesión vencida» y sacaría a la persona de la pantalla.
 */
import { Request, Response } from 'express';
import type { PoolClient } from 'pg';
import pool from '../db/pool';
import { serverError } from '../utils/http';
import { bloqueoDeUsuario, responderBloqueo } from '../utils/suspension';
import { emitirSesion } from './auth.controller';
import {
  BLOQUEO_MIN, MAX_INTENTOS, VENTANA_INTENTOS_MIN,
  cifrarSecreto, descifrarSecreto, esCodigoTotp, generarCodigosRecuperacion, hashCodigoRecuperacion, leerDesafio,
  limpiarCodigo, normalizarCodigoRecuperacion, nuevoSecreto, urlOtpauth, verificarTotp,
} from '../utils/twofa';

interface Fila2fa {
  secreto_cifrado: string;
  activado: boolean;
  activado_en: Date | null;
  ultimo_paso: string | null;
  bloqueado: boolean;
  espera_s: number | null;
}

/** Columnas de estado de bloqueo que acompañan a la fila (`f` = usuario_2fa). */
const COLUMNAS_2FA = `f.secreto_cifrado, f.activado, f.activado_en, f.ultimo_paso,
       (f.bloqueado_hasta IS NOT NULL AND f.bloqueado_hasta > NOW()) AS bloqueado,
       GREATEST(CEIL(EXTRACT(EPOCH FROM (f.bloqueado_hasta - NOW())))::int, 0) AS espera_s`;

const leer2fa = async (usuarioId: string): Promise<Fila2fa | undefined> =>
  (await pool.query<Fila2fa>(`SELECT ${COLUMNAS_2FA} FROM usuario_2fa f WHERE f.usuario_id = $1`, [usuarioId])).rows[0];

/** `ok`: el código valió (y por qué vía); si no, `motivo` dice si fue un código errado o la persona está bloqueada. */
interface Veredicto {
  ok: boolean;
  via?: 'totp' | 'recuperacion';
  motivo?: 'incorrecto' | 'bloqueado';
  espera_s?: number;
}

/** Cuenta un fallo; al llegar al tope bloquea a la persona. El fallo que dispara el bloqueo ya responde «bloqueado». */
const registrarFallo = async (usuarioId: string): Promise<Veredicto> => {
  const r = await pool.query<{ intentos_fallidos: number }>(
    `UPDATE usuario_2fa
        SET intentos_fallidos = CASE WHEN ultimo_fallo_en IS NOT NULL AND ultimo_fallo_en > NOW() - make_interval(mins => $2::int)
                                     THEN intentos_fallidos + 1 ELSE 1 END,
            ultimo_fallo_en = NOW()
      WHERE usuario_id = $1
      RETURNING intentos_fallidos`,
    [usuarioId, VENTANA_INTENTOS_MIN],
  );
  if ((r.rows[0]?.intentos_fallidos ?? 0) >= MAX_INTENTOS) {
    await pool.query(
      `UPDATE usuario_2fa
          SET bloqueado_hasta = NOW() + make_interval(mins => $2::int), intentos_fallidos = 0, ultimo_fallo_en = NULL
        WHERE usuario_id = $1`,
      [usuarioId, BLOQUEO_MIN],
    );
    return { ok: false, motivo: 'bloqueado', espera_s: BLOQUEO_MIN * 60 };
  }
  return { ok: false, motivo: 'incorrecto' };
};

const olvidarFallos = (usuarioId: string) =>
  pool.query('UPDATE usuario_2fa SET intentos_fallidos = 0, ultimo_fallo_en = NULL, bloqueado_hasta = NULL WHERE usuario_id = $1', [usuarioId]);

const secretoDe = (fila: Pick<Fila2fa, 'secreto_cifrado'>, usuarioId: string): string => {
  try {
    return descifrarSecreto(fila.secreto_cifrado, usuarioId);
  } catch (err) {
    // Casi siempre es que cambió JWT_SECRET (o TWOFA_KEY) sin conservar la llave anterior: se dice claro en el log del servidor.
    console.error('[2fa] no se pudo descifrar el secreto de una cuenta; ¿cambió JWT_SECRET o TWOFA_KEY? Hay que restablecer su verificación.', { usuario: usuarioId });
    throw err;
  }
};

/**
 * Comprueba un código de la persona. `aceptaRecuperacion`: además del TOTP vale uno de recuperación (ingreso y desactivar).
 * Un código correcto reinicia la cuenta de fallos; uno incorrecto la suma; con la persona bloqueada ni se mira el código.
 */
const comprobarCodigo = async (
  usuarioId: string, fila: Pick<Fila2fa, 'secreto_cifrado' | 'ultimo_paso' | 'bloqueado' | 'espera_s'>,
  codigoCrudo: unknown, aceptaRecuperacion: boolean,
): Promise<Veredicto> => {
  if (fila.bloqueado) return { ok: false, motivo: 'bloqueado', espera_s: fila.espera_s ?? BLOQUEO_MIN * 60 };
  const codigo = limpiarCodigo(codigoCrudo);

  if (esCodigoTotp(codigo)) {
    const r = verificarTotp(secretoDe(fila, usuarioId), codigo, fila.ultimo_paso);
    if (r.valido && r.paso !== undefined) {
      // El paso se reclama de forma atómica: dos peticiones simultáneas con el mismo código no pasan las dos.
      const reclamado = await pool.query(
        `UPDATE usuario_2fa
            SET ultimo_paso = $2, intentos_fallidos = 0, ultimo_fallo_en = NULL, bloqueado_hasta = NULL
          WHERE usuario_id = $1 AND (ultimo_paso IS NULL OR ultimo_paso < $2)`,
        [usuarioId, r.paso],
      );
      if (reclamado.rowCount === 1) return { ok: true, via: 'totp' };
    }
  } else if (aceptaRecuperacion) {
    const normalizado = normalizarCodigoRecuperacion(codigo);
    if (normalizado) {
      const usado = await pool.query(
        `UPDATE usuario_2fa_recuperacion SET usado_en = NOW()
          WHERE usuario_id = $1 AND codigo_hash = $2 AND usado_en IS NULL`,
        [usuarioId, hashCodigoRecuperacion(normalizado)],
      );
      if (usado.rowCount === 1) {
        await olvidarFallos(usuarioId);
        return { ok: true, via: 'recuperacion' };
      }
    }
  }
  return registrarFallo(usuarioId);
};

/** Respuesta de un código rechazado: 429 con la espera si la persona quedó bloqueada; si no, `estadoIncorrecto`. */
const rechazar = (res: Response, v: Veredicto, estadoIncorrecto: number) => {
  res.locals.auditoria = { motivo: v.motivo === 'bloqueado' ? 'bloqueado' : 'codigo_incorrecto' };
  if (v.motivo === 'bloqueado') {
    const espera = v.espera_s ?? BLOQUEO_MIN * 60;
    res.setHeader('Retry-After', String(espera));
    return res.status(429).json({
      error: `Demasiados intentos con el código; espera ${Math.ceil(espera / 60)} minutos`,
      codigo: 'BLOQUEADO', espera_s: espera,
    });
  }
  return res.status(estadoIncorrecto).json({ error: 'El código no es correcto', codigo: 'CODIGO_INCORRECTO' });
};

/** Reemplaza los códigos de recuperación de la persona por los nuevos (guarda sólo su HMAC). */
const guardarCodigos = async (db: PoolClient, usuarioId: string, codigos: string[]): Promise<void> => {
  await db.query('DELETE FROM usuario_2fa_recuperacion WHERE usuario_id = $1', [usuarioId]);
  await db.query(
    'INSERT INTO usuario_2fa_recuperacion (usuario_id, codigo_hash) SELECT $1, unnest($2::text[])',
    [usuarioId, codigos.map(c => hashCodigoRecuperacion(normalizarCodigoRecuperacion(c) as string))],
  );
};

const enTransaccion = async (trabajo: (db: PoolClient) => Promise<void>): Promise<void> => {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    await trabajo(db);
    await db.query('COMMIT');
  } catch (err) {
    await db.query('ROLLBACK').catch(() => { /* ya se informa el error original */ });
    throw err;
  } finally {
    db.release();
  }
};

const YA_ACTIVA = { error: 'La verificación en dos pasos ya está activa. Desactívala primero si quieres configurarla de nuevo.', codigo: 'YA_ACTIVA' };
const NO_ACTIVA = { error: 'La verificación en dos pasos no está activa', codigo: 'NO_ACTIVA' };

// ── Con sesión: la persona administra su propio segundo factor ────────────────────────────────

/** GET /auth/2fa/estado */
export const estado = async (req: Request, res: Response) => {
  const u = req.user!;
  try {
    const fila = await leer2fa(u.id);
    const activado = fila?.activado === true;
    const restantes = activado
      ? (await pool.query<{ n: number }>('SELECT count(*)::int AS n FROM usuario_2fa_recuperacion WHERE usuario_id = $1 AND usado_en IS NULL', [u.id])).rows[0].n
      : 0;
    res.json({ activado, activado_en: activado ? fila!.activado_en : null, codigos_restantes: restantes });
  } catch (error) {
    serverError(res, error, 'Error al consultar la verificación en dos pasos');
  }
};

/** POST /auth/2fa/iniciar — genera un secreto nuevo (reemplaza uno a medio configurar) y lo entrega para el QR. */
export const iniciar = async (req: Request, res: Response) => {
  const u = req.user!;
  try {
    const secreto = nuevoSecreto();
    // Sólo se pisa una configuración SIN confirmar: la activa no se toca (primero hay que desactivarla).
    const r = await pool.query(
      `INSERT INTO usuario_2fa (usuario_id, secreto_cifrado) VALUES ($1, $2)
       ON CONFLICT (usuario_id) DO UPDATE SET secreto_cifrado = EXCLUDED.secreto_cifrado, ultimo_paso = NULL
         WHERE usuario_2fa.activado = FALSE`,
      [u.id, cifrarSecreto(secreto, u.id)],
    );
    if (r.rowCount === 0) return res.status(409).json(YA_ACTIVA);
    res.json({ secreto, otpauth_url: urlOtpauth(secreto, u.email) });
  } catch (error) {
    serverError(res, error, 'Error al iniciar la verificación en dos pasos');
  }
};

/** POST /auth/2fa/confirmar { codigo } — con el primer código válido queda activa y se entregan los códigos de recuperación. */
export const confirmar = async (req: Request, res: Response) => {
  const u = req.user!;
  try {
    const fila = await leer2fa(u.id);
    if (!fila) return res.status(409).json({ error: 'Primero inicia la configuración para obtener el código QR', codigo: 'SIN_INICIAR' });
    if (fila.activado) return res.status(409).json(YA_ACTIVA);

    const v = await comprobarCodigo(u.id, fila, req.body?.codigo, false);
    if (!v.ok) return rechazar(res, v, 400);

    const codigos = generarCodigosRecuperacion();
    await enTransaccion(async db => {
      await db.query('UPDATE usuario_2fa SET activado = TRUE, activado_en = NOW() WHERE usuario_id = $1 AND activado = FALSE', [u.id]);
      await guardarCodigos(db, u.id, codigos);
    });
    res.json({ activado: true, codigos_recuperacion: codigos });
  } catch (error) {
    serverError(res, error, 'Error al activar la verificación en dos pasos');
  }
};

/** POST /auth/2fa/desactivar { password, codigo } — pide la contraseña Y un código (TOTP o de recuperación). */
export const desactivar = async (req: Request, res: Response) => {
  const u = req.user!;
  try {
    const fila = await leer2fa(u.id);
    if (!fila?.activado) return res.status(409).json(NO_ACTIVA);

    const password = req.body?.password;
    if (typeof password !== 'string' || password.length === 0 || password.length > 100) {
      return res.status(400).json({ error: 'Escribe tu contraseña para desactivarla', codigo: 'PASSWORD_REQUERIDA' });
    }
    // La contraseña se comprueba primero: una contraseña errada no gasta intentos del segundo factor.
    const clave = await pool.query<{ ok: boolean }>('SELECT crypt($1, password_hash) = password_hash AS ok FROM usuarios WHERE id = $2', [password, u.id]);
    if (clave.rows[0]?.ok !== true) {
      res.locals.auditoria = { motivo: 'password_incorrecta' };
      return res.status(400).json({ error: 'La contraseña no es correcta', codigo: 'PASSWORD_INCORRECTA' });
    }

    const v = await comprobarCodigo(u.id, fila, req.body?.codigo, true);
    if (!v.ok) return rechazar(res, v, 400);

    await enTransaccion(async db => {
      await db.query('DELETE FROM usuario_2fa_recuperacion WHERE usuario_id = $1', [u.id]);
      await db.query('DELETE FROM usuario_2fa WHERE usuario_id = $1', [u.id]);
    });
    res.locals.auditoria = { via: v.via };
    res.json({ activado: false });
  } catch (error) {
    serverError(res, error, 'Error al desactivar la verificación en dos pasos');
  }
};

/** POST /auth/2fa/codigos-recuperacion { codigo } — nuevos códigos (los anteriores dejan de valer); exige un código TOTP. */
export const regenerarCodigos = async (req: Request, res: Response) => {
  const u = req.user!;
  try {
    const fila = await leer2fa(u.id);
    if (!fila?.activado) return res.status(409).json(NO_ACTIVA);

    const v = await comprobarCodigo(u.id, fila, req.body?.codigo, false);
    if (!v.ok) return rechazar(res, v, 400);

    const codigos = generarCodigosRecuperacion();
    await enTransaccion(db => guardarCodigos(db, u.id, codigos));
    res.json({ codigos_recuperacion: codigos });
  } catch (error) {
    serverError(res, error, 'Error al generar los códigos de recuperación');
  }
};

// ── Sin sesión: segundo paso del ingreso ──────────────────────────────────────────────────────

/** POST /auth/2fa/verificar { desafio, codigo } — canjea el desafío del login por la sesión. */
export const verificar = async (req: Request, res: Response) => {
  const usuarioId = leerDesafio(req.body?.desafio);
  if (!usuarioId) {
    res.locals.auditoria = { motivo: 'desafio_invalido' };
    return res.status(401).json({ error: 'La verificación venció. Inicia sesión de nuevo.', codigo: 'DESAFIO_INVALIDO' });
  }
  // Desde aquí la fila de auditoría lleva a la persona, salga bien o mal.
  res.locals.auditoriaUsuarioId = usuarioId;

  try {
    const r = await pool.query(
      `SELECT u.id, u.nombre, u.email, u.rol, u.sucursal_id, u.empresa_id, u.idioma, u.tema, u.activo,
              s.empresa_id AS empresa_id_via_sucursal,
              ${COLUMNAS_2FA}
         FROM usuarios u
         JOIN usuario_2fa f ON f.usuario_id = u.id AND f.activado = TRUE
         LEFT JOIN sucursales s ON s.id = u.sucursal_id
        WHERE u.id = $1`,
      [usuarioId],
    );
    const fila = r.rows[0];
    if (!fila || fila.activo === false) {
      res.locals.auditoria = { motivo: 'cuenta_no_disponible' };
      return res.status(401).json({ error: 'La verificación venció. Inicia sesión de nuevo.', codigo: 'DESAFIO_INVALIDO' });
    }
    res.locals.auditoriaSucursalId = fila.sucursal_id ?? null;

    // La empresa pudo suspenderse en los minutos entre la contraseña y el código.
    const bloqueo = await bloqueoDeUsuario(pool, { rol: fila.rol, empresa_id: fila.empresa_id ?? fila.empresa_id_via_sucursal ?? null, sucursal_id: fila.sucursal_id });
    if (bloqueo) {
      res.locals.auditoria = { motivo: bloqueo.codigo };
      return responderBloqueo(res, bloqueo);
    }

    const v = await comprobarCodigo(usuarioId, fila, req.body?.codigo, true);
    if (!v.ok) return rechazar(res, v, 401);

    res.locals.auditoria = { via: v.via };
    const { secreto_cifrado: _s, activado: _a, activado_en: _e, ultimo_paso: _p, bloqueado: _b, espera_s: _w, activo: _u, ...usuario } = fila;
    await emitirSesion(req, res, usuario);
  } catch (error) {
    serverError(res, error, 'Error al verificar el código');
  }
};
