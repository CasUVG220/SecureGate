import { cx } from './cx';

export interface CardProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  title?: React.ReactNode;
  description?: React.ReactNode;
  /** Contenido alineado a la derecha del encabezado (botones, filtros). */
  actions?: React.ReactNode;
  padded?: boolean;
}

/** Superficie estándar: la misma sombra, borde y radio en todas las pantallas. */
export default function Card({ title, description, actions, padded = true, className, children, ...rest }: CardProps) {
  return (
    <section className={cx('sg-card', className)} {...rest}>
      {(title || actions) && (
        <header className={cx('flex flex-wrap items-start justify-between gap-3 px-5 py-4', !!children && 'border-b border-gray-700')}>
          <div className="min-w-0">
            {title && <h2 className="text-base font-bold tracking-tight text-gray-50">{title}</h2>}
            {description && <p className="mt-0.5 text-sm text-gray-400">{description}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      {children && <div className={cx(padded && 'p-5')}>{children}</div>}
    </section>
  );
}
