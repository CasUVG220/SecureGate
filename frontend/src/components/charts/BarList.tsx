import { cx } from '../ui/cx';

export interface BarListItem {
  id: string;
  etiqueta: string;
  valor: number;
}

interface Props {
  items: BarListItem[];
  formato: (n: number) => string;
  /** Referencia de la barra llena; por defecto, el mayor de la lista. */
  max?: number;
  className?: string;
}

/**
 * Ranking horizontal (casas, áreas, tipos de solicitud). Un solo color para
 * todas las barras: son categorías sin orden propio, así que el largo ya dice
 * "cuánto" y teñirlas por valor sólo repetiría la información. El número va
 * rotulado en cada fila, sin depender del hover.
 */
export default function BarList({ items, formato, max, className }: Props) {
  const tope = max ?? Math.max(1, ...items.map(i => i.valor));
  return (
    <ul className={cx('space-y-3.5', className)}>
      {items.map((item, i) => (
        <li key={item.id}>
          <div className="flex items-baseline justify-between gap-3">
            <span className="flex min-w-0 items-baseline gap-2 text-sm">
              <span className="w-4 shrink-0 text-right text-2xs font-semibold tabular-nums text-gray-500" aria-hidden="true">{i + 1}</span>
              <span className="truncate font-semibold text-gray-100">{item.etiqueta}</span>
            </span>
            <span className="shrink-0 text-sm font-bold tabular-nums text-gray-200">{formato(item.valor)}</span>
          </div>
          {/* Crece desde la base (recta) y remata redondeado en el extremo de datos. */}
          <div className="ml-6 mt-1.5 h-2 overflow-hidden rounded-r-[4px] bg-gray-500/10" aria-hidden="true">
            <div
              className="h-full rounded-r-[4px] bg-viz-series transition-[width] duration-500 ease-out"
              style={{ width: `${Math.max(item.valor > 0 ? 2 : 0, (item.valor / tope) * 100)}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
