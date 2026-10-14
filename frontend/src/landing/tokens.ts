/**
 * Landing — tokens de color
 * ===========================================================================
 * El landing NO inventa paleta: sale de `src/styles/tokens.ts`, la misma
 * fuente que la app. Lo único propio es el acento, porque la marca de la app es
 * carbón monocromo a propósito (el color de la interfaz queda para los estados)
 * y una página de venta necesita un solo color que señale la acción.
 *
 *   - Texto y grises: la rampa `neutral` del tema claro (pizarra con tinte azul).
 *   - Lienzo: el último paso del lavado claro de la app (`canvasGradient`).
 *   - Sección oscura: el lienzo y la superficie del tema OSCURO de la app. Quien
 *     compra y después entra al panel reconoce el mismo azul noche.
 *   - Logo: el chip carbón con el escudo blanco, igual que en la app.
 *   - Acento: cian #00B8D9, de la propuesta del landing. [POR CONFIRMAR: hex real
 *     de la marca]. Sobre claro NUNCA va como texto (2.4:1): es relleno con
 *     texto `tinta` encima (7.5:1) o una línea decorativa.
 *
 * `landing.css` publica estos valores como custom properties `--l-*` en formato
 * "R G B" y `tailwind.landing.config.ts` los expone como utilidades. La prueba
 * `__tests__/tokens.test.ts` comprueba que el CSS y este archivo no se separen.
 */
import { canvasGradient, logo, themePalettes } from '../styles/tokens';

const claro = themePalettes.light;
const oscuro = themePalettes.dark;

/** "R G B" → "#rrggbb". Las rampas de tokens.ts vienen en el formato de Tailwind. */
const hex = (rgb: string): string =>
  '#' + rgb.split(' ').map(n => Number(n).toString(16).padStart(2, '0')).join('');

/** Mezcla lineal en sRGB, igual que `color-mix(in srgb, a p%, b)`. */
const mezclar = (a: string, b: string, p: number): string => {
  const ca = a.match(/[0-9a-f]{2}/gi)!.map(x => parseInt(x, 16));
  const cb = b.match(/[0-9a-f]{2}/gi)!.map(x => parseInt(x, 16));
  return '#' + ca.map((v, i) => Math.round(v * p + cb[i] * (1 - p)).toString(16).padStart(2, '0')).join('');
};

/** Acento del landing. [POR CONFIRMAR: hex real de la marca] */
export const ACENTO = '#00b8d9';

export const coloresLanding = {
  // Texto
  tinta: hex(claro.neutral[50]),          // #0f172a — titulares y cuerpo
  'tinta-suave': hex(claro.neutral[300]), // #475569 — texto secundario (AA sobre todos los fondos claros)
  'tinta-tenue': hex(claro.neutral[400]), // #64748b — bordes de campos (≥ 3:1) y texto ≥ 14 px solo sobre papel/lienzo

  // Superficies claras
  lienzo: canvasGradient.light[2],          // #f4f6f9 — fondo de la página
  'lienzo-hondo': hex(claro.neutral[950]),  // #eef2f6 — bandas alternas y huecos de medios
  lavado: canvasGradient.light[0],          // #dbe8f7 — lavado superior del hero
  papel: hex(claro.neutral[800]),           // #ffffff — formulario, tabla
  linea: hex(claro.border[700]),     // #e2e8f0 — filetes
  'linea-fuerte': hex(claro.border[500]), // #cbd5e1 — filetes con más peso

  // Sección oscura (los tonos del tema oscuro de la app)
  noche: hex(oscuro.neutral[900]),          // #0b1220
  'noche-alta': hex(oscuro.neutral[800]),   // #131c2b
  'noche-linea': hex(oscuro.border[700]), // #2a3850
  'noche-texto': hex(oscuro.neutral[200]),  // #e2e8f0
  'noche-tenue': hex(oscuro.neutral[400]),  // #94a3b8

  // Identidad
  logo: logo.fill,                          // #27272a
  'logo-tinta': logo.ink,                   // #ffffff

  // Acento (relleno; texto encima en `tinta`)
  acento: ACENTO,
  'acento-hondo': mezclar(ACENTO, hex(claro.neutral[50]), 0.88), // hover: 88 % acento + 12 % tinta

  // Estados del formulario
  exito: hex(claro.success[400]),           // #047857
  error: hex(claro.danger[300]),            // #b91c1c
} as const;

export type ColorLanding = keyof typeof coloresLanding;

/** "#rrggbb" → "R G B", el formato que usan las custom properties. */
export const rgbDe = (h: string): string =>
  h.match(/[0-9a-f]{2}/gi)!.map(x => parseInt(x, 16)).join(' ');
