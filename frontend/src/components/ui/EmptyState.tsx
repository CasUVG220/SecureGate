import { cx } from './cx';

export interface EmptyStateProps {
  /** Path SVG de 24×24; si se omite se usa un ícono de bandeja vacía. */
  icon?: string;
  title: string;
  description?: string;
  /** Acción principal, normalmente el mismo botón que crea el primer registro. */
  action?: React.ReactNode;
  className?: string;
  compact?: boolean;
}

const DEFAULT_ICON = 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12';

/**
 * Estado vacío de listas y tablas. Da una salida ("agrega el primero") en vez
 * de dejar al usuario frente a un recuadro en blanco.
 */
export default function EmptyState({ icon, title, description, action, className, compact }: EmptyStateProps) {
  return (
    <div className={cx('flex flex-col items-center justify-center px-6 text-center', compact ? 'py-10' : 'py-16', className)}>
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-gray-500/10 text-gray-400">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d={icon || DEFAULT_ICON} />
        </svg>
      </div>
      <p className="text-base font-semibold text-gray-100">{title}</p>
      {description && <p className="mt-1 max-w-sm text-sm text-gray-400">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
