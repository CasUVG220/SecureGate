import { useRef, useState } from 'react';
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
import { Navegacion } from './secciones/Navegacion';
import { Hero } from './secciones/Hero';
import { Tarjetas } from './secciones/Tarjetas';
import { ComoFunciona } from './secciones/ComoFunciona';
import { QueHace } from './secciones/QueHace';
import { Precios } from './secciones/Precios';
import { Preguntas } from './secciones/Preguntas';
import { Contacto } from './secciones/Contacto';
import { Pie } from './secciones/Pie';
import { PAQUETE_DESTACADO, type Paquete, type TramoHogares } from './planes';

/**
 * Landing público de SecureGate (ruta `/`). Una sola acción: pedir una demo (#contacto).
 * Textos y datos: contenido.ts; precios: planes.ts; medios: public/landing/ (docs/landing.md).
 */
export default function Landing() {
  const raiz = useRef<HTMLDivElement>(null);
  useRevelar(raiz);

  // El tramo y el paquete viven aquí: cambiar de paquete (en teléfono) no pierde el tramo elegido, y el formulario
  // recibe el tramo que la persona ELIGIÓ (el tramo por defecto de la tabla no se le impone al formulario).
  const [tramo, setTramo] = useState<TramoHogares>(100);
  const [paquete, setPaquete] = useState<Paquete>(PAQUETE_DESTACADO ?? 'compra');
  const [tramoElegido, setTramoElegido] = useState<TramoHogares | null>(null);
  const elegirTramo = (t: TramoHogares) => {
    setTramo(t);
    setTramoElegido(t);
  };

  return (
    <div ref={raiz} className="relative min-h-screen">
      <a
        href="#contenido"
        className="sr-only z-50 rounded bg-tinta px-4 py-3 font-semibold text-papel focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
      >
        Saltar al contenido
      </a>
      <Navegacion />
      <main id="contenido" tabIndex={-1} className="outline-none">
        <Hero />
        <Tarjetas />
        <ComoFunciona />
        <QueHace />
        <Precios tramo={tramo} onTramo={elegirTramo} paquete={paquete} onPaquete={setPaquete} onPedir={elegirTramo} />
        <Preguntas />
        <Contacto tramoSugerido={tramoElegido} />
      </main>
      <Pie />
    </div>
  );
}
