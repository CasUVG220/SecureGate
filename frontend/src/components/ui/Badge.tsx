import { cx } from './cx';

export type BadgeTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  /** Punto de color a la izquierda: útil para estados vivos (Activo, En mora…). */
  dot?: boolean;
  children: React.ReactNode;
}

const TONE: Record<BadgeTone, string> = {
  neutral: 'bg-gray-500/12 text-gray-300 border-gray-600',
  success: 'bg-success-500/12 text-success-400 border-success-500/30',
  warning: 'bg-warning-500/12 text-warning-400 border-warning-500/30',
  danger:  'bg-danger-500/12 text-danger-400 border-danger-500/30',
  info:    'bg-brand-500/12 text-brand-400 border-brand-500/30',
};

/**
 * Etiqueta de estado. Un solo lugar decide qué color corresponde a "aprobado",
 * "pendiente" o "mora", en vez de repetir el mapa de clases en cada tabla.
 */
export default function Badge({ tone = 'neutral', dot = false, className, children, ...rest }: BadgeProps) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-2xs font-bold leading-5',
        TONE[tone],
        className,
      )}
      {...rest}
    >
      {dot && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" aria-hidden="true" />}
      {children}
    </span>
  );
}
