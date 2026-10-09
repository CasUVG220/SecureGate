/**
 * Fechas y horas de la aplicación: UN solo lugar y UN solo formato.
 *
 * Antes cada pantalla llamaba a `toLocaleDateString('es-GT')` (≈32 sitios), sin zona horaria y con
 * formatos distintos (`01/11/2026`, `11/1/2026`, `1 nov.`…): la hora dependía de la zona del navegador
 * de quien miraba y la misma fecha se leía de cuatro maneras. Aquí:
 *
 *  - toda hora se muestra en **America/Guatemala** (la zona del condominio), no en la del navegador;
 *  - el mes va **escrito y abreviado** («1 nov 2026»; en inglés «Nov 1, 2026»), sin depender de lo que
 *    haga cada versión de ICU con los puntos de «nov.» / «sept.»;
 *  - las horas son de 24 h («14:35»).
 *
 * Dos clases de valor, dos funciones:
 *  - un **instante** (`created_at`, `timestamp_entrada`…) → `formatearFecha`, `formatearFechaHora`…: se
 *    convierte a la zona de la aplicación;
 *  - un **día de calendario** (`fecha` de una reserva, `fecha_inicio` de una preautorización: columnas
 *    DATE) → `formatearDia`, `formatearDiaMes`…: se lee tal cual, SIN corrimiento de zona. Pasar un DATE
 *    por la conversión de zona lo movía de día (`2026-12-10T00:00Z` es el 9 en Guatemala).
 *
 * Un valor vacío o inválido da «—», nunca «Invalid Date».
 */
export const ZONA_APP = 'America/Guatemala';
export type IdiomaFecha = 'es' | 'en';

export type ValorFecha = string | number | Date | null | undefined;

const VACIO = '—';

const MES: Record<IdiomaFecha, string[]> = {
  es: ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'],
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
};
const MES_LARGO: Record<IdiomaFecha, string[]> = {
  es: ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'],
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
};
const DIA_SEMANA: Record<IdiomaFecha, string[]> = {
  es: ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'],
  en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
};
const DIA_SEMANA_LARGO: Record<IdiomaFecha, string[]> = {
  es: ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'],
  en: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
};

/** Idioma que eligió la persona (lo guarda `LanguageContext`); español si no hay nada. */
export const idiomaActual = (): IdiomaFecha => {
  try {
    return localStorage.getItem('language') === 'en' ? 'en' : 'es';
  } catch {
    return 'es';
  }
};

interface Partes { anio: number; mes: number; dia: number; hora: number; minuto: number; segundo: number; semana: number }

const SEMANA_EN: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

let formateador: Intl.DateTimeFormat | null = null;
const partesEnZona = (d: Date): Partes => {
  formateador ??= new Intl.DateTimeFormat('en-US', {
    timeZone: ZONA_APP, hourCycle: 'h23', weekday: 'short',
    year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
  });
  const p: Record<string, string> = {};
  for (const x of formateador.formatToParts(d)) p[x.type] = x.value;
  return {
    anio: Number(p.year), mes: Number(p.month), dia: Number(p.day),
    hora: Number(p.hour) % 24, minuto: Number(p.minute), segundo: Number(p.second),
    semana: SEMANA_EN[p.weekday] ?? 0,
  };
};

const aDate = (v: ValorFecha): Date | null => {
  if (v === null || v === undefined || v === '') return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

/** Día de calendario de un valor DATE: 'AAAA-MM-DD' (con o sin hora) o un Date, leídos sin zona. */
const partesDeDia = (v: ValorFecha): Pick<Partes, 'anio' | 'mes' | 'dia' | 'semana'> | null => {
  if (typeof v === 'string') {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v.trim());
    if (m) {
      const [anio, mes, dia] = [Number(m[1]), Number(m[2]), Number(m[3])];
      if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return null;
      return { anio, mes, dia, semana: new Date(Date.UTC(anio, mes - 1, dia)).getUTCDay() };
    }
  }
  const d = aDate(v);
  if (!d) return null;
  return { anio: d.getUTCFullYear(), mes: d.getUTCMonth() + 1, dia: d.getUTCDate(), semana: d.getUTCDay() };
};

const dosDigitos = (n: number) => String(n).padStart(2, '0');

const armar = (
  p: { anio: number; mes: number; dia: number },
  lang: IdiomaFecha,
  conAnio: boolean,
): string => {
  const mes = MES[lang][p.mes - 1];
  if (lang === 'en') return conAnio ? `${mes} ${p.dia}, ${p.anio}` : `${mes} ${p.dia}`;
  return conAnio ? `${p.dia} ${mes} ${p.anio}` : `${p.dia} ${mes}`;
};

