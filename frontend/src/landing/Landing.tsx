import { useRef } from 'react';
// Fuentes autoalojadas (@fontsource, subconjunto latino, font-display: swap). Solo los pesos que se usan.
import '@fontsource/schibsted-grotesk/latin-700.css';
import '@fontsource/schibsted-grotesk/latin-800.css';
import '@fontsource/instrument-sans/latin-400.css';
import '@fontsource/instrument-sans/latin-500.css';
import '@fontsource/instrument-sans/latin-600.css';
import '@fontsource/ibm-plex-mono/latin-400.css';
import '@fontsource/ibm-plex-mono/latin-500.css';
import './landing.css';
import { useRevelar } from './componentes/useRevelar';

/**
 * Landing público de SecureGate (ruta `/`). Una sola acción: pedir una demo (#contacto).
 * Textos y datos: contenido.ts; precios: planes.ts; medios: public/landing/ (docs/landing.md).
 */
export default function Landing() {
  const raiz = useRef<HTMLDivElement>(null);
  useRevelar(raiz);

  return (
    <div ref={raiz} className="min-h-screen">
      <a
        href="#contenido"
        className="sr-only z-50 rounded bg-tinta px-4 py-3 font-semibold text-papel focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
      >
        Saltar al contenido
      </a>
      <main id="contenido" tabIndex={-1} className="outline-none" />
    </div>
  );
}
