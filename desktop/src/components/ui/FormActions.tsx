import { cx } from './cx';

export interface FormActionsProps {
  /** Botones: normalmente «Guardar» y, si aplica, «Cancelar». */
  children: React.ReactNode;
  /** Texto a la izquierda: estado del formulario («Hay cambios sin guardar»). */
  nota?: React.ReactNode;
  className?: string;
}

/**
 * Barra de acciones de un formulario largo.
 *
 * En un formulario con muchos campos el botón «Guardar» quedaba al final de la página y
 * había que desplazarse hasta él para confirmar. Esta barra se pega al borde inferior del
 * área visible mientras el formulario no ha terminado, y en el último tramo se asienta en
 * su sitio (`position: sticky`). Dentro de un `<Modal>` no hace falta: el modal ya fija su
 * `footer` fuera del área que se desplaza.
 */
export default function FormActions({ children, nota, className }: FormActionsProps) {
  return (
    <div
      className={cx(
        'sticky bottom-3 z-10 flex flex-wrap items-center justify-end gap-3 rounded-xl border px-4 py-3 shadow-lg backdrop-blur',
        'border-[rgb(var(--c-border-700))] bg-[rgb(var(--c-surface))]/95',
        className,
      )}
    >
      {nota && <p role="status" className="mr-auto min-w-0 text-xs font-medium text-warning-400">{nota}</p>}
      {children}
    </div>
  );
}
