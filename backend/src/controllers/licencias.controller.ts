import { Request, Response } from 'express';
import crypto from 'crypto';
import pool from '../db/pool';
import { evaluarEmpresa, mensajeBloqueo, HTTP_BLOQUEO } from '../utils/suspension';
import { tenantFilter, ownershipClause, ownershipParams, resolverSucursal } from '../utils/tenant';
import {
  firmarLicencia, hashFingerprint, validarLicencia,
  LICENCIA_HEADER, HEARTBEAT_INTERVALO_MIN, GRACIA_OFFLINE_HORAS,
} from '../middleware/licencia.middleware';
import { serverError } from '../utils/http';

/**
 * Código legible para dictar por teléfono: 4 grupos de 4, sin caracteres
 * ambiguos (0/O, 1/I/L). 20 símbolos^16 ≈ 6.5e20 combinaciones — no se adivina.
 */
const ALFABETO = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const generarCodigo = (): string => {
  const bytes = crypto.randomBytes(16);
  const chars = Array.from(bytes, b => ALFABETO[b % ALFABETO.length]);
  return `SG-${chars.slice(0, 4).join('')}-${chars.slice(4, 8).join('')}-${chars.slice(8, 12).join('')}-${chars.slice(12, 16).join('')}`;
};

const normalizarCodigo = (c: string) => c.trim().toUpperCase().replace(/\s+/g, '');

/** Fingerprint: hex SHA-256 (64) o al menos algo con forma de hash estable. */
const FINGERPRINT_RE = /^[a-f0-9]{32,128}$/i;

// ── Admin ─────────────────────────────────────────────────────────────────

