/**
 * Landing — tokens de color
 * ===========================================================================
 * El landing NO inventa colores: todos salen de `src/styles/tokens.ts`, la misma fuente que la app
 * (`__tests__/tokens.test.ts` falla si aparece uno que la app no tenga).
 *
 *   - Texto y grises: la rampa `neutral` del tema claro (pizarra con tinte azul).
 *   - Lienzo: blanco, el mismo «papel» de la app.
 *   - Marca (el azul SecureGate): la parte alta del lienzo del tema OSCURO de la app, el azul marino que se ve en el
 *     acceso (`/personal`). Barra de navegación, botones de «Pedir demo» y los pocos acentos sobre fondo claro.
 *   - Sección oscura: el lienzo y la superficie del tema oscuro de la app; ahí el acento es blanco, como en ese tema.
 *   - Logo: el chip carbón con el escudo blanco, igual que en la app.
 *
 * `landing.css` publica estos valores como custom properties `--l-*` en formato "R G B" y `tailwind.landing.config.ts`
 * los expone como utilidades. La prueba comprueba que el CSS y este archivo no se separen.
 */
import { canvasGradient, logo, themePalettes } from '../styles/tokens';

const claro = themePalettes.light;
const oscuro = themePalettes.dark;

/** "R G B" → "#rrggbb". Las rampas de tokens.ts vienen en el formato de Tailwind. */
const hex = (rgb: string): string =>
  '#' + rgb.split(' ').map(n => Number(n).toString(16).padStart(2, '0')).join('');

export const coloresLanding = {
  // Texto
  tinta: hex(claro.neutral[50]),          // #0f172a — titulares y cuerpo
  'tinta-suave': hex(claro.neutral[300]), // #475569 — texto secundario (AA sobre todos los fondos claros)
  'tinta-tenue': hex(claro.neutral[400]), // #64748b — bordes de campos (≥ 3:1) y texto ≥ 14 px solo sobre papel/lienzo

  // Superficies claras
  lienzo: hex(claro.neutral[800]),         // #ffffff — fondo de la página (blanco, como el papel de la app)
  'lienzo-hondo': hex(claro.neutral[950]),  // #eef2f6 — bandas alternas y huecos de medios
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

  // Marca: el azul SecureGate (relleno; texto encima en blanco)
  marca: canvasGradient.dark[0],            // #16243d — barra de navegación, «Pedir demo», acentos sobre claro
  'marca-hondo': canvasGradient.dark[2],    // #0b1220 — hover de los botones de marca

  // Estados del formulario
  exito: hex(claro.success[400]),           // #047857
  error: hex(claro.danger[300]),            // #b91c1c
} as const;

export type ColorLanding = keyof typeof coloresLanding;

/** "#rrggbb" → "R G B", el formato que usan las custom properties. */
export const rgbDe = (h: string): string =>
  h.match(/[0-9a-f]{2}/gi)!.map(x => parseInt(x, 16)).join(' ');
