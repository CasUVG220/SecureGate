import type { LangKey } from '../context/LanguageContext';
import type { BorradorOnboarding, EstadoFacturaSaas, EstadoSuscripcion } from '../services/api';
import type { BadgeTone } from '../components/ui';

const LOCALE: Record<LangKey, string> = { es: 'es-GT', en: 'en-US' };

/**
 * Centavos enteros → «Q1,234.50» (quetzal pegado a la cifra y SIEMPRE dos decimales: en una factura «Q250» y «Q250.00» no deben alternar).
 * El backend manda dinero en centavos; aquí es el único lugar donde se divide entre 100, solo para mostrarlo.
 */
export function fmtCentavos(centavos: number, lang: LangKey): string {
  const signo = centavos < 0 ? '-' : '';
  return `${signo}Q${new Intl.NumberFormat(LOCALE[lang], { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(centavos) / 100)}`;
}

export const TONO_SUSCRIPCION: Record<EstadoSuscripcion, BadgeTone> = { prueba: 'info', activa: 'success', vencida: 'danger', cancelada: 'neutral' };
export const TONO_FACTURA: Record<EstadoFacturaSaas, BadgeTone> = { pendiente: 'warning', pagada: 'success', vencida: 'danger', anulada: 'neutral' };

/** Porcentaje de lo incluido que ya se usó, acotado a 0–100 para la barra (el excedente se dice con texto, no con una barra desbordada). */
export const porcentajeUsado = (visitas: number, incluidas: number | null): number =>
  incluidas === null || incluidas <= 0 ? 0 : Math.min(100, Math.round((visitas / incluidas) * 100));

/** «2026-09» → «septiembre de 2026» / «September 2026». */
export function nombreDelMes(periodo: string, lang: LangKey): string {
  const [a, m] = periodo.split('-').map(Number);
  return new Intl.DateTimeFormat(LOCALE[lang], { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(a, m - 1, 1)));
}

/** Descarga un Blob con el nombre dado (el .zip de la exportación). */
export function guardarArchivo(blob: Blob, nombre: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Por dónde sigue el asistente de alta según lo que ya está llenado en el borrador (0 empresa · 2 plan · 3 revisar). */
export const pasoInicial = (b: BorradorOnboarding): number => (!b.sucursal_nombre ? 0 : !b.plan_codigo ? 2 : 3);