/** POST /licencias — emite un código de activación para una sucursal. */
export const crearLicencia = async (req: Request, res: Response) => {
  const { etiqueta, sucursal_id: bodySucursalId } = req.body as { etiqueta?: string; sucursal_id?: string };

  const sucResuelta = await resolverSucursal(req.user!, bodySucursalId, pool);
  if (sucResuelta.ok === false) {
    return res.status(sucResuelta.status).json({ error: sucResuelta.error });
  }
  const sucursal_id = sucResuelta.id;

  try {
    // Un admin de empresa sólo emite para sucursales de su empresa (misma
    // regla que ownershipClause, aplicada a la propia fila de sucursales).
    const propia = await pool.query(
      `SELECT 1 FROM sucursales s
       WHERE s.id = $1
         AND ($2::text = 'owner'
              OR ($2::text = 'admin_empresa' AND s.empresa_id = $3)
              OR s.id = $4)`,
      [sucursal_id, ...ownershipParams(req.user!)],
    );
    if (propia.rows.length === 0) {
      return res.status(403).json({ error: 'Sin acceso a esa sucursal' });
    }

    const result = await pool.query(
      `INSERT INTO licencias_dispositivo (sucursal_id, codigo_activacion, etiqueta, creado_por)
       VALUES ($1, $2, $3, $4)
       RETURNING id, sucursal_id, codigo_activacion, etiqueta, estado, created_at`,
      [sucursal_id, generarCodigo(), etiqueta?.trim() || null, req.user!.id],
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    serverError(res, error, 'Error al crear licencia');
  }
};

/** GET /licencias — lista las licencias visibles para el tenant. */
export const getLicencias = async (req: Request, res: Response) => {
  const ts = tenantFilter(req.user!, 'l');
  try {
    const result = await pool.query(
      `SELECT l.id, l.sucursal_id, s.nombre AS sucursal_nombre,
              l.codigo_activacion, l.etiqueta, l.estado,
              (l.fingerprint IS NOT NULL) AS activada,
              l.activado_en, l.ultimo_heartbeat, l.revocado_en, l.created_at
       FROM licencias_dispositivo l
       JOIN sucursales s ON s.id = l.sucursal_id
       ${ts.joinClause}
       WHERE ${ts.whereClause}
       ORDER BY l.created_at DESC`,
      ts.params,
    );
    res.json(result.rows);
  } catch (error) {
    serverError(res, error, 'Error al obtener licencias');
  }
};

/** PATCH /licencias/:id/revocar — kill switch: el siguiente heartbeat falla. */
export const revocarLicencia = async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const result = await pool.query(
      `UPDATE licencias_dispositivo l
       SET estado = 'revocada', revocado_en = NOW()
       WHERE l.id = $1
         AND l.estado = 'activa'
         AND ${ownershipClause('l', 2)}
       RETURNING l.id, l.estado, l.revocado_en`,
      [id, ...ownershipParams(req.user!)],
    );
    if (result.rows.length === 0) {
      const existe = await pool.query('SELECT estado FROM licencias_dispositivo WHERE id = $1', [id]);
      if (existe.rows.length === 0) return res.status(404).json({ error: 'Licencia no encontrada' });
      if (existe.rows[0].estado === 'revocada') return res.status(409).json({ error: 'La licencia ya está revocada' });
      return res.status(403).json({ error: 'Sin acceso a esta licencia' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    serverError(res, error, 'Error al revocar licencia');
  }
};

// ── App de escritorio (sin sesión de usuario) ─────────────────────────────

/**
 * POST /licencias/activar — vincula un código a un dispositivo.
 *
 * El UPDATE condicional (fingerprint IS NULL) es lo que impide que dos
 * máquinas activen el mismo código a la vez: sólo una gana la fila. Reactivar
 * desde la MISMA máquina (reinstalación) sí se permite: devuelve un token
 * nuevo sin cambiar el vínculo.
 */
export const activarLicencia = async (req: Request, res: Response) => {
  const { codigo, fingerprint, nombre_dispositivo } = req.body as {
    codigo?: string; fingerprint?: string; nombre_dispositivo?: string;
  };
  if (!codigo || !fingerprint) {
    return res.status(400).json({ error: 'Campos requeridos: codigo, fingerprint' });
  }
  if (!FINGERPRINT_RE.test(fingerprint.trim())) {
    return res.status(400).json({ error: 'fingerprint con formato inválido' });
  }
  const fp = fingerprint.trim();

  try {
    const found = await pool.query(
      `SELECT l.id, l.sucursal_id, l.estado, l.fingerprint, s.nombre AS sucursal_nombre, s.empresa_id,
              e.nombre AS e_nombre, e.activo AS e_activo, e.suspendida AS e_suspendida,
              e.suspension_motivo AS e_motivo, e.suspendida_en AS e_desde
       FROM licencias_dispositivo l
       JOIN sucursales s ON s.id = l.sucursal_id
       JOIN empresas   e ON e.id = s.empresa_id
       WHERE l.codigo_activacion = $1`,
      [normalizarCodigo(codigo)],
    );
    // Mismo mensaje para "no existe" y para "es de otra máquina": no se
    // confirma desde fuera qué códigos son válidos.
    if (found.rows.length === 0) {
      return res.status(404).json({ error: 'Código de activación inválido' });
    }
    const lic = found.rows[0];
    if (lic.estado === 'revocada') {
      return res.status(403).json({ error: 'Esta licencia fue revocada', estado: 'revocada' });
    }
    const bloqueo = evaluarEmpresa({
      id: lic.empresa_id, nombre: lic.e_nombre, activo: lic.e_activo, suspendida: lic.e_suspendida,
      suspension_motivo: lic.e_motivo, suspendida_en: lic.e_desde,
    });
    if (bloqueo) return res.status(HTTP_BLOQUEO).json({ error: mensajeBloqueo(bloqueo), estado: 'suspendida' });

    if (lic.fingerprint === null) {
      const claimed = await pool.query(
        `UPDATE licencias_dispositivo
         SET fingerprint = $2, activado_en = NOW(), ultimo_heartbeat = NOW(),
             etiqueta = COALESCE(etiqueta, $3)
         WHERE id = $1 AND fingerprint IS NULL
         RETURNING id`,
        [lic.id, fp, nombre_dispositivo?.trim().slice(0, 100) || null],
      );
      if (claimed.rows.length === 0) {
        return res.status(409).json({ error: 'Este código ya fue activado en otro dispositivo' });
      }
    } else if (lic.fingerprint !== fp) {
      return res.status(409).json({ error: 'Este código ya fue activado en otro dispositivo' });
    } else {
      await pool.query('UPDATE licencias_dispositivo SET ultimo_heartbeat = NOW() WHERE id = $1', [lic.id]);
    }

    const token = firmarLicencia({
      lic: lic.id, sucursal_id: lic.sucursal_id, empresa_id: lic.empresa_id ?? null, fp: hashFingerprint(fp),
    });
    res.json({
      token_licencia: token,
      licencia: {
        id: lic.id,
        sucursal_id: lic.sucursal_id,
        sucursal_nombre: lic.sucursal_nombre,
        empresa_id: lic.empresa_id ?? null,
      },
      heartbeat_intervalo_min: HEARTBEAT_INTERVALO_MIN,
      gracia_offline_horas: GRACIA_OFFLINE_HORAS,
    });
  } catch (error) {
    serverError(res, error, 'Error al activar licencia');
  }
};

/**
 * POST /licencias/heartbeat — la app lo llama cada HEARTBEAT_INTERVALO_MIN.
 * Devuelve el reloj del servidor para que la app pueda detectar un desfase
 * grosero del reloj local (no lo corrige: sólo lo muestra).
 */
export const heartbeatLicencia = async (req: Request, res: Response) => {
  const { fingerprint } = req.body as { fingerprint?: string };
  try {
    const r = await validarLicencia(req.headers[LICENCIA_HEADER] as string | undefined, fingerprint);
    if (r.ok === false) return res.status(r.status).json({ error: r.error, estado: r.estado });

    await pool.query('UPDATE licencias_dispositivo SET ultimo_heartbeat = NOW() WHERE id = $1', [r.licencia.id]);
    res.json({
      estado: 'activa',
      licencia_id: r.licencia.id,
      sucursal_id: r.licencia.sucursal_id,
      servidor_ahora: new Date().toISOString(),
      heartbeat_intervalo_min: HEARTBEAT_INTERVALO_MIN,
      gracia_offline_horas: GRACIA_OFFLINE_HORAS,
    });
  } catch (error) {
    serverError(res, error, 'Error en heartbeat');
  }
};
