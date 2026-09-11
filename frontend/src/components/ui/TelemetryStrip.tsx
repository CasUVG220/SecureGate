import React from 'react';
import { cx } from './cx';
import Skeleton from './Skeleton';

export type TelemetryTone = 'brand' | 'success' | 'warning' | 'danger' | 'info';

export interface TelemetryItemProps {
  id?: string;
  label: string;
  value: React.ReactNode;
  /** SVG path string (24x24) o ReactNode personalizado */
  icon?: string | React.ReactNode;
  tone?: TelemetryTone;
  /** Nota explicativa o estado del indicador */
  hint?: string;
  /** Tendencia porcentual o absoluta respecto a periodo previo */
  trend?: { value: number; label: string } | null;
  /** Resalta el segmento si requiere acción operativa urgente */
  highlight?: boolean;
  /** Etiqueta de acción rápida (ej: "Ver →") */
  actionLabel?: string;
  /** Callback al interactuar con el segmento */
  onClick?: () => void;
  className?: string;
}

export interface TelemetryStripProps {
  items: TelemetryItemProps[];
  /** Indicador o pastilla de estado general opcional (ej: "Sistema sincronizado") */
  statusBadge?: React.ReactNode;
  /** Título de telemetría superior opcional */
  eyebrow?: string;
  className?: string;
}

const TONE_MAP: Record<
  TelemetryTone,
  {
    dot: string;
    textAccent: string;
    iconColor: string;
    activeBorder: string;
  }
> = {
  brand: {
    dot: 'bg-sky-400 shadow-[0_0_8px_rgba(56,189,248,0.8)]',
    textAccent: 'text-sky-400',
    iconColor: 'text-sky-400/80 group-hover:text-sky-300',
    activeBorder: 'text-sky-400',
  },
  success: {
    dot: 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]',
    textAccent: 'text-emerald-400',
    iconColor: 'text-emerald-400/80 group-hover:text-emerald-300',
    activeBorder: 'text-emerald-400',
  },
  warning: {
    dot: 'bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.8)]',
    textAccent: 'text-amber-400',
    iconColor: 'text-amber-400/80 group-hover:text-amber-300',
    activeBorder: 'text-amber-400',
  },
  danger: {
    dot: 'bg-rose-400 shadow-[0_0_8px_rgba(244,63,94,0.8)]',
    textAccent: 'text-rose-400',
    iconColor: 'text-rose-400/80 group-hover:text-rose-300',
    activeBorder: 'text-rose-400',
  },
  info: {
    dot: 'bg-teal-400 shadow-[0_0_8px_rgba(45,212,191,0.8)]',
    textAccent: 'text-teal-400',
    iconColor: 'text-teal-400/80 group-hover:text-teal-300',
    activeBorder: 'text-teal-400',
  },
};

/**
 * HUD Telemetry Strip — Consola de instrumentación y telemetría operativa.
 * Reemplaza las tarjetas cuadradas aisladas ("StatCards") por una barra continua de comando
 * inspirada en los cockpits de control de Linear, Datadog y Vercel.
 */
