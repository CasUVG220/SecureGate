import { cx } from './cx';

export type ErrorVariant = 'notFound' | 'error' | 'offline';

export interface ErrorStateProps {
  variant?: ErrorVariant;
  /** Código grande sobre el título, p. ej. "404". Se omite en errores genéricos. */
  code?: string;
  title: string;
  description?: string;
  /**
   * Mensaje técnico del fallo. Se muestra aparte y en monoespaciada: ayuda a
   * reportar el problema sin disfrazarlo de texto para el usuario.
   */
  detail?: string | null;
  action?: React.ReactNode;
  className?: string;
}

const ICONO: Record<ErrorVariant, string> = {
  // Lupa con aspa: se buscó y no está.
  notFound: 'M11 19a8 8 0 1 1 0-16 8 8 0 0 1 0 16zM21 21l-4.35-4.35M9 9l4 4M13 9l-4 4',
  error:    'M12 9v4M12 17h.01M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
  offline:  'M1 1l22 22M16.7 16.7A6 6 0 0 0 12 7M5 12.5a7 7 0 0 1 2-2.3M8.5 16.5a3 3 0 0 1 4.2-.3M12 20h.01',
};

const TONO: Record<ErrorVariant, string> = {
  notFound: 'bg-gray-500/12 text-gray-400',
  error:    'bg-danger-500/12 text-danger-400',
  offline:  'bg-warning-500/12 text-warning-400',
};

/**
 * Pantalla de "aquí no hay nada" o "algo se rompió".
 *
 * Se distingue de EmptyState a propósito: aquel dice "todavía no hay datos" y
 * empuja a crear el primero; este dice "esto no debería estar pasando" y ofrece
 * una salida —reintentar o volver—, porque el usuario no puede arreglarlo.
 */
export default function ErrorState({
  variant = 'error', code, title, description, detail, action, className,
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      className={cx('flex min-h-[60vh] flex-col items-center justify-center px-6 py-16 text-center', className)}
    >
      <span className={cx('mb-5 flex h-16 w-16 items-center justify-center rounded-2xl', TONO[variant])}>
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d={ICONO[variant]} />
        </svg>
      </span>

      {code && (
        <p className="mb-1 text-5xl font-bold tracking-tight text-gray-300 tabular-nums">{code}</p>
      )}

      <h1 className="text-xl font-bold tracking-tight text-gray-50">{title}</h1>
      {description && <p className="mt-2 max-w-md text-sm text-gray-400">{description}</p>}

      {detail && (
        <p className="mt-4 max-w-md break-words rounded-lg border border-gray-700 bg-gray-500/[0.06] px-3 py-2 font-mono text-xs text-gray-400">
          {detail}
        </p>
      )}

      {action && <div className="mt-6 flex flex-wrap justify-center gap-3">{action}</div>}
    </div>
  );
}
