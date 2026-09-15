import type { Config } from 'tailwindcss';
import base from '../frontend/tailwind.config';

/**
 * Mismo design system que la web: se importa el config del frontend tal
 * cual (tokens, paletas por tema, tipografía, radios, sombras, animaciones)
 * y sólo se cambia qué archivos escanea Tailwind. Si el frontend cambia un
 * token, la app de escritorio lo hereda en el siguiente build.
 *
 * `relative: true` porque `tauri dev`/`tauri build` pueden correr con
 * otro cwd; así los globs se resuelven contra este archivo.
 */
export default {
  ...base,
  content: {
    relative: true,
    files: ['./index.html', './src/**/*.{ts,tsx}'],
  },
} satisfies Config;
