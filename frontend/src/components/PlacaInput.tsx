import { forwardRef } from 'react';
import { cx } from './ui';
import { PLACA_EJEMPLO, PLACA_MAX, placaParaInput } from '../utils/placa';

export interface PlacaInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value'> {
  value: string;
  /** Recibe el texto ya acomodado (mayúsculas, `P-123ABC`). Para enviar al servidor usa `normalizarPlaca`. */
  onChange: (valor: string) => void;
}

/**
 * Campo de placa: UN solo comportamiento en toda la web.
 *
 * Mientras se escribe pone mayúsculas y el guion tras el prefijo (`p123abc` → `P-123ABC`), con el mismo
 * ejemplo de ayuda en todas partes. Lo que se manda al servidor es siempre `normalizarPlaca(valor)`
 * (`P123ABC`), que es la forma en que se guarda y se compara (ver utils/placa.ts).
 */
const PlacaInput = forwardRef<HTMLInputElement, PlacaInputProps>(function PlacaInput(
  { value, onChange, placeholder = PLACA_EJEMPLO, className, ...rest }, ref,
) {
  return (
    <input
      {...rest}
      ref={ref}
      value={value}
      onChange={e => onChange(placaParaInput(e.target.value))}
      placeholder={placeholder}
      autoCapitalize="characters"
      autoComplete="off"
      spellCheck={false}
      maxLength={PLACA_MAX + 2}
      className={cx('sg-input font-mono uppercase tracking-wide', className)}
    />
  );
});

export default PlacaInput;
