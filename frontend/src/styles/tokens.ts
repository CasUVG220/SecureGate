/**
 * SecureGate — Design tokens
 * ===========================================================================
 * Única fuente de verdad del sistema visual. `tailwind.config.ts` consume
 * estas escalas y las publica como utilidades; `src/index.css` publica los
 * valores concretos de cada tema como custom properties.
 *
 * Cómo funciona el tema claro/oscuro
 * ---------------------------------
 * Las paletas NO son valores fijos en Tailwind: cada tono se emite como
 * `rgb(var(--c-<escala>-<tono>) / <alpha-value>)`. `index.css` redefine esas
 * variables bajo `:root` (claro) y `html.dark` (oscuro), de modo que una
 * utilidad como `text-gray-400` significa "texto atenuado" en ambos temas y
 * `bg-brand-500/10` significa "fondo de marca sutil" en ambos temas.
 *
 * Por eso las rampas claras no son la inversión mecánica de las oscuras: los
 * tonos 300-500 se oscurecen en claro para conservar contraste AA sobre
 * superficies blancas, mientras que los tonos 50-200 se mantienen pálidos
 * porque siguen usándose como fondos.
 */

/** Rampa de 11 tonos, en el formato "R G B" que exige la sintaxis de alpha de Tailwind. */
export type Ramp = Record<50 | 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900 | 950, string>;

export type ScaleName = 'brand' | 'success' | 'warning' | 'danger' | 'neutral' | 'border';

const rgb = (hex: string): string => {
  const h = hex.replace('#', '');
  return `${parseInt(h.slice(0, 2), 16)} ${parseInt(h.slice(2, 4), 16)} ${parseInt(h.slice(4, 6), 16)}`;
};

const ramp = (hexes: Record<keyof Ramp, string>): Ramp =>
  Object.fromEntries(Object.entries(hexes).map(([k, v]) => [k, rgb(v)])) as Ramp;

// ── Paletas por tema ───────────────────────────────────────────────────────
// Marca: carbón neutro (escala zinc), sin tinte de color. El único color de la
// interfaz queda para los estados —verde, ámbar, rojo—, que así se leen como
// información y no compiten con la decoración.
//
// El relleno de marca se invierte entre temas: carbón sobre superficies claras,
// gris muy claro sobre las oscuras. Un botón carbón sobre el lienzo oscuro
// (#0b1220) queda por debajo de 1.5:1 y desaparece, así que el tono 500 es
// "relleno de marca" y no "gris oscuro". Por eso existe `--c-brand-ink`: el
// texto encima del relleno es blanco en claro y casi negro en oscuro.

// Oscuro: el relleno (500) es claro y el hover aclara todavía más; 400 es el
// texto de acento (elemento activo del sidebar, eyebrow, badges informativos).
const BRAND_DARK = ramp({
  50: '#18181b', 100: '#27272a', 200: '#3f3f46', 300: '#a1a1aa', 400: '#f4f4f5',
  500: '#e4e4e7', 600: '#f4f4f5', 700: '#d4d4d8', 800: '#a1a1aa', 900: '#71717a', 950: '#52525b',
});

// Claro: el relleno (500) es carbón y el hover oscurece; 400 es el acento sobre
// superficies blancas, con contraste de sobra para texto pequeño.
const BRAND_LIGHT = ramp({
  50: '#fafafa', 100: '#f4f4f5', 200: '#e4e4e7', 300: '#52525b', 400: '#3f3f46',
  500: '#27272a', 600: '#18181b', 700: '#09090b', 800: '#0c0c0e', 900: '#09090b', 950: '#050506',
});

const SUCCESS_DARK = ramp({
  50: '#ecfdf5', 100: '#d1fae5', 200: '#a7f3d0', 300: '#6ee7b7', 400: '#34d399',
  500: '#10b981', 600: '#059669', 700: '#047857', 800: '#065f46', 900: '#064e3b', 950: '#022c22',
});

