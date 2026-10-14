import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
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

  it('los grises y fondos salen de la app (no hay hex inventados fuera del acento)', () => {
    expect(coloresLanding.tinta).toBe('#0f172a');
    expect(coloresLanding.lienzo).toBe('#f4f6f9');
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
    ['tinta', 'lavado', 4.5],
    ['tinta-suave', 'lienzo', 4.5],
    ['tinta-suave', 'papel', 4.5],
    ['tinta-suave', 'lienzo-hondo', 4.5],
    ['tinta-suave', 'lavado', 4.5],
    ['tinta-tenue', 'papel', 4.5],
    ['tinta', 'acento', 4.5],          // botón primario
    ['tinta', 'acento-hondo', 4.5],    // botón primario en hover
    ['noche-texto', 'noche', 4.5],
    ['noche-tenue', 'noche', 4.5],
    ['noche-tenue', 'noche-alta', 4.5],
    ['acento', 'noche', 4.5],          // acento como texto solo sobre la sección oscura
    ['logo-tinta', 'logo', 4.5],
    ['exito', 'papel', 4.5],
    ['error', 'papel', 4.5],
    ['tinta-tenue', 'papel', 3],       // borde de los campos del formulario (WCAG 1.4.11)
  ] as const)('%s sobre %s ≥ %s:1', (texto, fondo, minimo) => {
    expect(contraste(texto, fondo)).toBeGreaterThanOrEqual(minimo);
  });

  it('el acento NO sirve como texto sobre claro (por eso nunca se usa así)', () => {
    expect(contraste('acento', 'lienzo')).toBeLessThan(3);
    expect(contraste('papel', 'acento')).toBeLessThan(3);
  });
});
