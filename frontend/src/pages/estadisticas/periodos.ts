import { fechaLocal, isoLocal } from '../../components/charts/format';

export type Preset = '7d' | '30d' | '90d' | 'mes' | 'anio' | 'custom';

/** Los atajos, en el orden del selector. "custom" abre las fechas a mano. */
export const PRESETS: Preset[] = ['7d', '30d', '90d', 'mes', 'anio', 'custom'];

/** Igual que el backend (MAX_DIAS): un año y un día. */
export const MAX_DIAS = 366;

export interface Rango { desde: string; hasta: string }

/** Rango de un atajo, terminando hoy (incluido). */
export function rangoDePreset(preset: Exclude<Preset, 'custom'>, hoy: Date = new Date()): Rango {
  const fin = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
  const inicio = new Date(fin);
  switch (preset) {
    case '7d':  inicio.setDate(fin.getDate() - 6); break;
    case '30d': inicio.setDate(fin.getDate() - 29); break;
    case '90d': inicio.setDate(fin.getDate() - 89); break;
    case 'mes': inicio.setDate(1); break;
    case 'anio': inicio.setMonth(0, 1); break;
  }
  return { desde: isoLocal(inicio), hasta: isoLocal(fin) };
}

export const diasEntre = ({ desde, hasta }: Rango): number =>
  Math.round((fechaLocal(hasta).getTime() - fechaLocal(desde).getTime()) / 86_400_000) + 1;

export type ErrorRango = 'faltan' | 'orden' | 'largo';

export function validarRango(r: Rango): ErrorRango | null {
  if (!r.desde || !r.hasta) return 'faltan';
  if (r.desde > r.hasta) return 'orden';
  if (diasEntre(r) > MAX_DIAS) return 'largo';
  return null;
}
