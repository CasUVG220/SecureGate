import { useEffect, useRef, useState } from 'react';

/**
 * Ancho en píxeles del contenedor, para dibujar el SVG a su tamaño real en vez
 * de estirar un viewBox (que deforma el texto y el grosor de las líneas).
 * Sin ResizeObserver (jsdom) se queda con el ancho inicial.
 */
export function useAncho<T extends HTMLElement>(inicial = 640) {
  const ref = useRef<T | null>(null);
  const [ancho, setAncho] = useState(inicial);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const obs = new ResizeObserver(([entry]) => {
      const w = Math.round(entry.contentRect.width);
      if (w > 0) setAncho(w);
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  return [ref, ancho] as const;
}
