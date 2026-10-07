import { useCallback, useState } from 'react';

/**
 * ¿El formulario difiere de lo último que se cargó o guardó?
 *
 * Se llama a `marcarGuardado(valor)` al cargar los datos y tras guardar; `hayCambios` es true mientras
 * `valor` (serializado) sea distinto de esa base. Sirve para decirle a quien edita que «hay cambios sin
 * guardar» en la barra fija de acciones, sin tocar cada `onChange`.
 */
export function useCambiosSinGuardar<T>(valor: T): { hayCambios: boolean; marcarGuardado: (v: T) => void } {
  const [base, setBase] = useState<string | null>(null);
  const marcarGuardado = useCallback((v: T) => setBase(JSON.stringify(v)), []);
  return { hayCambios: base !== null && base !== JSON.stringify(valor), marcarGuardado };
}
