import { forwardRef } from 'react';
import { cx } from './cx';
import { Spinner } from './Skeleton';

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Muestra un spinner y bloquea el botón; el texto se mantiene para no cambiar el ancho. */
  loading?: boolean;
  /** Ícono a la izquierda del texto. Se oculta mientras `loading` ocupa ese lugar. */
  icon?: React.ReactNode;
  fullWidth?: boolean;
}

const VARIANT: Record<ButtonVariant, string> = {
  primary:   'bg-brand-500 text-brand-ink hover:bg-brand-600 active:bg-brand-700 shadow-xs',
  secondary: 'border border-gray-600 bg-gray-800 text-gray-200 hover:bg-gray-700 hover:text-gray-50',
  danger:    'bg-danger-500 text-white hover:bg-danger-600 active:bg-danger-700 shadow-xs',
  ghost:     'text-gray-300 hover:bg-gray-500/12 hover:text-gray-50',
};

const SIZE: Record<ButtonSize, string> = {
  sm: 'min-h-control-sm px-3 text-xs gap-1.5',
  md: 'min-h-control px-4 text-sm gap-2',
  lg: 'min-h-control-lg px-5 text-base gap-2',
};

const SPINNER_SIZE: Record<ButtonSize, number> = { sm: 12, md: 14, lg: 16 };

/**
 * Botón base de SecureGate. Sustituye a los `<button className="bg-blue-600 …">`
 * que cada pantalla declaraba por su cuenta.
 */
const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading = false, icon, fullWidth, className, children, disabled, type, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type ?? 'button'}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx(
        'inline-flex items-center justify-center rounded-lg font-semibold whitespace-nowrap',
        'transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-55',
        VARIANT[variant],
        SIZE[size],
        fullWidth && 'w-full',
        className,
      )}
      {...rest}
    >
      {loading ? <Spinner size={SPINNER_SIZE[size]} /> : icon}
      {children}
    </button>
  );
});

export default Button;
