/**
 * Formato y escalas de los gráficos de Análisis.
 *
 * Funciones puras: el idioma entra como parámetro para que el mismo número se
 * lea igual en la tabla, en el tooltip y en el eje.
 */
import type { LangKey } from '../../context/LanguageContext';

const LOCALE: Record<LangKey, string> = { es: 'es-GT', en: 'en-US' };

export const fmtNumero = (n: number, lang: LangKey): string =>
  new Intl.NumberFormat(LOCALE[lang], { maximumFractionDigits: 1 }).format(n);

/** 1,284 → "1.3 mil" / "1.3K". Para ejes y cifras grandes. */
export const fmtCompacto = (n: number, lang: LangKey): string =>
  new Intl.NumberFormat(LOCALE[lang], { notation: 'compact', maximumFractionDigits: 1 }).format(n);

/**
 * Quetzales. El símbolo va fijo ("Q") en los dos idiomas: `Intl` con GTQ en
 * inglés escribe "GTQ 1,200.00", y en la app el monto siempre se ha leído "Q".
 */
export const fmtQuetzales = (n: number, lang: LangKey, { compacto = false } = {}): string => {
  if (compacto && Math.abs(n) >= 10_000) return `Q${fmtCompacto(n, lang)}`;
  const entero = Number.isInteger(n);
  return `Q${new Intl.NumberFormat(LOCALE[lang], {
    minimumFractionDigits: entero ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(n)}`;
};

export const fmtPorcentaje = (fraccion: number, lang: LangKey): string =>
  new Intl.NumberFormat(LOCALE[lang], { style: 'percent', maximumFractionDigits: fraccion > 0 && fraccion < 0.1 ? 1 : 0 }).format(fraccion);

/** 'AAAA-MM-DD' como fecha local (sin el corrimiento de zona de `new Date(iso)`). */
export const fechaLocal = (iso: string): Date => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
};

export const isoLocal = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** "3 sep" / "Sep 3". */
export const fmtFechaCorta = (iso: string, lang: LangKey): string =>
  fechaLocal(iso).toLocaleDateString(LOCALE[lang], { day: 'numeric', month: 'short' }).replace('.', '');

/** "mié, 3 sep" / "Wed, Sep 3". */
export const fmtFechaLarga = (iso: string, lang: LangKey): string =>
  fechaLocal(iso).toLocaleDateString(LOCALE[lang], { weekday: 'short', day: 'numeric', month: 'short' }).replace(/\./g, '');

/** "3 sep – 2 oct 2026". El año sólo al final, y sólo una vez si coincide. */
export const fmtRango = (desde: string, hasta: string, lang: LangKey): string => {
  const a = fechaLocal(desde);
  const b = fechaLocal(hasta);
  const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' };
  const inicio = a.toLocaleDateString(LOCALE[lang], a.getFullYear() === b.getFullYear() ? opts : { ...opts, year: 'numeric' });
  const fin = b.toLocaleDateString(LOCALE[lang], { ...opts, year: 'numeric' });
  return (desde === hasta ? fin : `${inicio} – ${fin}`).replace(/\./g, '');
};

/** 38 → "38 min"; 95 → "1 h 35 min". */
export const fmtDuracion = (min: number): string => {
  if (min < 60) return `${Math.round(min)} min`;
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return m ? `${h} h ${m} min` : `${h} h`;
};

export type Direccion = 'sube' | 'baja' | 'igual';

/**
 * Variación contra el periodo anterior. Sin base (anterior = 0) no hay
 * porcentaje que mostrar: "+∞ %" no informa nada, así que `pct` va en null y
 * la interfaz dice "nuevo" o "sin cambios".
 */
export const variacion = (actual: number, anterior: number): { pct: number | null; dir: Direccion } => {
  if (anterior === 0) return { pct: null, dir: actual > 0 ? 'sube' : 'igual' };
  const pct = (actual - anterior) / anterior;
  if (Math.abs(pct) < 0.005) return { pct: 0, dir: 'igual' };
  return { pct, dir: pct > 0 ? 'sube' : 'baja' };
};

/**
 * Marcas "redondas" del eje Y (0, 5, 10… / 0, 250, 500…) que cubren `max`.
 * Devuelve las marcas y el tope del eje, que es la última marca.
 */
export const marcasEje = (max: number, cuantas = 4): { marcas: number[]; tope: number } => {
  if (!(max > 0)) return { marcas: [0, 1], tope: 1 };
  const bruto = max / cuantas;
  const magnitud = 10 ** Math.floor(Math.log10(bruto));
  const candidato = [1, 2, 2.5, 5, 10].map(f => f * magnitud).find(p => p >= bruto) ?? 10 * magnitud;
  // Nunca marcas fraccionarias pequeñas: no existe "2.5 visitas" ni "Q0.5".
  const paso = candidato < 10 && !Number.isInteger(candidato) ? Math.ceil(candidato) : Math.max(1, candidato);
  const tope = Math.ceil(max / paso) * paso;
  const marcas: number[] = [];
  for (let v = 0; v <= tope; v += paso) marcas.push(v);
  return { marcas, tope };
};

/** Cuántas etiquetas de fecha caben en el eje X sin montarse (≈ 72 px cada una). */
export const indicesEtiquetas = (n: number, ancho: number, separacion = 72): number[] => {
  if (n <= 0) return [];
  const caben = Math.max(2, Math.floor(ancho / separacion));
  if (n <= caben) return Array.from({ length: n }, (_, i) => i);
  const paso = Math.ceil((n - 1) / (caben - 1));
  const out: number[] = [];
  for (let i = 0; i < n; i += paso) out.push(i);
  // El último día siempre se rotula: es "hoy" o el cierre del periodo. Si quedó
  // demasiado cerca de la marca anterior, esa se quita para que no se monten.
  if (out[out.length - 1] !== n - 1) {
    if (n - 1 - out[out.length - 1] < paso / 2) out.pop();
    out.push(n - 1);
  }
  return out;
};

/** Cubeta 1-5 de la escala secuencial; 0 queda para "sin movimiento". */
export const cubeta = (valor: number, max: number, pasos = 5): number =>
  valor <= 0 || max <= 0 ? 0 : Math.min(pasos, Math.max(1, Math.ceil((valor / max) * pasos)));

/** Sustituye `{clave}` en una traducción; deja intactas las variables desconocidas. */
export const rellenar = (plantilla: string, vars: Record<string, string | number>): string =>
  plantilla.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));

export interface Comparacion {
  dir: Direccion;
  /** Variación ya formateada ("25 %"), o null si no hay base contra qué comparar. */
  pct: string | null;
  /** Referencia escrita: "frente a 366 del periodo anterior". */
  texto: string;
  /** Qué dirección es buena; null si el dato no es ni bueno ni malo. */
  bueno: 'sube' | 'baja' | null;
}

/**
 * Arma la comparación de una cifra. `frente` es una plantilla con `{valor}`
 * ("frente a {valor} ayer a esta hora"); `sinBase` se usa cuando el valor de
 * referencia es 0 y un porcentaje no significaría nada.
 */
export function comparar(
  actual: number,
  anterior: number,
  opts: { formato: (n: number) => string; bueno: Comparacion['bueno']; frente: string; sinBase: string; lang: LangKey },
): Comparacion {
  const v = variacion(actual, anterior);
  return {
    dir: v.dir,
    pct: v.pct == null ? null : fmtPorcentaje(Math.abs(v.pct), opts.lang),
    texto: anterior === 0 ? opts.sinBase : rellenar(opts.frente, { valor: opts.formato(anterior) }),
    bueno: opts.bueno,
  };
}
