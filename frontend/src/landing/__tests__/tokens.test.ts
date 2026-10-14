import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { canvasGradient, logo, themePalettes, vizPalettes } from '../../styles/tokens';
import { coloresLanding, rgbDe, type ColorLanding } from '../tokens';

/**
 * `landing.css` repite los valores de `src/landing/tokens.ts` como custom properties `--l-*`. Este test compara las
 * dos copias (igual que styles/__tests__/tokens.sync.test.ts con index.css) y mide el contraste WCAG de cada pareja
 * de texto y fondo que usa la página: el criterio de aceptación es AA (4.5:1 texto, 3:1 bordes de controles).
 */
const css = readFileSync(path.resolve(__dirname, '../landing.css'), 'utf8');
const bloque = css.slice(css.indexOf(':root {'), css.indexOf('\n}', css.indexOf(':root {')));
const vars = new Map([...bloque.matchAll(/--l-([\w-]+):\s*([\d\s]+);/g)].map(m => [m[1], m[2].trim()]));

const canal = (v: number) => {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const luminancia = (hex: string) => {
  const [r, g, b] = rgbDe(hex).split(' ').map(Number);
  return 0.2126 * canal(r) + 0.7152 * canal(g) + 0.0722 * canal(b);
};
const contraste = (a: ColorLanding, b: ColorLanding) => {
  const [l1, l2] = [luminancia(coloresLanding[a]), luminancia(coloresLanding[b])].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
};

describe('tokens del landing ↔ landing.css', () => {
  it('cada color de tokens.ts está en el CSS con el mismo valor', () => {
    for (const [nombre, valor] of Object.entries(coloresLanding)) {
      expect([nombre, vars.get(nombre)]).toEqual([nombre, rgbDe(valor)]);
    }
  });

  it('el CSS no declara colores que tokens.ts no conoce', () => {
    const conocidos = new Set(Object.keys(coloresLanding));
    expect([...vars.keys()].filter(k => !conocidos.has(k))).toEqual([]);
  });

  it('no hay colores propios: cada color del landing existe en los tokens de la app', () => {
    const hex = (rgb: string) => '#' + rgb.split(' ').map(n => Number(n).toString(16).padStart(2, '0')).join('');
    const deLaApp = new Set<string>([
      ...Object.values(themePalettes).flatMap(t => Object.values(t).flatMap(r => Object.values(r).map(hex))),
      ...canvasGradient.light, ...canvasGradient.dark, logo.fill, logo.ink,
      vizPalettes.light.series, vizPalettes.dark.series,
    ].map(c => c.toLowerCase()));
    for (const [nombre, valor] of Object.entries(coloresLanding)) expect([nombre, deLaApp.has(valor.toLowerCase())]).toEqual([nombre, true]);
  });

  it('el azul de la marca es el marino del acceso de la app, y el fondo es blanco', () => {
    expect(coloresLanding.marca).toBe('#16243d');
    expect(coloresLanding.lienzo).toBe('#ffffff');
    expect(coloresLanding.noche).toBe('#0b1220');
    expect(coloresLanding.logo).toBe('#27272a');
  });
});

describe('contraste AA de las parejas que usa la página', () => {
  it.each([
    // [texto, fondo, mínimo]
    ['tinta', 'lienzo', 4.5],
    ['tinta', 'papel', 4.5],
    ['tinta', 'lienzo-hondo', 4.5],
    ['tinta-suave', 'lienzo', 4.5],
    ['tinta-suave', 'papel', 4.5],
    ['tinta-suave', 'lienzo-hondo', 4.5],
    ['tinta-tenue', 'papel', 4.5],
    ['papel', 'marca', 4.5],           // botón primario y textos de la barra
    ['papel', 'marca-hondo', 4.5],     // botón primario en hover
    ['noche-texto', 'marca', 4.5],     // enlaces de la barra
    ['marca', 'lienzo-hondo', 4.5],    // «Pedir demo» invertido en hover, y la marca de la regla de hogares
    ['noche-texto', 'noche', 4.5],
    ['noche-tenue', 'noche', 4.5],
    ['noche-tenue', 'noche-alta', 4.5],
    ['papel', 'noche-alta', 4.5],      // acentos blancos de la sección oscura
    ['logo-tinta', 'logo', 4.5],
    ['exito', 'papel', 4.5],
    ['error', 'papel', 4.5],
    ['tinta-tenue', 'papel', 3],       // borde de los campos del formulario (WCAG 1.4.11)
  ] as const)('%s sobre %s ≥ %s:1', (texto, fondo, minimo) => {
    expect(contraste(texto, fondo)).toBeGreaterThanOrEqual(minimo);
  });

});