export function TelemetryStrip({ items, statusBadge, eyebrow, className }: TelemetryStripProps) {
  return (
    <section
      aria-label="Telemetría operativa"
      className={cx('sg-telemetry-strip flex flex-col', className)}
    >
      {(statusBadge || eyebrow) && (
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.07] px-5 py-2.5 bg-white/[0.015]">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.7)] animate-pulse" />
            <span className="text-2xs font-bold uppercase tracking-widest text-neutral-400">
              {eyebrow ?? 'Telemetría en tiempo real'}
            </span>
          </div>
          {statusBadge && <div className="shrink-0">{statusBadge}</div>}
        </header>
      )}

      {/* Rejilla continua con divisores capilares */}
      <div
        className={cx(
          'grid grid-cols-1 divide-y divide-white/[0.08]',
          'sm:grid-cols-2 sm:divide-y-0 sm:divide-x sm:divide-y',
          items.length === 3 && 'lg:grid-cols-3',
          items.length >= 4 && 'lg:grid-cols-4'
        )}
      >
        {items.map((item, index) => {
          const tone = item.tone ?? 'brand';
          const cfg = TONE_MAP[tone];
          const up = (item.trend?.value ?? 0) > 0;

          return (
            <div
              key={item.id ?? item.label ?? index}
              onClick={item.onClick}
              role={item.onClick ? 'button' : undefined}
              tabIndex={item.onClick ? 0 : undefined}
              className={cx(
                'sg-telemetry-segment group',
                cfg.activeBorder,
                item.onClick && 'cursor-pointer select-none',
                item.highlight && 'bg-amber-500/[0.03]',
                item.className
              )}
            >
              {/* Encabezado del segmento: indicador + etiqueta + ícono */}
              <div className="flex items-start justify-between gap-2 mb-2.5">
                <div className="flex items-center gap-2 min-w-0">
                  <span className={cx('h-1.5 w-1.5 shrink-0 rounded-full', cfg.dot)} aria-hidden="true" />
                  <p className="truncate text-xs font-semibold uppercase tracking-wider text-neutral-400 group-hover:text-neutral-300 transition-colors">
                    {item.label}
                  </p>
                </div>

                {item.icon && (
                  <span className={cx('shrink-0 transition-transform duration-200 group-hover:scale-110', cfg.iconColor)} aria-hidden="true">
                    {typeof item.icon === 'string' ? (
                      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d={item.icon} />
                      </svg>
                    ) : (
                      item.icon
                    )}
                  </span>
                )}
              </div>

              {/* Métrica principal destacada */}
              <div className="my-1 flex items-baseline justify-between gap-2">
                <p className="text-3xl sm:text-4xl font-extrabold tracking-tight tabular-nums text-white">
                  {item.value}
                </p>

                {item.actionLabel && (
                  <span className="text-xs font-semibold text-neutral-400 group-hover:text-white transition-colors flex items-center gap-1">
                    {item.actionLabel}
                  </span>
                )}
              </div>

              {/* Pie de segmento: tendencia o nota operativa */}
              <div className="mt-2.5 flex items-center justify-between gap-2 text-xs text-neutral-400">
                {item.trend ? (
                  <div className="flex items-center gap-1.5">
                    <span
                      className={cx(
                        'inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-2xs font-bold tabular-nums',
                        up
                          ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                          : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                      )}
                    >
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <path d={up ? 'M6 15l6-6 6 6' : 'M6 9l6 6 6-6'} />
                      </svg>
                      {up ? '+' : ''}{item.trend.value}
                    </span>
                    <span className="truncate">{item.trend.label}</span>
                  </div>
                ) : item.hint ? (
                  <p className="truncate text-xs text-neutral-400/90 flex items-center gap-1.5">
                    <span className="inline-block h-1 w-1 rounded-full bg-neutral-500 shrink-0" />
                    {item.hint}
                  </p>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** Esqueleto de carga unificado para la barra de telemetría */
export function TelemetrySkeleton({ count = 4, className }: { count?: number; className?: string }) {
  return (
    <div
      className={cx(
        'sg-telemetry-strip overflow-hidden',
        className
      )}
      role="status"
      aria-label="Cargando telemetría"
    >
      <div
        className={cx(
          'grid grid-cols-1 divide-y divide-white/[0.08]',
          'sm:grid-cols-2 sm:divide-y-0 sm:divide-x sm:divide-y',
          count === 3 && 'lg:grid-cols-3',
          count >= 4 && 'lg:grid-cols-4'
        )}
      >
        {Array.from({ length: count }).map((_, i) => (
          <div key={i} className="sg-telemetry-segment space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 w-1/2">
                <Skeleton height="0.375rem" width="0.375rem" circle className="shrink-0" />
                <Skeleton height="0.75rem" width="60%" />
              </div>
              <Skeleton height="1.1rem" width="1.1rem" circle />
            </div>
            <div className="my-1">
              <Skeleton height="2.25rem" width="40%" />
            </div>
            <div className="pt-2">
              <Skeleton height="0.7rem" width="55%" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default TelemetryStrip;
