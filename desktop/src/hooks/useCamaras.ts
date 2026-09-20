/**
 * Cámaras conectadas al equipo y a qué tarea sirve cada una.
 *
 * La lista se refresca cuando el sistema avisa (`devicechange`): en una
 * garita se enchufa y desenchufa una cámara con el equipo encendido y la app
 * no debería necesitar reiniciarse.
 *
 * Nota de permisos: hasta que `getUserMedia` se concede una vez,
 * `enumerateDevices` devuelve los dispositivos con `label` vacío. Por eso la
 * lista se vuelve a leer cuando el panel logra abrir una cámara.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  asignacionPorDefecto, guardarAsignacion, leerAsignacion,
  type AsignacionCamaras, type Camara, type Proposito,
} from '../lib/camaras';

export function useCamaras() {
  const [camaras, setCamaras] = useState<Camara[]>([]);
  const [asignacion, setAsignacion] = useState<AsignacionCamaras>(() => leerAsignacion());
  const [listo, setListo] = useState(false);

  const refrescar = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) { setListo(true); return; }
    try {
      const todos = await navigator.mediaDevices.enumerateDevices();
      const videos = todos
        .filter(d => d.kind === 'videoinput' && d.deviceId)
        .map(d => ({ deviceId: d.deviceId, label: d.label }));
      setCamaras(videos);
      // Primer arranque del equipo: se propone un reparto para no dejar los
      // tres propósitos sin cámara.
      setAsignacion(prev => {
        if (Object.keys(prev).length > 0 || videos.length === 0) return prev;
        const inicial = asignacionPorDefecto(videos);
        guardarAsignacion(inicial);
        return inicial;
      });
    } catch {
      /* Sin lista de dispositivos se sigue con la cámara por defecto. */
    } finally {
      setListo(true);
    }
  }, []);

  useEffect(() => {
    void refrescar();
    const md = navigator.mediaDevices;
    if (!md?.addEventListener) return;
    const alCambiar = () => { void refrescar(); };
    md.addEventListener('devicechange', alCambiar);
    return () => md.removeEventListener('devicechange', alCambiar);
  }, [refrescar]);

  const asignar = useCallback((proposito: Proposito, deviceId: string) => {
    setAsignacion(prev => {
      const siguiente = { ...prev, [proposito]: deviceId };
      guardarAsignacion(siguiente);
      return siguiente;
    });
  }, []);

  return { camaras, asignacion, asignar, refrescar, listo };
}
