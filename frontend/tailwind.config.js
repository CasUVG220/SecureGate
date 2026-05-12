/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['Outfit', 'sans-serif'],
      },
      colors: {
        // gray → slate (cool dark surfaces — keep)
        gray: {
          50:  '#f8fafc',
          100: '#f1f5f9',
          200: '#e2e8f0',
          300: '#cbd5e1',
          400: '#94a3b8',
          500: '#64748b',
          600: '#475569',
          700: '#334155',
          750: '#2a3548',
          800: '#1e293b',
          900: '#0f172a',
          950: '#020617',
        },

        // blue → zinc neutral (charcoal buttons, no color cast at all)
        blue: {
          50:  '#fafafa',
          100: '#f4f4f5',
          200: '#e4e4e7',
          300: '#d4d4d8',
          400: '#a1a1aa',
          500: '#71717a',
          600: '#52525b',
          700: '#3f3f46',
          800: '#27272a',
          900: '#18181b',
          950: '#09090b',
        },

        // brand → same zinc (all brand-* classes become neutral charcoal)
        brand: {
          50:  '#fafafa',
          100: '#f4f4f5',
          200: '#e4e4e7',
          300: '#d4d4d8',
          400: '#a1a1aa',
          500: '#71717a',
          600: '#52525b',
          700: '#3f3f46',
          800: '#27272a',
          900: '#18181b',
          950: '#09090b',
        },

        // purple → near-black (logo/brand gradient ends at #09090b — charcoal→black)
        purple: {
          50:  '#f4f4f5',
          100: '#e4e4e7',
          200: '#d4d4d8',
          300: '#a1a1aa',
          400: '#71717a',
          500: '#52525b',
          600: '#09090b',
          700: '#050506',
          800: '#030304',
          900: '#020202',
          950: '#010101',
        },

        // green → muted emerald (status only: active/success, not neon lime)
        green: {
          50:  '#ecfdf5',
          100: '#d1fae5',
          200: '#a7f3d0',
          300: '#6ee7b7',
          400: '#34d399',
          500: '#10b981',
          600: '#059669',
          700: '#047857',
          800: '#065f46',
          900: '#064e3b',
          950: '#022c22',
        },

        // teal → muted (accent text, not neon)
        teal: {
          50:  '#f0faf9',
          100: '#d2eeeb',
          200: '#a6ddd8',
          300: '#72c5bf',
          400: '#3ea99f',
          500: '#278b84',
          600: '#1d716c',
          700: '#185b58',
          800: '#154948',
          900: '#133c3b',
          950: '#0a2524',
        },

        dark: {
          900: '#0B0F19',
          800: '#131A2A',
          700: '#1E293B',
        },
      },
      boxShadow: {
        // zinc-based glow — very subtle, security aesthetic
        'glow':    '0 0 18px rgba(39, 39, 42, 0.7)',
        'glow-lg': '0 0 30px rgba(39, 39, 42, 0.9)',
      },
    },
  },
  plugins: [],
}
