import { useEffect, useState } from 'react';

/**
 * Suscripción a una media query.
 *
 * Los layouts responsive de tablas eligen entre tabla y tarjetas en JS y no con
 * `hidden md:block`: así solo existe un árbol de filas en el DOM, en vez de
 * duplicar cada registro y esconder la mitad con CSS.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia(query);
    const onChange = (e: MediaQueryListEvent) => setMatches(e.matches);
    // Al cambiar la query hay que re-sincronizar antes del primer 'change'.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMatches(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}

/** Por debajo del breakpoint `md` de Tailwind (768px). */
export function useIsCompact(): boolean {
  return useMediaQuery('(max-width: 767px)');
}

/**
 * Por debajo de `lg` (1024px): teléfono y tablet.
 *
 * El portal del residente usa este corte y no `md` porque una tablet en
 * vertical mide 768-834px: entraría en el layout de escritorio cuando en
 * realidad se sostiene con las manos, igual que el teléfono.
 */
export function useIsHandheld(): boolean {
  return useMediaQuery('(max-width: 1023px)');
}