const SUCCESS_LIGHT = ramp({
  50: '#ecfdf5', 100: '#d1fae5', 200: '#a7f3d0', 300: '#10b981', 400: '#047857',
  500: '#059669', 600: '#047857', 700: '#065f46', 800: '#064e3b', 900: '#053a2c', 950: '#022c22',
});

const WARNING_DARK = ramp({
  50: '#fffbeb', 100: '#fef3c7', 200: '#fde68a', 300: '#fcd34d', 400: '#fbbf24',
  500: '#f59e0b', 600: '#d97706', 700: '#b45309', 800: '#92400e', 900: '#78350f', 950: '#451a03',
});

const WARNING_LIGHT = ramp({
  50: '#fffbeb', 100: '#fef3c7', 200: '#fde68a', 300: '#d97706', 400: '#b45309',
  500: '#c2760a', 600: '#b45309', 700: '#92400e', 800: '#78350f', 900: '#603010', 950: '#451a03',
});

const DANGER_DARK = ramp({
  50: '#fef2f2', 100: '#fee2e2', 200: '#fecaca', 300: '#fca5a5', 400: '#f87171',
  500: '#ef4444', 600: '#dc2626', 700: '#b91c1c', 800: '#991b1b', 900: '#7f1d1d', 950: '#450a0a',
});

const DANGER_LIGHT = ramp({
  50: '#fef2f2', 100: '#fee2e2', 200: '#fecaca', 300: '#ef4444', 400: '#dc2626',
  500: '#dc2626', 600: '#b91c1c', 700: '#991b1b', 800: '#7f1d1d', 900: '#6b1717', 950: '#450a0a',
});

/**
 * Neutral. El extremo 700-950 son superficies y el 50-400 es texto, así que la
 * rampa clara se "pliega": los tonos altos siguen siendo fondos (pero claros) y
 * los bajos siguen siendo texto (pero oscuro).
 */
const NEUTRAL_DARK = ramp({
  50: '#f8fafc', 100: '#f1f5f9', 200: '#e2e8f0', 300: '#cbd5e1', 400: '#94a3b8',
  500: '#64748b', 600: '#3a4a63', 700: '#24324a', 800: '#131c2b', 900: '#0b1220', 950: '#050a14',
});

const NEUTRAL_LIGHT = ramp({
  50: '#0f172a', 100: '#1e293b', 200: '#334155', 300: '#475569', 400: '#64748b',
  500: '#94a3b8', 600: '#dbe2ea', 700: '#f1f5f9', 800: '#ffffff', 900: '#f4f6f9', 950: '#eef2f6',
});

/**
 * Bordes. Van en su propia escala porque `bg-gray-700` (superficie elevada) y
 * `border-gray-700` (línea divisoria) piden valores distintos en tema claro.
 */
const BORDER_DARK = ramp({
  50: '#f8fafc', 100: '#f1f5f9', 200: '#e2e8f0', 300: '#cbd5e1', 400: '#94a3b8',
  500: '#64748b', 600: '#3f4f68', 700: '#2a3850', 800: '#1f2b3e', 900: '#182234', 950: '#0f1726',
});

const BORDER_LIGHT = ramp({
  50: '#0f172a', 100: '#1e293b', 200: '#334155', 300: '#94a3b8', 400: '#b6c2d0',
  500: '#cbd5e1', 600: '#cbd5e1', 700: '#e2e8f0', 800: '#e8edf3', 900: '#eef2f6', 950: '#f4f6f9',
});

export const themePalettes: Record<'light' | 'dark', Record<ScaleName, Ramp>> = {
  light: {
    brand: BRAND_LIGHT, success: SUCCESS_LIGHT, warning: WARNING_LIGHT,
    danger: DANGER_LIGHT, neutral: NEUTRAL_LIGHT, border: BORDER_LIGHT,
  },
  dark: {
    brand: BRAND_DARK, success: SUCCESS_DARK, warning: WARNING_DARK,
    danger: DANGER_DARK, neutral: NEUTRAL_DARK, border: BORDER_DARK,
  },
};

