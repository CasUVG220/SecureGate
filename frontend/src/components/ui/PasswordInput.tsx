import { useState } from 'react';
import Input, { type InputProps } from './Input';
import { cx } from './cx';
import { requisitosDeClave } from './password';

export interface PasswordInputProps extends Omit<InputProps, 'type' | 'suffix' | 'hint'> {
  /**
   * Muestra bajo el campo los requisitos de la contraseña, que se marcan solos
   * mientras se escribe. Se desactiva donde la contraseña ya existe (login).
   */
  requisitos?: boolean;
  /** Texto adicional bajo el campo (p. ej. «Déjalo vacío para no cambiarla»). */
  hint?: React.ReactNode;
  mostrarLabel?: string;
  ocultarLabel?: string;
}

/**
 * Campo de contraseña con botón «Mostrar» y requisitos visibles.
 *
 * Quien crea una cuenta para otra persona escribe a ciegas una contraseña que
 * luego tiene que dictar o copiar: poder verla evita los errores de tipeo, y ver
 * los requisitos desde el principio evita el rechazo «la contraseña debe tener…»
 * después de enviar el formulario.
 */
export default function PasswordInput({
  requisitos = true, hint, mostrarLabel = 'Mostrar contraseña', ocultarLabel = 'Ocultar contraseña',
  value, className, ...rest
}: PasswordInputProps) {
  const [visible, setVisible] = useState(false);
  const texto = typeof value === 'string' ? value : '';

  const ayuda = requisitos || hint ? (
    <span className="flex flex-col gap-1">
      {hint && <span>{hint}</span>}
      {requisitos && (
        <span className="flex flex-wrap gap-x-4 gap-y-1">
          {requisitosDeClave(texto).map(r => (
            <span
              key={r.id}
              data-cumplido={r.ok}
              className={cx('inline-flex items-center gap-1.5', r.ok ? 'text-success-400' : 'text-gray-400')}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"
                strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                {r.ok ? <path d="M20 6L9 17l-5-5" /> : <circle cx="12" cy="12" r="8" />}
              </svg>
              {r.texto}
              <span className="sr-only">{r.ok ? ' (cumplido)' : ' (pendiente)'}</span>
            </span>
          ))}
        </span>
      )}
    </span>
  ) : undefined;

  return (
    <Input
      {...rest}
      value={value}
      type={visible ? 'text' : 'password'}
      autoComplete={rest.autoComplete ?? 'new-password'}
      className={cx('pr-24', className)}
      hint={ayuda}
      suffix={
        <button
          type="button"
          onClick={() => setVisible(v => !v)}
          aria-pressed={visible}
          aria-label={visible ? ocultarLabel : mostrarLabel}
          className="rounded-md px-2 py-1 text-xs font-semibold text-gray-300 transition-colors hover:bg-gray-500/12 hover:text-gray-50"
        >
          {visible ? 'Ocultar' : 'Mostrar'}
        </button>
      }
    />
  );
}
