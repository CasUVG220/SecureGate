/**
 * Cuántas vistas previas ve el agente y qué tarea ocupa cada una.
 *
 * Se guarda en el equipo (localStorage del WebView): cada garita tiene sus
 * cámaras y su PC, así que la disposición es del puesto, no de la persona
 * que tiene el turno.
 */
import { useCallback, useState } from 'react';
import {
  ajustarPaneles, guardarDisposicion, leerDisposicion,
  type Disposicion, type Layout, type Proposito,
} from '../lib/camaras';

export function useCamarasLayout() {
  const [disposicion, setDisposicion] = useState<Disposicion>(() => leerDisposicion());

  const cambiarLayout = useCallback((layout: Layout) => {
    setDisposicion(prev => {
      // Al pasar de 1 a 2 ó 4 se conserva lo que el agente ya tenía elegido
      // en los paneles que sobreviven, y se rellena el resto por defecto.
      const siguiente: Disposicion = { layout, paneles: ajustarPaneles(prev.paneles, layout) };
      guardarDisposicion(siguiente);
      return siguiente;
    });
  }, []);

  const cambiarPanel = useCallback((indice: number, proposito: Proposito) => {
    setDisposicion(prev => {
      const paneles = prev.paneles.slice();
      paneles[indice] = proposito;
      const siguiente = { ...prev, paneles };
      guardarDisposicion(siguiente);
      return siguiente;
    });
  }, []);

  return { disposicion, cambiarLayout, cambiarPanel };
}
