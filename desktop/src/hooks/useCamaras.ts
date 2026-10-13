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
import { api, type CamaraRed } from '../lib/tauri';

export function useCamaras() {
  const [camaras, setCamaras] = useState<Camara[]>([]);
  const [asignacion, setAsignacion] = useState<AsignacionCamaras>(() => leerAsignacion());
  const [listo, setListo] = useState(false);
  /** Cámaras IP y celulares guardadas en este equipo (T8). Sin credenciales: solo `con_credenciales`. */
  const [camarasRed, setCamarasRed] = useState<CamaraRed[]>([]);

  const recargarRed = useCallback(async () => {
    try {
      setCamarasRed(await api.camaras.listar());
    } catch {
      /* Sin el puente de Rust (pruebas, versión anterior) solo hay cámaras USB. */
    }
  }, []);
  useEffect(() => { void recargarRed(); }, [recargarRed]);

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

  /**
   * Asigna una cámara a una tarea. `valor` es el `deviceId` de una USB (como antes), `red:<id>` para una cámara IP o celular, o `''` para
   * «la predeterminada del sistema». Una tarea usa una sola cámara: elegir una la quita de la anterior (en el puente de Rust).
   */
  const asignar = useCallback(async (proposito: Proposito, valor: string) => {
    const idRed = valor.startsWith('red:') ? valor.slice(4) : null;
    try {
      for (const c of camarasRed) {
        const tiene = c.tareas.includes(proposito);
        if (tiene && c.id !== idRed) await api.camaras.asignar(c.id, c.tareas.filter(t => t !== proposito));
      }
      const elegida = idRed ? camarasRed.find(c => c.id === idRed) : undefined;
      if (elegida && !elegida.tareas.includes(proposito)) await api.camaras.asignar(elegida.id, [...elegida.tareas, proposito]);
    } catch {
      /* Si el puente no responde, la asignación de cámaras USB (abajo) sigue funcionando. */
    }
    await recargarRed();
    if (!idRed) {
      setAsignacion(prev => {
        const siguiente = { ...prev, [proposito]: valor };
        guardarAsignacion(siguiente);
        return siguiente;
      });
    }
  }, [camarasRed, recargarRed]);

  return { camaras, asignacion, asignar, refrescar, listo, camarasRed, recargarRed };
}
