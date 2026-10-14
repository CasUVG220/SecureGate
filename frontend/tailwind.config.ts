import type { Config } from 'tailwindcss';
import {
  borderRadius, boxShadow, controlHeight, cssVarRamp, fontFamily, fontSize, vizColors, zIndex,
} from './src/styles/tokens';

/**
 * Las paletas salen de `src/styles/tokens.ts` y se resuelven en runtime contra
 * las custom properties que `src/index.css` define para cada tema. Añadir un
 * alias aquí (p. ej. `blue` → marca) es la forma de migrar clases heredadas sin
 * tocar 30 pantallas a la vez.
 */
const brand   = cssVarRamp('brand');
const success = cssVarRamp('success');
const warning = cssVarRamp('warning');
const danger  = cssVarRamp('danger');
const neutral = cssVarRamp('neutral');
const border  = cssVarRamp('border');

export default {
  // El landing (src/landing) tiene su propio Tailwind: tailwind.landing.config.ts.
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}', '!./src/landing/**'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily,
      fontSize,
      borderRadius,
      boxShadow,
      zIndex: Object.fromEntries(Object.entries(zIndex).map(([k, v]) => [k, String(v)])),
      height: { control: controlHeight.md, 'control-sm': controlHeight.sm, 'control-lg': controlHeight.lg },
      minHeight: { control: controlHeight.md, 'control-sm': controlHeight.sm, 'control-lg': controlHeight.lg },
      colors: {
        // `brand.ink` es el color del texto sobre un relleno de marca: blanco en
        // claro, casi negro en oscuro (ver la nota de inversión en tokens.ts).
        brand: { ...brand, ink: 'rgb(var(--c-brand-ink) / <alpha-value>)' },
        success,
        warning,
        danger,
        neutral,
        gray: neutral,
        slate: neutral,
        zinc: neutral,

        // Aliases heredados: el código anterior pinta con estos nombres y así
        // hereda la paleta correcta en ambos temas sin reescribirse.
        blue: brand,
        teal: brand,
        cyan: brand,
        indigo: brand,
        purple: brand,
        green: success,
        emerald: success,
        amber: warning,
        yellow: warning,
        red: danger,
        rose: danger,

        // Identidad del logo: idéntica en ambos temas (ver tokens.ts).
        logo: {
          DEFAULT: 'rgb(var(--c-logo) / <alpha-value>)',
          ink: 'rgb(var(--c-logo-ink) / <alpha-value>)',
        },

        // Paleta de gráficos (ver "Visualización de datos" en tokens.ts).
        viz: vizColors,

        // Superficies del shell (header, sidebar, canvas).
        dark: {
          900: 'rgb(var(--c-canvas) / <alpha-value>)',
          800: 'rgb(var(--c-shell) / <alpha-value>)',
          700: 'rgb(var(--c-surface-raised) / <alpha-value>)',
        },
      },
      borderColor: { ...border, DEFAULT: 'rgb(var(--c-border-700) / <alpha-value>)' },
      divideColor: border,
      ringColor: { ...brand, DEFAULT: 'rgb(var(--c-brand-500) / <alpha-value>)' },
      keyframes: {
        'sg-fade-in':   { from: { opacity: '0' }, to: { opacity: '1' } },
        'sg-scale-in':  { from: { opacity: '0', transform: 'translateY(8px) scale(0.98)' }, to: { opacity: '1', transform: 'none' } },
        'sg-slide-up':  { from: { transform: 'translateY(100%)' }, to: { transform: 'none' } },
      },
      animation: {
        'sg-fade-in':  'sg-fade-in 160ms ease-out',
        'sg-scale-in': 'sg-scale-in 180ms cubic-bezier(0.16, 1, 0.3, 1)',
        'sg-slide-up': 'sg-slide-up 220ms cubic-bezier(0.16, 1, 0.3, 1)',
      },
    },
  },
  plugins: [],
} satisfies Config;
