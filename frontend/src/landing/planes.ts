/**
 * Precios del landing. Para cambiarlos se editan SOLO las tres constantes de datos (HOGARES, CASETAS, PLANES); la
 * tabla, las notas y el JSON-LD de buscadores salen de aquí. Guía: docs/landing.md.
 *
 * Montos en quetzales enteros, IVA (12 %) INCLUIDO. Cada par es [primer pago, mensualidad].
 * Más de 1,000 hogares no tiene monto publicado: la página dice «Cotización a medida» y lleva al formulario.
 */

// src/landing/planes.ts  — [primer pago, mensualidad] con IVA, en Q
export const HOGARES = [50, 100, 200, 500, 1000] as const;
export const CASETAS = [1, 1, 2, 3, 5];
export const PLANES = {
  compra:   [[44078,1400],[44078,2072],[86475,3472],[128873,5992],[213668,9240]],
  alquiler: [[7840,2576],[7840,3248],[14000,5824],[20160,9520],[32480,15120]],
  licencia: [[2800,896],[2800,1568],[3920,2464],[5040,4480],[7280,6720]],
} as const;

export type Paquete = keyof typeof PLANES;
export type Hogares = (typeof HOGARES)[number];
/** Lo que se elige en la regla de precios y en el formulario: un tramo publicado o «más de 1,000». */
export type TramoHogares = Hogares | '1000+';

export const PAQUETES: readonly Paquete[] = ['compra', 'alquiler', 'licencia'];
export const TRAMOS: readonly TramoHogares[] = [...HOGARES, '1000+'];

/**
 * Paquete marcado como «el más pedido». `null` = ninguno, y así se queda hasta que el equipo lo confirme con datos
 * reales (no se marca uno para empujar la venta).
 */
export const PAQUETE_DESTACADO: Paquete | null = null;

const moneda = new Intl.NumberFormat('es-GT', { style: 'currency', currency: 'GTQ' });
const entero = new Intl.NumberFormat('es-GT');

/** Q en formato de Guatemala: «Q 44,078.00» (el separador entre Q y el número es el que da Intl). */
export const formatoQ = (monto: number): string => moneda.format(monto);

/** 1000 → «1,000»; '1000+' → «Más de 1,000». */
export const etiquetaTramo = (t: TramoHogares): string =>
  t === '1000+' ? `Más de ${entero.format(1000)}` : entero.format(t);

export const esTramo = (v: unknown): v is TramoHogares =>
  TRAMOS.some(t => String(t) === String(v));

/** Monto de un paquete para un tramo, o `null` en «más de 1,000» (cotización a medida). */
export function precioDe(paquete: Paquete, tramo: TramoHogares): { primerPago: number; mensualidad: number } | null {
  if (tramo === '1000+') return null;
  const [primerPago, mensualidad] = PLANES[paquete][HOGARES.indexOf(tramo)];
  return { primerPago, mensualidad };
}

/** Casetas con que se calculó el tramo, o `null` en «más de 1,000». */
export const casetasDe = (tramo: TramoHogares): number | null =>
  tramo === '1000+' ? null : CASETAS[HOGARES.indexOf(tramo)];

/** Mensualidad mínima y máxima publicadas (para el JSON-LD de buscadores). */
export function rangoMensualidad(): { minima: number; maxima: number } {
  const todas = PAQUETES.flatMap(p => PLANES[p].map(([, m]) => m));
  return { minima: Math.min(...todas), maxima: Math.max(...todas) };
}
