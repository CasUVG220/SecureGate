/**
 * Sprint 10: el ANPR (sidecar, JavaScript) usa una COPIA de las reglas de placa de esta app (`lib/placa.ts`). Esta prueba corre
 * las dos sobre el mismo corpus y exige resultados idénticos: si alguien cambia una sin la otra, falla aquí.
 */
import { describe, expect, it } from 'vitest';
import * as ts from '../placa';
// Módulo CommonJS del sidecar; sus tipos están en `placa.d.ts`, al lado.
import * as copia from '../../../sidecar-ocr/src/anpr/placa.js';

const js: typeof copia = (copia as unknown as { default?: typeof copia }).default ?? copia;

type Fragmento = { texto: string; confianza: number };

/** Corpus: placas limpias, con separadores, con confusiones del OCR en cada posición, partidas y basura. */
const TEXTOS = [
  'P123ABC', 'P-123ABC', 'p 123 abc', 'C458DFG', 'CD004ABC', 'TRC123XYZ', 'MI777AAA', 'O004ABC', 'D004ABQ', '0004ABC',
  'P12OABC', 'PI23ABC', 'P123A8C', 'P1Z3ABC', 'P123ABO', 'Q123ABC', 'P1234ABC', 'P123AB', 'GUATEMALA P 123ABC', 'IDP123ABC',
  'XQ123ABC', 'P 1 2 3 A B C', '123ABC', 'ABC', '', '---', 'P123ABCD', 'M771KLN', 'C 458DFC', 'EE888SSS', 'U318BCD', 'TP5550TR',
];

const FRAGMENTOS: Fragmento[][] = [
  [{ texto: 'GUATEMALA', confianza: 0.99 }, { texto: 'P', confianza: 0.95 }, { texto: '123ABC', confianza: 0.95 }],
  [{ texto: 'GUATEMALA', confianza: 0.99 }, { texto: 'ID', confianza: 0.83 }, { texto: '123AB', confianza: 0.83 }, { texto: '', confianza: 0.83 }],
  [{ texto: 'C', confianza: 0.95 }, { texto: '458DFC', confianza: 0.95 }],
  [{ texto: 'P 12OABC', confianza: 0.9 }],
  [{ texto: 'HOLA', confianza: 0.5 }],
  [],
];

describe('paridad de las reglas de placa: lib/placa.ts ↔ sidecar-ocr/src/anpr/placa.js', () => {
  it('mismas constantes', () => {
    expect([...js.PREFIJOS_CONOCIDOS]).toEqual([...ts.PREFIJOS_CONOCIDOS]);
    expect(js.PLACA_RE.source).toBe(ts.PLACA_RE.source);
    expect(js.UMBRAL_CONFIANZA).toBe(ts.UMBRAL_CONFIANZA);
  });

  it.each(TEXTOS)('normalizar, formatear, validar y candidatos de «%s»', (t) => {
    expect(js.normalizar(t)).toBe(ts.normalizar(t));
    expect(js.formatear(t)).toBe(ts.formatear(t));
    expect(js.esValida(t)).toBe(ts.esValida(t));
    for (const conf of [0.5, 0.9]) expect(js.candidatosDe(t, conf)).toEqual(ts.candidatosDe(t, conf));
    expect(js.mejorCandidato([{ texto: t, confianza: 0.9 }], t)).toEqual(ts.mejorCandidato([{ texto: t, confianza: 0.9 }], t));
  });

  it.each(FRAGMENTOS.map((f, i) => [i, f] as const))('mejor candidato de los fragmentos #%i', (_i, frags) => {
    expect(js.mejorCandidato(frags, 'crudo')).toEqual(ts.mejorCandidato(frags, 'crudo'));
  });
});
