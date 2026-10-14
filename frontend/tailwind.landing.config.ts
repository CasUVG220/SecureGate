import type { Config } from 'tailwindcss';
import { coloresLanding } from './src/landing/tokens';

/**
 * Tailwind del landing (página pública en `/`).
 *
 * Va aparte del de la app por dos razones:
 *  1. La app mapea `cyan`, `blue`, `teal`… a su marca carbón (ver tailwind.config.ts). Aquí esos nombres no existen:
 *     la paleta es CERRADA (`theme.colors`, no `extend`) y solo tiene los tokens de `src/landing/tokens.ts`.
 *  2. La escala tipográfica también es cerrada (`theme.fontSize`): no hay `text-xl` ni tamaños sueltos, solo los
 *     nueve pasos de abajo.
 *
 * `src/landing/landing.css` lo carga con `@config`, y como el `content` se limita al landing, su CSS no arrastra
 * las utilidades de las pantallas de la app (ni al revés: tailwind.config.ts excluye `src/landing`).
 */
const colores = Object.fromEntries(
  Object.keys(coloresLanding).map(k => [k, `rgb(var(--l-${k}) / <alpha-value>)`]),
);

export default {
  content: ['./src/landing/**/*.{ts,tsx}'],
  theme: {
    colors: { transparent: 'transparent', current: 'currentColor', ...colores },
    fontFamily: {
      // Fuera de la primera, el resto son respaldos mientras carga la fuente (font-display: swap).
      titular: ['"Schibsted Grotesk"', '"Helvetica Neue"', 'Arial', 'sans-serif'],
      texto: ['"Instrument Sans"', '"Helvetica Neue"', 'Arial', 'sans-serif'],
      cifra: ['"IBM Plex Mono"', 'ui-monospace', 'Menlo', 'Consolas', 'monospace'],
    },
    fontSize: {
      // Titular del hero y numerales de los pasos: fluidos entre 360 y 1440 px, con tope.
      mega:      ['clamp(2.5rem, 1.55rem + 4.1vw, 4.75rem)', { lineHeight: '1.02', letterSpacing: '-0.035em' }],
      numeral:   ['clamp(3.5rem, 2.4rem + 4.5vw, 6.5rem)', { lineHeight: '0.9', letterSpacing: '-0.04em' }],
      titulo:    ['clamp(2rem, 1.45rem + 2.3vw, 3.25rem)', { lineHeight: '1.05', letterSpacing: '-0.03em' }],
      subtitulo: ['1.5rem', { lineHeight: '1.2', letterSpacing: '-0.015em' }],
      cifra:     ['1.75rem', { lineHeight: '1.1', letterSpacing: '-0.02em' }],
      entrada:   ['1.25rem', { lineHeight: '1.55', letterSpacing: '-0.005em' }],
      cuerpo:    ['1.0625rem', { lineHeight: '1.65' }],
      detalle:   ['0.9375rem', { lineHeight: '1.55' }],
      rotulo:    ['0.8125rem', { lineHeight: '1.35', letterSpacing: '0.02em' }],
    },
    extend: {
      maxWidth: { medida: '65ch' },
      transitionTimingFunction: { salida: 'cubic-bezier(0.2, 0.7, 0.2, 1)' },
    },
  },
  plugins: [],
} satisfies Config;
