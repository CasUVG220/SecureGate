/**
 * Una cámara de red (IP o celular) en un panel: la enciende en el puente de Rust, vigila su estado y entrega la dirección de la vista
 * previa y la captura de fotogramas para el OCR.
 *
 * Lo que llega aquí NO incluye credenciales (el puente las usa por su lado). Varios paneles pueden mostrar la misma cámara (la misma
 * cámara asignada a la placa y a la salida): se cuenta cuántos la usan y solo se apaga cuando el último se va.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, mensajeDe, type CamaraRed, type EstadoFuente } from '../lib/tauri';
import { urlVista } from '../lib/camarasRed';

const usos = new Map<string, number>();
const INTERVALO_ESTADO_MS = 1500;

export interface CamaraRedEnVivo {
  estado: EstadoFuente | null;
  /** Dirección para un `<img>`; solo cuando está en vivo. */
  urlVista: string | null;
  /** Fallo al encender (no al reconectar): el texto ya está listo para mostrarse. */
  error: string | null;
  /** Un JPEG en base64 (sin prefijo) para el OCR, o `null` si no se pudo (el motivo queda en `errorCaptura`). */
  capturar: () => Promise<string | null>;
  errorCaptura: string | null;
  reintentar: () => void;
}

export function useCamaraRed(camara: Pick<CamaraRed, 'id'> | null): CamaraRedEnVivo {
  const id = camara?.id ?? null;
  const [estado, setEstado] = useState<EstadoFuente | null>(null);
  const [info, setInfo] = useState<{ puerto: number; token: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorCaptura, setErrorCaptura] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [intento, setIntento] = useState(0);
  const anterior = useRef<EstadoFuente['estado'] | null>(null);

  useEffect(() => {
    if (!id) {
      setEstado(null); setInfo(null); setError(null);
      return;
    }
    let vivo = true;
    usos.set(id, (usos.get(id) ?? 0) + 1);
    setEstado({ estado: 'conectando' });
    setError(null);
    anterior.current = null;

    void (async () => {
      try {
        const i = await api.camaras.puente();
        if (vivo) setInfo(i);
        await api.camaras.encender(id);
      } catch (e) {
        if (vivo) { setError(mensajeDe(e)); setEstado({ estado: 'caida', motivo: mensajeDe(e), intentos: 1, reintentando: false }); }
      }
    })();

    const t = window.setInterval(() => {
      void api.camaras.estado().then(todos => {
        const e = todos[id];
        if (!vivo || !e) return;
        // Al (re)conectar, la imagen se pide de nuevo: un <img> con el flujo cortado no se recupera solo.
        if (anterior.current !== 'conectada' && e.estado === 'conectada') setVersion(v => v + 1);
        anterior.current = e.estado;
        setEstado(e);
      }).catch(() => { /* sin respuesta del puente: se conserva el último estado */ });
    }, INTERVALO_ESTADO_MS);

    return () => {
      vivo = false;
      window.clearInterval(t);
      const n = (usos.get(id) ?? 1) - 1;
      if (n <= 0) { usos.delete(id); void Promise.resolve(api.camaras.apagar(id)).catch(() => {}); }
      else usos.set(id, n);
    };
  }, [id, intento]);

  const capturar = useCallback(async (): Promise<string | null> => {
    if (!id) return null;
    setErrorCaptura(null);
    try {
      return (await api.camaras.fotograma(id)).jpeg_base64;
    } catch (e) {
      setErrorCaptura(mensajeDe(e));
      return null;
    }
  }, [id]);

  const reintentar = useCallback(() => setIntento(n => n + 1), []);

  return {
    estado, error, capturar, errorCaptura, reintentar,
    urlVista: id && info && estado?.estado === 'conectada' ? urlVista(info, id, version) : null,
  };
}
