import { useId, useState } from 'react';
import { cx } from '../ui/cx';

export interface TablaDatosProps {
  columnas: string[];
  filas: Array<Array<string | number>>;
  /** Columnas numéricas (alineadas a la derecha, cifras tabulares). */
  numericas?: number[];
  caption: string;
}

/** La vista de tabla de cada gráfico: el equivalente accesible, sin color ni hover. */
export function TablaDatos({ columnas, filas, numericas = [], caption }: TablaDatosProps) {
  return (
    <div className="max-h-[22rem] overflow-auto rounded-lg border border-[rgb(var(--c-hairline))]">
      <table className="w-full text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="sticky top-0 bg-[rgb(var(--c-surface-raised))]">
          <tr>
            {columnas.map((c, i) => (
              <th
                key={c}
                scope="col"
                className={cx(
                  'border-b border-[rgb(var(--c-hairline))] px-3 py-2 text-2xs font-bold uppercase tracking-wider text-gray-400',
                  numericas.includes(i) ? 'text-right' : 'text-left',
                )}
              >
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {filas.map((f, r) => (
            <tr key={r} className="border-b border-[rgb(var(--c-hairline))] last:border-0">
              {f.map((v, i) => (
                <td key={i} className={cx('px-3 py-1.5', numericas.includes(i) ? 'text-right tabular-nums text-gray-100' : 'text-gray-300')}>
                  {v}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Conmutador gráfico ↔ tabla. Suelto para usarlo también fuera de ChartCard. */
export function BotonTabla({ activo, onClick, etiquetas }: {
  activo: boolean;
  onClick: () => void;
  etiquetas: { verTabla: string; verGrafico: string };
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={activo}
      className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[rgb(var(--c-border-600))] px-2.5 text-xs font-semibold text-gray-300 transition-colors hover:bg-gray-500/10 hover:text-gray-50"
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d={activo ? 'M3 3v18h18M7 14l4-4 4 4 5-5' : 'M3 3h18v18H3zM3 9h18M3 15h18M9 3v18'} />
      </svg>
      {activo ? etiquetas.verGrafico : etiquetas.verTabla}
    </button>
  );
}

interface ChartCardProps {
  titulo: string;
  descripcion?: React.ReactNode;
  /** Vista de tabla alternativa. Si falta, no se ofrece el botón. */
  tabla?: React.ReactNode;
  etiquetas?: { verTabla: string; verGrafico: string };
  acciones?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}

/**
 * Contenedor de un gráfico: título que dice qué se mide, descripción que dice
 * cómo leerlo, y el conmutador a tabla (la vista accesible de los mismos datos).
 */
export default function ChartCard({
  titulo, descripcion, tabla, etiquetas = { verTabla: 'Ver tabla', verGrafico: 'Ver gráfico' },
  acciones, className, children,
}: ChartCardProps) {
  const [verTabla, setVerTabla] = useState(false);
  const id = useId();
  return (
    // min-w-0: como hijo de una rejilla, sin esto el SVG dicta el ancho de la columna.
    <section className={cx('sg-card flex min-w-0 flex-col', className)} aria-labelledby={`${id}-t`}>
      <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-5 pt-5">
        <div className="min-w-0 flex-1">
          <h3 id={`${id}-t`} className="text-base font-bold tracking-tight text-gray-50">{titulo}</h3>
          {descripcion && <p className="mt-0.5 text-sm text-gray-400">{descripcion}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {acciones}
          {tabla && <BotonTabla activo={verTabla} onClick={() => setVerTabla(v => !v)} etiquetas={etiquetas} />}
        </div>
      </header>
      <div className="flex-1 px-5 pb-5 pt-4">{verTabla && tabla ? tabla : children}</div>
    </section>
  );
}
