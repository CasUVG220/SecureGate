import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { themePalettes, vizVars, type ScaleName } from '../tokens';

/**
 * `src/index.css` repite a mano los valores de `tokens.ts` como custom
 * properties por tema. Si una de las dos copias cambia sola, un tema queda con
 * colores que nadie eligió (así fue como el 900 de "peligro" terminó pintando
 * los avisos de rosa grisáceo en claro). Este test compara las dos.
 */
const css = readFileSync(path.resolve(__dirname, '../../index.css'), 'utf8');

/** Variables `--c-*` declaradas en el bloque que empieza en `selector {`. */
const variablesDe = (selector: string, desde = 0): Map<string, string> => {
  const inicio = css.indexOf(`${selector} {`, desde);
  if (inicio < 0) throw new Error(`No se encontró ${selector} en index.css`);
  const fin = css.indexOf('\n}', inicio);
  const bloque = css.slice(inicio, fin);
  return new Map([...bloque.matchAll(/--c-([\w-]+):\s*([^;]+);/g)].map(m => [m[1], m[2].trim()]));
};

// El primer `:root` sólo lleva la identidad del logo; el tema claro es el segundo.
const claro = variablesDe(':root', css.indexOf(':root {\n  --c-brand-50'));
const oscuro = variablesDe('html.dark');

const ESCALAS: ScaleName[] = ['brand', 'success', 'warning', 'danger', 'neutral', 'border'];

describe('tokens.ts ↔ index.css', () => {
  it.each([['light', claro], ['dark', oscuro]] as const)('rampas del tema %s', (tema, vars) => {
    for (const escala of ESCALAS) {
      for (const [tono, valor] of Object.entries(themePalettes[tema][escala])) {
        expect([`${escala}-${tono}`, vars.get(`${escala}-${tono}`)]).toEqual([`${escala}-${tono}`, valor]);
      }
    }
  });

  it.each([['light', claro], ['dark', oscuro]] as const)('paleta de gráficos del tema %s', (tema, vars) => {
    for (const [nombre, valor] of Object.entries(vizVars(tema))) {
      expect([nombre, vars.get(nombre)]).toEqual([nombre, valor]);
    }
  });
});
