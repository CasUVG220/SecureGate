import { Request, Response } from 'express';
import pool from '../db/pool';
import { resolveSucursalId } from '../utils/tenant';
import { DEFAULTS_RESERVAS, getConfigEfectiva } from '../utils/reservas';

/**
 * Configuración de reservas de la sucursal.
 * Si la sucursal aún no guardó nada, devuelve los defaults marcados con
 * `es_default: true` SIN crear la fila — la fila nace cuando el admin guarda.
 */
export const getConfigReservas = async (req: Request, res: Response) => {
  const sucursal_id = await resolveSucursalId(
    req.user!.sucursal_id,
    req.query.sucursal_id as string | undefined,
    pool
  );
  if (!sucursal_id) {
    return res.status(400).json({ error: 'No se pudo determinar la sucursal' });
  }

  try {
    const existente = await pool.query(
      'SELECT * FROM configuracion_reservas WHERE sucursal_id = $1',
      [sucursal_id]
    );
    if (existente.rows.length === 0) {
      return res.json({ sucursal_id, ...DEFAULTS_RESERVAS, es_default: true });
    }
    const config = await getConfigEfectiva(pool, sucursal_id);
    res.json({ ...config, sucursal_id, es_default: false });
  } catch (error) {
    res
      .status(500)
      .json({ error: 'Error al obtener la configuración de reservas', detail: String(error) });
  }
};

export const updateConfigReservas = async (req: Request, res: Response) => {
  const {
    permite_cancelacion,
    horas_limite_cancelacion_completa,
    horas_limite_cancelacion_parcial,
    porcentaje_reembolso_parcial,
    max_reservas_activas_por_residente,
    requiere_aprobacion_admin,
    buffer_minutos_entre_reservas,
    buffer_motivo,
  } = req.body;

  const sucursal_id = await resolveSucursalId(
    req.user!.sucursal_id,
    req.body.sucursal_id,
    pool
  );
  if (!sucursal_id) {
    return res.status(400).json({ error: 'No se pudo determinar la sucursal' });
  }

  // Validar la coherencia de los límites aquí y no dejar que el CHECK devuelva
  // un 23514 crudo en el campo `detail`.
  const completa =
    horas_limite_cancelacion_completa ?? DEFAULTS_RESERVAS.horas_limite_cancelacion_completa;
  const parcial =
    horas_limite_cancelacion_parcial ?? DEFAULTS_RESERVAS.horas_limite_cancelacion_parcial;
  if (Number(completa) < Number(parcial)) {
    return res.status(400).json({
      error: 'El límite de cancelación completa debe ser mayor o igual al límite parcial',
    });
  }
  if (
    porcentaje_reembolso_parcial !== undefined &&
    (Number(porcentaje_reembolso_parcial) < 0 || Number(porcentaje_reembolso_parcial) > 100)
  ) {
    return res.status(400).json({ error: 'porcentaje_reembolso_parcial debe estar entre 0 y 100' });
  }

  // NULL es un valor significativo para estos dos campos ("sin límite" y "sin
  // motivo"), y COALESCE nunca puede escribirlo: se usa un centinela booleano
  // que indica si la clave vino en el body.
  const tocaMax = Object.prototype.hasOwnProperty.call(
    req.body,
    'max_reservas_activas_por_residente'
  );
  const tocaMotivo = Object.prototype.hasOwnProperty.call(req.body, 'buffer_motivo');
  const maxNormalizado =
    max_reservas_activas_por_residente === null ||
    max_reservas_activas_por_residente === undefined ||
    max_reservas_activas_por_residente === ''
      ? null
      : Number(max_reservas_activas_por_residente);

  if (maxNormalizado !== null && (!Number.isInteger(maxNormalizado) || maxNormalizado < 1)) {
    return res.status(400).json({
      error: 'max_reservas_activas_por_residente debe ser un entero mayor a 0, o vacío para sin límite',
    });
  }

  try {
    const result = await pool.query(
      `INSERT INTO configuracion_reservas
         (sucursal_id, permite_cancelacion, horas_limite_cancelacion_completa,
          horas_limite_cancelacion_parcial, porcentaje_reembolso_parcial,
          max_reservas_activas_por_residente, requiere_aprobacion_admin,
          buffer_minutos_entre_reservas, buffer_motivo)
       VALUES ($1, COALESCE($2, TRUE), COALESCE($3, 48), COALESCE($4, 24),
               COALESCE($5, 50), $6, COALESCE($7, FALSE), COALESCE($8, 0), $9)
       ON CONFLICT (sucursal_id) DO UPDATE SET
         permite_cancelacion = COALESCE(EXCLUDED.permite_cancelacion, configuracion_reservas.permite_cancelacion),
         horas_limite_cancelacion_completa = COALESCE($3, configuracion_reservas.horas_limite_cancelacion_completa),
         horas_limite_cancelacion_parcial  = COALESCE($4, configuracion_reservas.horas_limite_cancelacion_parcial),
         porcentaje_reembolso_parcial      = COALESCE($5, configuracion_reservas.porcentaje_reembolso_parcial),
         max_reservas_activas_por_residente =
           CASE WHEN $10::boolean THEN $6::int
                ELSE configuracion_reservas.max_reservas_activas_por_residente END,
         requiere_aprobacion_admin     = COALESCE($7, configuracion_reservas.requiere_aprobacion_admin),
         buffer_minutos_entre_reservas = COALESCE($8, configuracion_reservas.buffer_minutos_entre_reservas),
         buffer_motivo =
           CASE WHEN $11::boolean THEN $9::text ELSE configuracion_reservas.buffer_motivo END,
         updated_at = NOW()
       RETURNING *`,
      [
        sucursal_id,
        permite_cancelacion ?? null,
        horas_limite_cancelacion_completa ?? null,
        horas_limite_cancelacion_parcial ?? null,
        porcentaje_reembolso_parcial ?? null,
        maxNormalizado,
        requiere_aprobacion_admin ?? null,
        buffer_minutos_entre_reservas ?? null,
        buffer_motivo ?? null,
        tocaMax,
        tocaMotivo,
      ]
    );
    res.json({ ...result.rows[0], es_default: false });
  } catch (error) {
    res
      .status(500)
      .json({ error: 'Error al guardar la configuración de reservas', detail: String(error) });
  }
};
