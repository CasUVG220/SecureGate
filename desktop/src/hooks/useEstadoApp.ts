/**
 * Estado global de la app (licencia, sesión, sync, OCR) leído de Rust.
 * Se refresca al montar, cada 15 s y cada vez que Rust emite `sg://estado`.
 */
import { useCallback, useEffect, useState } from 'react';
import { api, onEstadoSync, type EstadoApp } from '../lib/tauri';

export function useEstadoApp() {
  const [estado, setEstado] = useState<EstadoApp | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refrescar = useCallback(async () => {
    try {
      setEstado(await api.estado());
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    void refrescar();
    const id = window.setInterval(() => void refrescar(), 15_000);
    let unlisten: (() => void) | undefined;
    void onEstadoSync(sync => setEstado(prev => (prev ? { ...prev, sync } : prev))).then(u => { unlisten = u; });
    return () => { window.clearInterval(id); unlisten?.(); };
  }, [refrescar]);

  return { estado, error, refrescar, setEstado };
}
