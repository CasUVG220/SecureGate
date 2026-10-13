/**
 * Búsqueda automática de actualizaciones (T13). Busca a los 30 s de abrir la app y cada 6 h; NUNCA instala sola: `instalar` solo lo llama
 * el botón «Actualizar ahora». Si el instalador no trae llave pública (`configurada: false`) no hace ninguna petición.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, mensajeDe, type EstadoActualizador, type ResultadoBusquedaActualizacion } from '../lib/tauri';
import { INTERVALO_BUSQUEDA_MS, PRIMERA_BUSQUEDA_MS } from '../lib/actualizacion';

export function useActualizaciones() {
  const [estado, setEstado] = useState<EstadoActualizador | null>(null);
  const [hallazgo, setHallazgo] = useState<ResultadoBusquedaActualizacion | null>(null);
  const [buscando, setBuscando] = useState(false);
  const [instalando, setInstalando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const configurada = useRef(false);

  const buscar = useCallback(async () => {
    if (!configurada.current) return;
    setBuscando(true);
    try {
      const r = await api.actualizacion.buscar();
      setHallazgo(r.disponible ? r : null);
      setError(null);
    } catch (e) {
      // Sin red o servidor caído: no es un problema de la garita; se reintenta en la siguiente vuelta.
      setError(mensajeDe(e));
    } finally {
      setBuscando(false);
    }
  }, []);

  useEffect(() => {
    let vivo = true;
    let t1: number | undefined;
    let t2: number | undefined;
    api.actualizacion.estado().then(e => {
      if (!vivo) return;
      setEstado(e);
      configurada.current = e.configurada;
      if (!e.configurada) return;
      t1 = window.setTimeout(() => void buscar(), PRIMERA_BUSQUEDA_MS);
      t2 = window.setInterval(() => void buscar(), INTERVALO_BUSQUEDA_MS);
    }).catch(() => { /* sin estado no hay función: la garita sigue como siempre */ });
    return () => { vivo = false; window.clearTimeout(t1); window.clearInterval(t2); };
  }, [buscar]);

  /** Descarga, instala y reinicia. Si Rust la rechaza (accesos sin enviar, captura) devuelve su mensaje y la app sigue como estaba. */
  const instalar = useCallback(async (capturaEnCurso: boolean): Promise<string | null> => {
    setInstalando(true);
    setError(null);
    try {
      await api.actualizacion.instalar(capturaEnCurso);
      return null;                       // la app se reinicia; normalmente no se llega a ver esto
    } catch (e) {
      const m = mensajeDe(e);
      setError(m);
      return m;
    } finally {
      setInstalando(false);
    }
  }, []);

  return { estado, hallazgo, buscando, instalando, error, buscar, instalar };
}
