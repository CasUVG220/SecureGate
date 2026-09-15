import { cx } from './cx';

export interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Alto del bloque; por defecto una línea de texto. */
  height?: number | string;
  width?: number | string;
  circle?: boolean;
}

/**
 * Placeholder de carga. Reemplaza a los spinners genéricos: mantiene la forma
 * del contenido que está por llegar, así la pantalla no "salta" al resolver.
 */
export default function Skeleton({ height = '1rem', width = '100%', circle, className, style, ...rest }: SkeletonProps) {
  return (
    <div
      aria-hidden="true"
      className={cx('sg-skeleton', circle && 'rounded-full', className)}
      style={{ height, width, ...style }}
      {...rest}
    />
  );
}

/** Varias líneas de texto con anchos escalonados, para párrafos y celdas. */
export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={cx('space-y-2', className)} role="status" aria-label="Cargando">
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} width={`${100 - (i % 3) * 18}%`} height="0.75rem" />
      ))}
    </div>
  );
}

/** Filas de tabla en carga. Se usa dentro de `<tbody>`. */
export function TableSkeleton({ rows = 5, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, i) => (
        <tr key={i} className="border-b border-gray-700 last:border-0">
          {Array.from({ length: cols }).map((_, j) => (
            <td key={j} className="px-4 py-3.5">
              <Skeleton height="0.75rem" width={`${48 + ((i * cols + j) * 19) % 38}%`} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

/** Tarjetas en carga, para las listas que en móvil dejan de ser tabla. */
export function CardSkeleton({ count = 3, className }: { count?: number; className?: string }) {
  return (
    <div className={cx('space-y-3', className)} role="status" aria-label="Cargando">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="sg-card space-y-3 p-4">
          <Skeleton height="0.875rem" width="40%" />
          <Skeleton height="0.75rem" width="72%" />
          <Skeleton height="0.75rem" width="55%" />
        </div>
      ))}
    </div>
  );
}

/**
 * Rejilla de tarjetas en carga, para las pantallas que muestran la data como
 * mosaico (áreas comunes, empresas) en vez de lista o tabla. `media` reserva
 * el alto de la imagen de portada para que la rejilla no salte al resolver.
 */
export function GridSkeleton({
  count = 6,
  media = false,
  className,
}: { count?: number; media?: boolean; className?: string }) {
  return (
    <div
      className={cx('grid gap-4 sm:grid-cols-2 lg:grid-cols-3', className)}
      role="status"
      aria-label="Cargando"
    >
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="sg-card overflow-hidden">
          {media && <Skeleton height="9rem" width="100%" className="rounded-none" />}
          <div className="space-y-3 p-4">
            <Skeleton height="0.875rem" width="55%" />
            <Skeleton height="0.75rem" width="80%" />
            <Skeleton height="0.75rem" width="45%" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Formulario en carga: pares etiqueta/campo, para las pantallas de configuración. */
export function FormSkeleton({ fields = 4, className }: { fields?: number; className?: string }) {
  return (
    <div className={cx('space-y-6', className)} role="status" aria-label="Cargando">
      <div className="space-y-2">
        <Skeleton height="1.125rem" width="38%" />
        <Skeleton height="0.75rem" width="62%" />
      </div>
      <div className="sg-card space-y-5 p-5">
        {Array.from({ length: fields }).map((_, i) => (
          <div key={i} className="space-y-2">
            <Skeleton height="0.75rem" width={`${28 + (i % 3) * 9}%`} />
            <Skeleton height="2.5rem" width="100%" />
          </div>
        ))}
        <Skeleton height="2.5rem" width="9rem" />
      </div>
    </div>
  );
}

/** Bloques de métrica en carga (portal del residente). */
export function StatSkeleton({ count = 4 }: { count?: number }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="sg-stat-card relative flex flex-col justify-between overflow-hidden rounded-2xl p-5 border border-[rgb(var(--c-hairline))] bg-gradient-to-b from-[rgb(var(--c-surface-raised))] to-[rgb(var(--c-surface))] space-y-4"
        >
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 flex-1">
              <Skeleton height="0.375rem" width="0.375rem" circle className="shrink-0" />
              <Skeleton height="0.75rem" width="45%" />
            </div>
            <Skeleton height="2.25rem" width="2.25rem" className="shrink-0 rounded-xl" />
          </div>
          <div className="my-1">
            <Skeleton height="2.25rem" width="35%" />
          </div>
          <div className="pt-2.5 border-t border-[rgb(var(--c-hairline))]">
            <Skeleton height="0.7rem" width="55%" />
          </div>
        </div>
      ))}
    </>
  );
}

export function Spinner({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={cx('inline-block animate-spin shrink-0', className)}
      aria-hidden="true"
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}
