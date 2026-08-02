/**
 * Utilidades compartidas del módulo de reservas de áreas comunes.
 *
 * Zona horaria: las columnas del proyecto son TIMESTAMP/DATE/TIME "naive" con
 * valores de reloj de pared local, pero NOW() en el contenedor es UTC. Comparar
 * ambos directamente desfasa 6 horas en Guatemala — suficiente para cruzar el
 * límite de 24h/48h de un reembolso o para que "mañana" sea otro día. Por eso
 * todas las consultas usan (NOW() AT TIME ZONE APP_TZ) y nunca NOW() a secas.
 */

export const APP_TZ = process.env.APP_TZ ?? 'America/Guatemala';

/** SQL para "ahora" en hora local, comparable con (fecha + hora_inicio). */
export const AHORA_LOCAL_SQL = (paramIndex: number) => `(NOW() AT TIME ZONE $${paramIndex}::text)`;

export type TarifaTipo = 'gratis' | 'por_hora' | 'unica';

export type EstadoReserva =
  | 'pendiente_aprobacion'
  | 'confirmada'
  | 'cancelada'
  | 'rechazada'
  | 'completada';

/** Estados que ocupan el horario (bloquean nuevas reservas solapadas). */
export const ESTADOS_ACTIVOS: EstadoReserva[] = ['pendiente_aprobacion', 'confirmada'];

export interface ConfigReservas {
  sucursal_id?: string;
  permite_cancelacion: boolean;
  horas_limite_cancelacion_completa: number;
  horas_limite_cancelacion_parcial: number;
  porcentaje_reembolso_parcial: number;
  max_reservas_activas_por_residente: number | null;
  requiere_aprobacion_admin: boolean;
  buffer_minutos_entre_reservas: number;
  buffer_motivo: string | null;
}

/**
 * Valores por defecto de configuracion_reservas. Se devuelven tal cual cuando la
 * sucursal todavía no guardó configuración — sin materializar la fila, como pide
 * la especificación (la fila nace cuando el admin guarda algo).
 */
export const DEFAULTS_RESERVAS: ConfigReservas = {
  permite_cancelacion: true,
  horas_limite_cancelacion_completa: 48,
  horas_limite_cancelacion_parcial: 24,
  porcentaje_reembolso_parcial: 50,
  max_reservas_activas_por_residente: null,
  requiere_aprobacion_admin: false,
  buffer_minutos_entre_reservas: 0,
  buffer_motivo: null,
};

/** Ejecutor mínimo de consultas: sirve tanto para el Pool como para un Client en transacción. */
export interface Consultable {
  query: (text: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }>;
}

/** Normaliza la fila cruda de la BD (NUMERIC llega como string desde pg). */
function normalizarConfig(row: Record<string, unknown>): ConfigReservas {
  return {
    sucursal_id: row.sucursal_id as string | undefined,
    permite_cancelacion: row.permite_cancelacion as boolean,
    horas_limite_cancelacion_completa: Number(row.horas_limite_cancelacion_completa),
    horas_limite_cancelacion_parcial: Number(row.horas_limite_cancelacion_parcial),
    porcentaje_reembolso_parcial: Number(row.porcentaje_reembolso_parcial),
    max_reservas_activas_por_residente:
      row.max_reservas_activas_por_residente === null ||
      row.max_reservas_activas_por_residente === undefined
        ? null
        : Number(row.max_reservas_activas_por_residente),
    requiere_aprobacion_admin: row.requiere_aprobacion_admin as boolean,
    buffer_minutos_entre_reservas: Number(row.buffer_minutos_entre_reservas),
    buffer_motivo: (row.buffer_motivo as string | null) ?? null,
  };
}

/**
 * Configuración efectiva de una sucursal: la fila guardada o los defaults.
 * No inserta nada.
 */
export async function getConfigEfectiva(
  db: Consultable,
  sucursal_id: string
): Promise<ConfigReservas> {
  const r = await db.query('SELECT * FROM configuracion_reservas WHERE sucursal_id = $1', [
    sucursal_id,
  ]);
  if (r.rows.length === 0) return { ...DEFAULTS_RESERVAS, sucursal_id };
  return normalizarConfig(r.rows[0]);
}

/** 'HH:MM' o 'HH:MM:SS' → minutos desde medianoche. NaN si el formato es inválido. */
export function horaAMinutos(hora: string): number {
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(String(hora).trim());
  if (!m) return NaN;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return NaN;
  return h * 60 + min;
}

export interface AreaTarifa {
  tarifa_tipo: TarifaTipo | string;
  tarifa_monto: number | string;
}

