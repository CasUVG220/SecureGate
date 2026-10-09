import { useCallback, useEffect, useRef, useState } from 'react';
import ConfirmDialog, { type ConfirmDialogProps } from './ConfirmDialog';

export type PeticionConfirmacion = Pick<ConfirmDialogProps, 'title' | 'message' | 'confirmLabel' | 'cancelLabel' | 'tone'>;

/**
 * `window.confirm` con el diálogo de la app. Se usa igual de corto:
 *
 *     const { confirmar, dialogo } = useConfirmacion();
 *     …
 *     if (!(await confirmar({ title: '¿Eliminar el anuncio?', confirmLabel: 'Eliminar', tone: 'danger' }))) return;
 *     …
 *     return (<>…{dialogo}</>);
 *
 * `confirmar` devuelve una promesa: `true` si se confirmó; `false` si se canceló, se cerró con Escape o se pidió
 * otra confirmación encima. `dialogo` va una sola vez en el JSX del componente.
 */
export function useConfirmacion() {
  const [peticion, setPeticion] = useState<(PeticionConfirmacion & { abierta: boolean }) | null>(null);
  const pendiente = useRef<((confirmado: boolean) => void) | null>(null);

  const resolver = useCallback((confirmado: boolean) => {
    pendiente.current?.(confirmado);
    pendiente.current = null;
    setPeticion(p => (p ? { ...p, abierta: false } : p));
  }, []);

  const confirmar = useCallback((p: PeticionConfirmacion) => new Promise<boolean>(resolve => {
    pendiente.current?.(false);
    pendiente.current = resolve;
    setPeticion({ ...p, abierta: true });
  }), []);

  // Si el componente se desmonta con una confirmación abierta, la promesa no se queda colgada.
  useEffect(() => () => { pendiente.current?.(false); pendiente.current = null; }, []);

  const dialogo = peticion ? (
    <ConfirmDialog
      open={peticion.abierta}
      title={peticion.title}
      message={peticion.message}
      confirmLabel={peticion.confirmLabel}
      cancelLabel={peticion.cancelLabel}
      tone={peticion.tone}
      onConfirm={() => resolver(true)}
      onCancel={() => resolver(false)}
    />
  ) : null;

  return { confirmar, dialogo };
}
