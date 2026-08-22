import { Request, Response } from 'express';
import pool from '../db/pool';
import { resolveSucursalId } from '../utils/tenant';

export interface ConfigQr {
  dpi_obligatorio_individual: boolean;
  requiere_placa: boolean;
  autorizacion_automatica: boolean;
  max_intentos_fallidos: number;
  bloqueo_minutos: number;
}

export const DEFAULTS_QR: ConfigQr = {
  dpi_obligatorio_individual: true,
  requiere_placa: false,
  autorizacion_automatica: false,
  max_intentos_fallidos: 5,
  bloqueo_minutos: 15,
};

/** Ejecutor mínimo de consultas: sirve tanto para el Pool como para un Client en transacción. */
export interface Consultable {
  query: (text: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }>;
}

/**
 * Config efectiva de QR para una sucursal — usada tanto por el endpoint de
 * lectura como por la lógica de negocio en accesos.controller.ts (igual que
 * checkBlacklist/checkPreautorizacion, ya importados entre controllers).
 * Si la sucursal no guardó nada, devuelve los defaults sin insertar fila.
 */
export async function getConfigQrEfectiva(db: Consultable, sucursal_id: string): Promise<ConfigQr> {
  const r = await db.query('SELECT * FROM configuracion_qr WHERE sucursal_id = $1', [sucursal_id]);
  if (r.rows.length === 0) return { ...DEFAULTS_QR };
  const row = r.rows[0];
  return {
    dpi_obligatorio_individual: row.dpi_obligatorio_individual,
    requiere_placa: row.requiere_placa,
    autorizacion_automatica: row.autorizacion_automatica,
    max_intentos_fallidos: row.max_intentos_fallidos,
    bloqueo_minutos: row.bloqueo_minutos,
  };
}

export const getConfigQr = async (req: Request, res: Response) => {
  const sucursal_id = await resolveSucursalId(
    req.user!.sucursal_id,
    req.query.sucursal_id as string | undefined,
    pool
  );
  if (!sucursal_id) {
    return res.status(400).json({ error: 'No se pudo determinar la sucursal' });
  }

  try {
    const existente = await pool.query('SELECT * FROM configuracion_qr WHERE sucursal_id = $1', [sucursal_id]);
    if (existente.rows.length === 0) {
      return res.json({ sucursal_id, ...DEFAULTS_QR, es_default: true });
    }
    const config = await getConfigQrEfectiva(pool, sucursal_id);
    res.json({ ...config, sucursal_id, es_default: false });
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener la configuración de QR', detail: String(error) });
  }
};

export const updateConfigQr = async (req: Request, res: Response) => {
  const {
    dpi_obligatorio_individual,
    requiere_placa,
    autorizacion_automatica,
    max_intentos_fallidos,
    bloqueo_minutos,
  } = req.body;

  const sucursal_id = await resolveSucursalId(req.user!.sucursal_id, req.body.sucursal_id, pool);
  if (!sucursal_id) {
    return res.status(400).json({ error: 'No se pudo determinar la sucursal' });
  }

  if (max_intentos_fallidos !== undefined && Number(max_intentos_fallidos) <= 0) {
    return res.status(400).json({ error: 'max_intentos_fallidos debe ser mayor a 0' });
  }
  if (bloqueo_minutos !== undefined && Number(bloqueo_minutos) <= 0) {
    return res.status(400).json({ error: 'bloqueo_minutos debe ser mayor a 0' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO configuracion_qr
         (sucursal_id, dpi_obligatorio_individual, requiere_placa, autorizacion_automatica,
          max_intentos_fallidos, bloqueo_minutos)
       VALUES ($1, COALESCE($2, TRUE), COALESCE($3, FALSE), COALESCE($4, FALSE),
               COALESCE($5, 5), COALESCE($6, 15))
       ON CONFLICT (sucursal_id) DO UPDATE SET
         dpi_obligatorio_individual = COALESCE($2, configuracion_qr.dpi_obligatorio_individual),
         requiere_placa             = COALESCE($3, configuracion_qr.requiere_placa),
         autorizacion_automatica    = COALESCE($4, configuracion_qr.autorizacion_automatica),
         max_intentos_fallidos      = COALESCE($5, configuracion_qr.max_intentos_fallidos),
         bloqueo_minutos            = COALESCE($6, configuracion_qr.bloqueo_minutos),
         updated_at                 = NOW()
       RETURNING *`,
      [
        sucursal_id,
        dpi_obligatorio_individual ?? null,
        requiere_placa ?? null,
        autorizacion_automatica ?? null,
        max_intentos_fallidos ?? null,
        bloqueo_minutos ?? null,
      ]
    );
    res.json({ ...result.rows[0], es_default: false });
  } catch (error) {
    res.status(500).json({ error: 'Error al guardar la configuración de QR', detail: String(error) });
  }
};
