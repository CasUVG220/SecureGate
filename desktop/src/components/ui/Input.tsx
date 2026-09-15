import { forwardRef, useId } from 'react';
import { cx } from './cx';

interface FieldShellProps {
  id: string;
  label?: React.ReactNode;
  error?: string | null;
  hint?: React.ReactNode;
  required?: boolean;
  className?: string;
  children: React.ReactNode;
}

/** Envoltorio compartido por Input, Select y Textarea: label, ayuda y error. */
function FieldShell({ id, label, error, hint, required, className, children }: FieldShellProps) {
  return (
    <div className={cx('min-w-0', className)}>
      {label && (
        <label htmlFor={id} className="mb-1.5 block text-xs font-semibold text-gray-300">
          {label}
          {required && <span className="ml-1 text-brand-400" aria-hidden="true">*</span>}
        </label>
      )}
      {children}
      {error ? (
        <p id={`${id}-error`} role="alert" className="mt-1.5 flex items-center gap-1.5 text-xs font-medium text-danger-400">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
            <circle cx="12" cy="12" r="10" /><path d="M12 8v4M12 16h.01" />
          </svg>
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="mt-1.5 text-xs text-gray-400">{hint}</p>
      ) : null}
    </div>
  );
}

const controlClass = (error?: string | null, hasIcon?: boolean, hasSuffix?: boolean) => cx(
  'sg-input',
  hasIcon && 'pl-10',
  hasSuffix && 'pr-11',
  error && 'border-danger-500 focus:border-danger-500 focus:shadow-[0_0_0_3px_rgb(var(--c-danger-500)/0.16)]',
);

export interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'> {
  label?: React.ReactNode;
  /** Mensaje de error: pinta el borde y se anuncia con `role="alert"`. */
  error?: string | null;
  hint?: React.ReactNode;
  /** Path SVG de 24×24 mostrado dentro del campo, a la izquierda. */
  icon?: string;
  /** Contenido a la derecha del campo (unidad, botón de mostrar contraseña…). */
  suffix?: React.ReactNode;
  wrapperClassName?: string;
}

const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, error, hint, icon, suffix, className, wrapperClassName, id, required, ...rest }, ref,
) {
  const autoId = useId();
  const fieldId = id ?? autoId;

  return (
    <FieldShell id={fieldId} label={label} error={error} hint={hint} required={required} className={wrapperClassName}>
      <div className="relative">
        {icon && (
          <svg
            width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
            strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
            className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400"
          >
            <path d={icon} />
          </svg>
        )}
        <input
          ref={ref}
          id={fieldId}
          required={required}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${fieldId}-error` : hint ? `${fieldId}-hint` : undefined}
          className={cx(controlClass(error, !!icon, !!suffix), className)}
          {...rest}
        />
        {suffix && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-gray-400">{suffix}</div>
        )}
      </div>
    </FieldShell>
  );
});

export default Input;

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: React.ReactNode;
  error?: string | null;
  hint?: React.ReactNode;
  wrapperClassName?: string;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, error, hint, className, wrapperClassName, id, required, children, ...rest }, ref,
) {
  const autoId = useId();
  const fieldId = id ?? autoId;

  return (
    <FieldShell id={fieldId} label={label} error={error} hint={hint} required={required} className={wrapperClassName}>
      <div className="relative">
        <select
          ref={ref}
          id={fieldId}
          required={required}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${fieldId}-error` : undefined}
          className={cx(controlClass(error), 'appearance-none pr-9', className)}
          {...rest}
        >
          {children}
        </select>
        <svg
          width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
          className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-gray-400"
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </div>
    </FieldShell>
  );
});

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: React.ReactNode;
  error?: string | null;
  hint?: React.ReactNode;
  wrapperClassName?: string;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { label, error, hint, className, wrapperClassName, id, required, ...rest }, ref,
) {
  const autoId = useId();
  const fieldId = id ?? autoId;

  return (
    <FieldShell id={fieldId} label={label} error={error} hint={hint} required={required} className={wrapperClassName}>
      <textarea
        ref={ref}
        id={fieldId}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${fieldId}-error` : undefined}
        className={cx(controlClass(error), 'min-h-24 resize-y py-2.5', className)}
        {...rest}
      />
    </FieldShell>
  );
});
