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

export type StatTone = 'brand' | 'success' | 'warning' | 'danger' | 'info';

export interface StatCardProps {
  label: string;
  value: React.ReactNode;
  /** Path SVG 24×24 del ícono de la métrica o nodo React. */
  icon?: string | React.ReactNode;
  /** Alias retrocompatible para icon */
  iconPath?: string;
  tone?: StatTone;
  /** Alias retrocompatible para clases de color legacy como 'text-blue-400' */
  accent?: string;
  /** Variación respecto al periodo anterior */
  trend?: { value: number; label: string } | null;
  hint?: string;
  caption?: string;
  badge?: React.ReactNode;
  className?: string;
  onClick?: () => void;
}

const TONE_STYLES: Record<
  StatTone,
  {
    dot: string;
    iconBox: string;
    glow: string;
    hoverBorder: string;
  }
> = {
  brand: {
    dot: 'bg-sky-400 shadow-[0_0_8px_rgba(56,189,248,0.7)]',
    iconBox: 'bg-sky-500/10 text-sky-400 border-sky-500/25 group-hover:border-sky-500/50 group-hover:bg-sky-500/15',
    glow: 'from-sky-500/20',
    hoverBorder: 'hover:border-sky-500/40',
  },
  success: {
    dot: 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.7)]',
    iconBox: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/25 group-hover:border-emerald-500/50 group-hover:bg-emerald-500/15',
    glow: 'from-emerald-500/20',
    hoverBorder: 'hover:border-emerald-500/40',
  },
  warning: {
    dot: 'bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.7)]',
    iconBox: 'bg-amber-500/10 text-amber-400 border-amber-500/25 group-hover:border-amber-500/50 group-hover:bg-amber-500/15',
    glow: 'from-amber-500/20',
    hoverBorder: 'hover:border-amber-500/40',
  },
  danger: {
    dot: 'bg-rose-400 shadow-[0_0_8px_rgba(244,63,94,0.7)]',
    iconBox: 'bg-rose-500/10 text-rose-400 border-rose-500/25 group-hover:border-rose-500/50 group-hover:bg-rose-500/15',
    glow: 'from-rose-500/20',
    hoverBorder: 'hover:border-rose-500/40',
  },
  info: {
    dot: 'bg-teal-400 shadow-[0_0_8px_rgba(45,212,191,0.7)]',
    iconBox: 'bg-teal-500/10 text-teal-400 border-teal-500/25 group-hover:border-teal-500/50 group-hover:bg-teal-500/15',
    glow: 'from-teal-500/20',
    hoverBorder: 'hover:border-teal-500/40',
  },
};

/** Métrica moderna de dashboard: número prominente, micro-estado y diseño de alta precisión. */
export function StatCard({
  label,
  value,
  icon,
  iconPath,
  tone,
  accent,
  trend,
  hint,
  caption,
  badge,
  className,
  onClick,
}: StatCardProps) {
  // Mapear tono o resolver desde prop legacy `accent`
  const resolvedTone: StatTone = tone ?? (
    accent?.includes('green') ? 'success' :
    accent?.includes('amber') || accent?.includes('yellow') ? 'warning' :
    accent?.includes('red') ? 'danger' :
    accent?.includes('teal') || accent?.includes('cyan') ? 'info' :
    'brand'
  );

  const resolvedIcon = icon ?? iconPath;
  const resolvedHint = hint ?? caption;
  const up = (trend?.value ?? 0) > 0;
  const config = TONE_STYLES[resolvedTone];

  return (
    <div
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      className={cx(
        'sg-stat-card group relative flex flex-col justify-between overflow-hidden rounded-2xl p-5',
        'border border-white/[0.08] bg-gradient-to-b from-[rgb(var(--c-surface-raised))] to-[rgb(var(--c-surface))]',
        'shadow-[0_4px_20px_-4px_rgba(0,0,0,0.35)]',
        'transition-all duration-300 ease-out hover:-translate-y-1 hover:shadow-[0_16px_32px_-4px_rgba(0,0,0,0.5)]',
        config.hoverBorder,
        onClick && 'cursor-pointer select-none',
        className
      )}
    >
      {/* Reflejo especular superior fino */}
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent"
        aria-hidden="true"
      />

      {/* Iluminación ambiental sutil en hover (no intrusiva ni caricaturesca) */}
      <div
        className={cx(
          'pointer-events-none absolute -bottom-10 left-1/2 -translate-x-1/2 h-20 w-3/4 rounded-full blur-2xl opacity-0 transition-opacity duration-500 group-hover:opacity-25 bg-gradient-to-t to-transparent',
          config.glow
        )}
        aria-hidden="true"
      />

      {/* Cabecera: Etiqueta con micro-indicador de estado y badge/ícono flotante */}
      <div className="relative z-10 flex items-start justify-between gap-3 mb-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className={cx('h-1.5 w-1.5 shrink-0 rounded-full', config.dot)} aria-hidden="true" />
            <p className="truncate text-xs font-semibold uppercase tracking-wider text-neutral-400">
              {label}
            </p>
          </div>
        </div>

        {badge && (
          <div className="shrink-0">{badge}</div>
        )}

        {resolvedIcon && (
          <span
            className={cx(
              'flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border backdrop-blur-md transition-all duration-300 group-hover:scale-105 shadow-sm',
              config.iconBox
            )}
            aria-hidden="true"
          >
            {typeof resolvedIcon === 'string' ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d={resolvedIcon} />
              </svg>
            ) : (
              resolvedIcon
            )}
          </span>
        )}
      </div>

      {/* Valor principal de la métrica */}
      <div className="relative z-10 my-1">
        <p className="text-3xl sm:text-4xl font-extrabold tracking-tight tabular-nums text-white">
          {value}
        </p>
      </div>

      {/* Contexto inferior: tendencia o nota operativa */}
      {(trend || resolvedHint) && (
        <div className="relative z-10 mt-3 pt-2.5 border-t border-white/[0.06] flex items-center justify-between text-xs text-neutral-400">
          {trend ? (
            <div className="flex items-center gap-1.5">
              <span
                className={cx(
                  'inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 font-bold tabular-nums',
                  up
                    ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                    : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                )}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <path d={up ? 'M6 15l6-6 6 6' : 'M6 9l6 6 6-6'} />
                </svg>
                {up ? '+' : ''}{trend.value}
              </span>
              <span className="truncate text-neutral-400">{trend.label}</span>
            </div>
          ) : resolvedHint ? (
            <p className="truncate text-xs text-neutral-400 flex items-center gap-1.5">
              <span className="inline-block h-1 w-1 rounded-full bg-neutral-500" />
              {resolvedHint}
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}
