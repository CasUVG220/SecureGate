import { useIsCompact } from '../../hooks/useMediaQuery';
import { cx } from './cx';
import { CardSkeleton, TableSkeleton } from './Skeleton';

export interface Column<T> {
  /** Identificador estable de la columna (también su `key` de React). */
  key: string;
  header: React.ReactNode;
  cell: (row: T) => React.ReactNode;
  align?: 'left' | 'right' | 'center';
  /** No se muestra en el layout de tarjetas de móvil. */
  hideOnMobile?: boolean;
  /** Columna que titula la tarjeta en móvil (normalmente la casa o el nombre). */
  primary?: boolean;
  /** Columna de acciones: en móvil baja al pie de la tarjeta, sin etiqueta. */
  actions?: boolean;
  className?: string;
  headerClassName?: string;
}

export interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  loading?: boolean;
  /** Se muestra cuando no hay filas y no se está cargando (normalmente `<EmptyState/>`). */
  empty?: React.ReactNode;
  onRowClick?: (row: T) => void;
  /** Envuelve la tabla en `.sg-table-wrap`. Desactívalo si ya vive dentro de una card. */
  bare?: boolean;
  className?: string;
  caption?: string;
  /** Clases extra por fila (p. ej. resaltar el elemento recién creado). */
  rowClassName?: (row: T) => string | false | null | undefined;
}

const ALIGN = { left: 'text-left', right: 'text-right', center: 'text-center' } as const;

/**
 * Tabla responsive.
 *
 * A partir de `md` se dibuja como tabla; por debajo, cada fila se convierte en
 * una tarjeta con pares etiqueta/valor. Es la diferencia entre leer los pagos
 * en el teléfono y tener que arrastrar la tabla en horizontal.
 */
export default function DataTable<T>({
  columns, rows, rowKey, loading = false, empty, onRowClick, bare = false, className, caption, rowClassName,
}: DataTableProps<T>) {
  const visibleOnMobile = columns.filter(c => !c.hideOnMobile && !c.actions && !c.primary);
  const primaryCol = columns.find(c => c.primary);
  const actionCols = columns.filter(c => c.actions);

  const showEmpty = !loading && rows.length === 0;
  const compact = useIsCompact();

  const desktop = (
      <div className={cx(!showEmpty && 'overflow-x-auto')}>
        {showEmpty ? empty : (
          <table className="w-full text-sm">
            {caption && <caption className="sr-only">{caption}</caption>}
            <thead>
              <tr className="border-b border-gray-700 bg-gray-500/[0.04] text-left">
                {columns.map(col => (
                  <th
                    key={col.key}
                    scope="col"
                    className={cx(
                      'whitespace-nowrap px-5 py-3.5 text-2xs font-bold uppercase tracking-wider text-gray-400',
                      ALIGN[col.align ?? 'left'],
                      col.headerClassName,
                    )}
                  >
                    {col.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700">
              {loading
                ? <TableSkeleton rows={5} cols={columns.length} />
                : rows.map(row => (
                    <tr
                      key={rowKey(row)}
                      data-row-key={rowKey(row)}
                      onClick={onRowClick ? () => onRowClick(row) : undefined}
                      className={cx('transition-colors', onRowClick && 'cursor-pointer', 'hover:bg-gray-500/[0.06]', rowClassName?.(row))}
                    >
                      {columns.map(col => (
                        <td key={col.key} className={cx('px-5 py-3.5 align-middle', ALIGN[col.align ?? 'left'], col.className)}>
                          {col.cell(row)}
                        </td>
                      ))}
                    </tr>
                  ))}
            </tbody>
          </table>
        )}
      </div>
  );

  const mobile = (
      <div>
        {loading ? (
          <div className="p-3"><CardSkeleton count={3} /></div>
        ) : showEmpty ? empty : (
          <ul className="divide-y divide-gray-700">
            {rows.map(row => (
              <li key={rowKey(row)} data-row-key={rowKey(row)} className={cx(rowClassName?.(row))}>
                <div
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={cx('px-4 py-4', onRowClick && 'cursor-pointer active:bg-gray-500/[0.08]')}
                >
                  {primaryCol && (
                    <div className="mb-2.5 text-base font-bold text-gray-50">{primaryCol.cell(row)}</div>
                  )}
                  <dl className="grid grid-cols-[minmax(6rem,auto)_1fr] gap-x-3 gap-y-2 text-sm">
                    {visibleOnMobile.map(col => (
                      <div key={col.key} className="contents">
                        <dt className="text-2xs font-bold uppercase tracking-wider text-gray-400">{col.header}</dt>
                        <dd className="min-w-0 break-words text-gray-200">{col.cell(row)}</dd>
                      </div>
                    ))}
                  </dl>
                  {/* El pie sólo aparece si alguna acción aplica a esta fila:
                      un pago ya aprobado no tiene botones y no debe arrastrar
                      una línea divisoria vacía. */}
                  {(() => {
                    const acciones = actionCols
                      .map(col => ({ key: col.key, node: col.cell(row) }))
                      .filter(a => a.node !== null && a.node !== undefined && a.node !== false);
                    if (acciones.length === 0) return null;
                    return (
                      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-gray-700 pt-3">
                        {acciones.map(a => <div key={a.key}>{a.node}</div>)}
                      </div>
                    );
                  })()}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
  );

  const body = compact ? mobile : desktop;

  return bare ? <div className={className}>{body}</div> : <div className={cx('sg-table-wrap', className)}>{body}</div>;
}
