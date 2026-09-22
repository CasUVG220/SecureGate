import { cx } from '../ui/cx';

export interface FilaTooltip {
  /** Clase de fondo de la llave (el color de la serie). */
  llave: string;
  valor: string;
  etiqueta: string;
  /** La llave es una raya (línea) o un cuadro (barra, celda). */
  forma?: 'linea' | 'cuadro';
}

interface Props {
  titulo: string;
  filas: FilaTooltip[];
  /** Centro horizontal y borde superior deseados, en px del contenedor. */
  x: number;
  y: number;
  anchoContenedor: number;
  /** Por debajo del punto en vez de por encima (celdas de la primera fila). */
  debajo?: boolean;
}

const MEDIO_ANCHO = 88;

/**
 * Tooltip de gráfico. El valor manda (texto fuerte) y el nombre de la serie
 * acompaña: el lector ya sabe qué serie mira, lo que busca es el número. Nunca
 * es la única vía al dato: cada gráfico tiene su vista de tabla.
 */
export default function ChartTooltip({ titulo, filas, x, y, anchoContenedor, debajo }: Props) {
  const izquierda = Math.min(Math.max(x, MEDIO_ANCHO), Math.max(MEDIO_ANCHO, anchoContenedor - MEDIO_ANCHO));
  return (
    <div
      className={cx(
        'pointer-events-none absolute z-10 min-w-[9.5rem] -translate-x-1/2 rounded-lg border border-[rgb(var(--c-hairline))] bg-[rgb(var(--c-surface-raised))] px-3 py-2 shadow-lg',
        debajo ? 'translate-y-2' : 'translate-y-[calc(-100%_-_0.5rem)]',
      )}
      style={{ left: izquierda, top: y }}
      role="presentation"
    >
      <p className="whitespace-nowrap text-2xs font-semibold text-gray-400">{titulo}</p>
      <ul className="mt-1 space-y-0.5">
        {filas.map(f => (
          <li key={f.etiqueta} className="flex items-center gap-2 whitespace-nowrap">
            <span
              aria-hidden="true"
              className={cx('shrink-0', f.llave, f.forma === 'cuadro' ? 'h-2.5 w-2.5 rounded-sm' : 'h-0.5 w-3 rounded-full')}
            />
            <span className="text-sm font-bold text-gray-50">{f.valor}</span>
            <span className="truncate text-xs text-gray-400">{f.etiqueta}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