/**
 * Cargo de una reserva según la tarifa del área:
 *   gratis   → 0
 *   por_hora → horas reservadas × tarifa/hora
 *   unica    → monto fijo, sin importar la duración
 * Redondeado a 2 decimales.
 */
export function calcularMonto(area: AreaTarifa, hora_inicio: string, hora_fin: string): number {
  const tarifa = Number(area.tarifa_monto) || 0;
  if (area.tarifa_tipo === 'gratis') return 0;
  if (area.tarifa_tipo === 'unica') return Math.round(tarifa * 100) / 100;
  if (area.tarifa_tipo === 'por_hora') {
    const minutos = horaAMinutos(hora_fin) - horaAMinutos(hora_inicio);
    if (!Number.isFinite(minutos) || minutos <= 0) return 0;
    return Math.round(((tarifa * minutos) / 60) * 100) / 100;
  }
  return 0;
}

/**
 * ¿La reserva nace pendiente de aprobación?
 * El override por área (requiere_aprobacion) gana cuando no es NULL;
 * si es NULL, se hereda requiere_aprobacion_admin de la sucursal.
 */
export function resolverAprobacion(
  area: { requiere_aprobacion: boolean | null },
  config: Pick<ConfigReservas, 'requiere_aprobacion_admin'>
): boolean {
  if (area.requiere_aprobacion !== null && area.requiere_aprobacion !== undefined) {
    return Boolean(area.requiere_aprobacion);
  }
  return Boolean(config.requiere_aprobacion_admin);
}

/**
 * Porcentaje de reembolso según las horas que faltan para la reserva.
 *   >= límite completo → 100 %
 *   >= límite parcial  → porcentaje_reembolso_parcial
 *   por debajo (o ya empezada, horas negativas) → 0 %
 */
export function calcularReembolso(horasRestantes: number, config: ConfigReservas): number {
  if (horasRestantes >= config.horas_limite_cancelacion_completa) return 100;
  if (horasRestantes >= config.horas_limite_cancelacion_parcial) {
    return Number(config.porcentaje_reembolso_parcial);
  }
  return 0;
}

export interface NotificacionReserva {
  sucursal_id: string;
  residente_id: string;
  titulo: string;
  contenido: string;
  prioridad?: 'normal' | 'importante' | 'urgente';
  /** Cuándo deja de mostrarse (normalmente el fin de la reserva). */
  vigente_hasta?: string | null;
  /** Usuario que la origina; NULL para las generadas por el cron. */
  creado_por?: string | null;
}

/**
 * Notificación personal a un residente, reutilizando la tabla `anuncios`
 * (residente_id != NULL ⇒ personal; NULL ⇒ anuncio general de la sucursal).
 * Recibe el ejecutor para poder participar de la transacción que la origina.
 */
export async function notificarReserva(db: Consultable, n: NotificacionReserva): Promise<void> {
  await db.query(
    `INSERT INTO anuncios
       (sucursal_id, residente_id, titulo, contenido, prioridad, vigente_desde, vigente_hasta, creado_por)
     VALUES ($1, $2, $3, $4, $5, NOW(), $6, $7)`,
    [
      n.sucursal_id,
      n.residente_id,
      n.titulo,
      n.contenido,
      n.prioridad ?? 'normal',
      n.vigente_hasta ?? null,
      n.creado_por ?? null,
    ]
  );
}

/**
 * Una columna DATE llega como Date de pg. Se normaliza a 'YYYY-MM-DD' usando
 * los getters locales (no toISOString, que convierte a UTC y puede correr la
 * fecha un día en zonas con offset negativo como Guatemala).
 */
export function fechaISO(fecha: string | Date): string {
  if (!(fecha instanceof Date)) return String(fecha).slice(0, 10);
  const y = fecha.getFullYear();
  const m = String(fecha.getMonth() + 1).padStart(2, '0');
  const d = String(fecha.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Formatea una fecha DATE (o Date de pg) como DD/MM/YYYY para los textos al residente. */
export function formatearFecha(fecha: string | Date): string {
  const [y, m, d] = fechaISO(fecha).split('-');
  return d && m && y ? `${d}/${m}/${y}` : fechaISO(fecha);
}

/** Recorta 'HH:MM:SS' a 'HH:MM'. */
export function formatearHora(hora: string): string {
  return String(hora).slice(0, 5);
}

/** Código SQLSTATE de violación de constraint EXCLUDE (doble reserva). */
export const SQLSTATE_EXCLUSION = '23P01';

export function esViolacionExclusion(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: string }).code === SQLSTATE_EXCLUSION
  );
}
