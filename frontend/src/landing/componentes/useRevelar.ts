import { useLayoutEffect, type RefObject } from 'react';

/**
 * Revelado discreto por sección: los elementos con `data-revelar` suben 18 px y aparecen cuando entran en pantalla.
 *
 * - IntersectionObserver y nada más (sin librerías de animación). Se usa `threshold: 0` con un margen inferior en vez
 *   de un porcentaje del elemento: un bloque más alto que la ventana nunca llegaría a «12 % visible» en un teléfono.
 * - `useLayoutEffect`: la clase que esconde se pone ANTES del primer pintado; con un efecto normal el contenido
 *   aparecería, desaparecería y volvería a aparecer.
 * - Sin observador o con `prefers-reduced-motion: reduce` no se arma nada: todo queda visible desde el principio.
 * - Al desmontar quita la clase de <html> (la app autenticada nunca la hereda).
 */
export function useRevelar(raiz: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const el = raiz.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;

    const html = document.documentElement;
    html.classList.add('l-revelar-activo');
    const observador = new IntersectionObserver(
      entradas => {
        for (const e of entradas) {
          if (!e.isIntersecting) continue;
          e.target.setAttribute('data-visible', '');
          observador.unobserve(e.target);
        }
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0 },
    );
    el.querySelectorAll('[data-revelar]').forEach(n => observador.observe(n));
    return () => {
      observador.disconnect();
      html.classList.remove('l-revelar-activo');
    };
  }, [raiz]);
}