/** Referencia `rgb(var(--c-brand-500) / <alpha-value>)` para el config de Tailwind. */
export const cssVarRamp = (scale: ScaleName): Record<string, string> =>
  Object.fromEntries(
    ([50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const)
      .map(tone => [String(tone), `rgb(var(--c-${scale}-${tone}) / <alpha-value>)`])
  );

// ── Identidad y lienzo ─────────────────────────────────────────────────────

/**
 * Colores del logo. No dependen del tema: el relleno de marca se invierte entre
 * claro y oscuro, y la marca no puede hacer eso. Se conserva la versión de fondo
 * oscuro —chip carbón con el escudo blanco— para los dos temas.
 */
export const logo = { fill: '#27272a', ink: '#ffffff' } as const;

/**
 * Gradiente del lienzo. Es un lavado, no un fondo protagonista: tres paradas
 * repartidas sobre el alto de la ventana, de modo que cubre la pantalla entera
 * en lugar de agotarse a una distancia fija y dejar el pie plano.
 */
export const canvasGradient = {
  light: ['#dbe8f7', '#eaf0f7', '#f4f6f9'],
  dark:  ['#16243d', '#101a2c', '#0b1220'],
} as const;

// ── Escala tipográfica ─────────────────────────────────────────────────────
// Una sola familia en todo el proyecto (Outfit) y line-heights atados al
// tamaño, para que ninguna pantalla tenga que inventar `leading-[1.15]`.

export const fontFamily = {
  sans: ['Outfit', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
  mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
} as const;

export const fontSize: Record<string, [string, { lineHeight: string; letterSpacing?: string; fontWeight?: string }]> = {
  '2xs': ['0.6875rem', { lineHeight: '1rem',     letterSpacing: '0.04em' }],
  xs:    ['0.75rem',   { lineHeight: '1.125rem', letterSpacing: '0.01em' }],
  sm:    ['0.875rem',  { lineHeight: '1.375rem' }],
  base:  ['1rem',      { lineHeight: '1.5rem' }],
  lg:    ['1.125rem',  { lineHeight: '1.75rem',  letterSpacing: '-0.01em' }],
  xl:    ['1.25rem',   { lineHeight: '1.875rem', letterSpacing: '-0.015em' }],
  '2xl': ['1.5rem',    { lineHeight: '2rem',     letterSpacing: '-0.02em' }],
  '3xl': ['1.875rem',  { lineHeight: '2.25rem',  letterSpacing: '-0.025em' }],
  '4xl': ['2.25rem',   { lineHeight: '2.5rem',   letterSpacing: '-0.03em' }],
  '5xl': ['3rem',      { lineHeight: '1.05',     letterSpacing: '-0.035em' }],
};

// ── Radios, sombras y elevación ────────────────────────────────────────────
// `rounded-lg` (controles) y `rounded-xl` (tarjetas) son el estándar; los
// radios mayores quedan para superficies grandes (hero, drawer).

export const borderRadius = {
  lg: '0.625rem',
  xl: '0.875rem',
  '2xl': '1.125rem',
  '3xl': '1.5rem',
} as const;

export const boxShadow = {
  xs:   '0 1px 2px rgb(var(--c-shadow) / 0.35)',
  sm:   '0 1px 3px rgb(var(--c-shadow) / 0.4), 0 1px 2px -1px rgb(var(--c-shadow) / 0.3)',
  DEFAULT: '0 2px 6px rgb(var(--c-shadow) / 0.4)',
  md:   '0 6px 16px -4px rgb(var(--c-shadow) / 0.45)',
  lg:   '0 12px 28px -8px rgb(var(--c-shadow) / 0.5)',
  xl:   '0 24px 48px -16px rgb(var(--c-shadow) / 0.55)',
  card: '0 1px 2px rgb(var(--c-shadow) / 0.3), 0 8px 24px -12px rgb(var(--c-shadow) / 0.45)',
  none: 'none',
} as const;

/** Alturas de control: todos los inputs y botones comparten estas tres medidas. */
export const controlHeight = { sm: '2rem', md: '2.5rem', lg: '3rem' } as const;

export const zIndex = {
  drawer: 40,
  header: 50,
  modal: 100,
  toast: 200,
} as const;
