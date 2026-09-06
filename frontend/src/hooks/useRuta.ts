import { useCallback, useEffect, useState } from 'react';

/**
 * Enrutado mínimo por `pathname`.
 *
 * El proyecto no tiene router y sólo necesita distinguir dos entradas, así que
 * en vez de sumar una dependencia se usa la History API directamente. La
 * navegación dentro de cada portal sigue siendo estado de React: aquí sólo se
 * decide en cuál de los dos portales estamos.
 */
export function useRuta() {
  const [pathname, setPathname] = useState(() =>
    typeof window === 'undefined' ? '/' : window.location.pathname
  );

  useEffect(() => {
    // Botones atrás/adelante del navegador.
    const alVolver = () => setPathname(window.location.pathname);
    window.addEventListener('popstate', alVolver);
    return () => window.removeEventListener('popstate', alVolver);
  }, []);

  const ir = useCallback((ruta: string, opciones: { reemplazar?: boolean } = {}) => {
    if (typeof window === 'undefined') return;
    if (window.location.pathname === ruta) {
      setPathname(ruta);
      return;
    }
    // `reemplazar` para las correcciones automáticas (alias, portal que no
    // corresponde al rol): no deben dejar rastro en el historial, o el botón
    // atrás devolvería a una ruta que se va a volver a corregir.
    window.history[opciones.reemplazar ? 'replaceState' : 'pushState']({}, '', ruta);
    setPathname(ruta);
  }, []);

  return { pathname, ir };
}
