import type { BadgeTone } from './Badge';

/**
 * Color de cada estado de pago, compartido por residentes, pagos y el portal
 * del residente: un solo lugar decide qué significa "al día" o "en mora".
 */
export const ESTADO_PAGO_TONE: Record<string, BadgeTone> = {
  al_dia: 'success', aprobado: 'success',
  pendiente: 'warning',
  mora: 'danger', rechazado: 'danger',
  anulado: 'neutral',
};
