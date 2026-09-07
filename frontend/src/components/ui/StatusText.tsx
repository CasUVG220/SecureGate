import { cx } from './cx';

export type StatusKind = 'on' | 'off' | 'warn' | 'bad';

export interface StatusTextProps {
  kind: StatusKind;
  children: React.ReactNode;
  className?: string;
}

/**
 * Estado de una fila, escrito como texto.
 *
 * Deliberadamente no es una píldora de color con punto: en una tabla donde casi
 * todas las filas están activas, pintarlas todas de verde es ruido y el ojo deja
 * de encontrar lo que importa. Aquí lo normal se lee en tinta tranquila y sólo
 * lo que se sale de la norma —dado de baja, en mora, rechazado— recibe marca y
 * color, que es justo lo que el administrador viene buscando.
 */
export default function StatusText({ kind, children, className }: StatusTextProps) {
  const muted = kind === 'off';
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1.5 whitespace-nowrap text-xs font-medium',
        kind === 'on'   && 'text-gray-300',
        kind === 'off'  && 'text-gray-500',
        kind === 'warn' && 'font-semibold text-warning-400',
        kind === 'bad'  && 'font-semibold text-danger-400',
        className,
      )}
    >
      {/* Sólo los estados que piden atención llevan marca; "activo" no la necesita. */}
      {kind !== 'on' && (
        <span
          aria-hidden="true"
          className={cx(
            'h-1.5 w-1.5 shrink-0 rounded-full',
            muted ? 'bg-gray-600' : 'bg-current',
          )}
        />
      )}
      {children}
    </span>
  );
}
