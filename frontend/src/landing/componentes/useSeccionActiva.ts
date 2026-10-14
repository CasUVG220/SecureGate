import { useEffect, useState } from 'react';

/**
 * Sección que está a la vista (para marcar el enlace de la barra). Una franja estrecha a media pantalla decide:
 * la sección que la cruza es la activa. IntersectionObserver, sin escuchar el scroll.
 */
export function useSeccionActiva(ids: readonly string[]): string | null {
  const [activa, setActiva] = useState<string | null>(null);

  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;
    const observador = new IntersectionObserver(
      entradas => {
        for (const e of entradas) {
          if (e.isIntersecting) setActiva(e.target.id);
          else setActiva(previa => (previa === e.target.id ? null : previa));
        }
      },
      { rootMargin: '-45% 0px -50% 0px', threshold: 0 },
    );
    for (const id of ids) {
      const el = document.getElementById(id);
      if (el) observador.observe(el);
    }
    return () => observador.disconnect();
  }, [ids]);

  return activa;
}