// ── Instantes (se muestran en la zona de la aplicación) ───────────────────────

/** «1 nov 2026». */
export function formatearFecha(v: ValorFecha, lang: IdiomaFecha = idiomaActual()): string {
  const d = aDate(v);
  return d ? armar(partesEnZona(d), lang, true) : VACIO;
}

/** «14:35» (24 h). Con `conSegundos`: «14:35:09». */
export function formatearHora(v: ValorFecha, conSegundos = false): string {
  const d = aDate(v);
  if (!d) return VACIO;
  const p = partesEnZona(d);
  return `${dosDigitos(p.hora)}:${dosDigitos(p.minuto)}${conSegundos ? `:${dosDigitos(p.segundo)}` : ''}`;
}

/** «1 nov 2026, 14:35». */
export function formatearFechaHora(v: ValorFecha, lang: IdiomaFecha = idiomaActual()): string {
  const d = aDate(v);
  return d ? `${formatearFecha(d, lang)}, ${formatearHora(d)}` : VACIO;
}

/** «1 nov, 14:35»: sin año, para chats, listas de actividad y tablas angostas. */
export function formatearFechaHoraCorta(v: ValorFecha, lang: IdiomaFecha = idiomaActual()): string {
  const d = aDate(v);
  return d ? `${armar(partesEnZona(d), lang, false)}, ${formatearHora(d)}` : VACIO;
}

/** «jueves, 24 de septiembre» / «Thursday, September 24» (encabezados). */
export function formatearFechaLarga(v: ValorFecha, lang: IdiomaFecha = idiomaActual()): string {
  const d = aDate(v);
  if (!d) return VACIO;
  const p = partesEnZona(d);
  const dia = DIA_SEMANA_LARGO[lang][p.semana];
  const mes = MES_LARGO[lang][p.mes - 1];
  return lang === 'en' ? `${dia}, ${mes} ${p.dia}` : `${dia}, ${p.dia} de ${mes}`;
}

/**
 * El día de HOY en la zona de la aplicación, como 'AAAA-MM-DD'. `new Date().toISOString().slice(0, 10)` da el
 * día en UTC: en Guatemala, a partir de las 6 de la tarde ya es «mañana», y las reservas, preautorizaciones e
 * invitaciones arrancaban con la fecha del día siguiente.
 */
export function hoyEnZona(ahora: Date = new Date()): string {
  const p = partesEnZona(ahora);
  return `${p.anio}-${dosDigitos(p.mes)}-${dosDigitos(p.dia)}`;
}

// ── Días de calendario (columnas DATE: no se mueven de día por la zona) ───────

/**
 * El día de calendario de un valor DATE como 'AAAA-MM-DD' (sin corrimiento de zona), o null si no es una fecha.
 * Sirve para comparar días entre sí o con `hoyEnZona()`: las cadenas ISO de ese formato se ordenan como fechas.
 */
export function diaISO(v: ValorFecha): string | null {
  const p = partesDeDia(v);
  return p ? `${p.anio}-${dosDigitos(p.mes)}-${dosDigitos(p.dia)}` : null;
}

/** «10 dic 2026». */
export function formatearDia(v: ValorFecha, lang: IdiomaFecha = idiomaActual()): string {
  const p = partesDeDia(v);
  return p ? armar(p, lang, true) : VACIO;
}

/** «10 dic» (sin año). */
export function formatearDiaMes(v: ValorFecha, lang: IdiomaFecha = idiomaActual()): string {
  const p = partesDeDia(v);
  return p ? armar(p, lang, false) : VACIO;
}

/** «jue, 10 dic» / «Thu, Dec 10». */
export function formatearDiaSemana(v: ValorFecha, lang: IdiomaFecha = idiomaActual()): string {
  const p = partesDeDia(v);
  return p ? `${DIA_SEMANA[lang][p.semana]}, ${armar(p, lang, false)}` : VACIO;
}

/**
 * «3 sep – 2 oct 2026». El año solo al final, y una sola vez si coincide; un solo día se escribe una vez.
 */
export function formatearRangoDias(desde: ValorFecha, hasta: ValorFecha, lang: IdiomaFecha = idiomaActual()): string {
  const a = partesDeDia(desde);
  const b = partesDeDia(hasta);
  if (!a || !b) return VACIO;
  const fin = armar(b, lang, true);
  if (a.anio === b.anio && a.mes === b.mes && a.dia === b.dia) return fin;
  return `${armar(a, lang, a.anio !== b.anio)} – ${fin}`;
}
