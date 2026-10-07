import { useEffect, useRef } from 'react';

/**
 * Sondeo ligero: llama a `alActualizar` cada `intervaloMs` mientras la pestaña esté visible.
 *
 * Es la forma barata de que algo que cambia en el servidor (el estado de una solicitud, los
 * mensajes del chat, las reservas por aprobar) se actualice solo sin recargar la página. No
 * es tiempo real —eso pediría WebSockets—, pero evita el defecto de mirar un dato viejo
 * horas.
 *
 *  - No sondea con la pestaña oculta; al volver a verla actualiza de inmediato.
 *  - Sin acumulación: si una llamada sigue en curso no lanza otra encima.
 *  - Los errores se tragan (un fallo de red no debe romper la pantalla); el siguiente intento reintenta.
 */
export function usePolling(
  alActualizar: () => void | Promise<unknown>,
  intervaloMs: number,
  activo = true,
): void {
  const cb = useRef(alActualizar);
  useEffect(() => { cb.current = alActualizar; });

  useEffect(() => {
    if (!activo || intervaloMs <= 0) return;
    let enCurso = false;
    let vivo = true;

    const tick = async () => {
      if (!vivo || enCurso || document.visibilityState === 'hidden') return;
      enCurso = true;
      try { await cb.current(); } catch { /* el siguiente ciclo reintenta */ } finally { enCurso = false; }
    };

    const id = window.setInterval(() => { void tick(); }, intervaloMs);
    const alVolver = () => { if (document.visibilityState === 'visible') void tick(); };
    document.addEventListener('visibilitychange', alVolver);
    return () => {
      vivo = false;
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', alVolver);
    };
  }, [intervaloMs, activo]);
}
