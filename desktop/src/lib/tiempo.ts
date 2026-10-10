/** Texto relativo tipo "hace 3 min" para las tiras de estado. */
export function haceCuanto(iso: string | null | undefined, ahora: Date = new Date()): string {
  if (!iso) return 'nunca';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return 'nunca';
  const seg = Math.max(0, Math.round((ahora.getTime() - t) / 1000));
  if (seg < 45) return 'hace un momento';
  const min = Math.round(seg / 60);
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h${min % 60 ? ` ${min % 60} min` : ''}`;
  const d = Math.floor(h / 24);
  return `hace ${d} día${d === 1 ? '' : 's'}`;
}

/** "14:05" en hora local. */
export const horaLocal = (iso: string): string =>
  new Date(iso).toLocaleTimeString('es-GT', { hour: '2-digit', minute: '2-digit' });

/** Horas decimales → "2 h 30 min". */
export const horasATexto = (h: number): string => {
  const min = Math.max(0, Math.round(h * 60));
  const hh = Math.floor(min / 60);
  const mm = min % 60;
  if (hh === 0) return `${mm} min`;
  return mm ? `${hh} h ${mm} min` : `${hh} h`;
};

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/** Día de calendario ('2026-10-12' o con hora) como «12 oct 2026», sin mover el día por la zona. Vacío si no es fecha. */
export function diaCorto(valor: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec((valor ?? '').trim());
  if (!m) return '';
  const mes = Number(m[2]);
  if (mes < 1 || mes > 12) return '';
  return `${Number(m[3])} ${MESES[mes - 1]} ${m[1]}`;
}
