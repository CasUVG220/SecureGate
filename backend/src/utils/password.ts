/**
 * Política de contraseñas para cuentas NUEVAS (crear usuario/residente, aceptar
 * invitación). El login no la aplica: las cuentas existentes siguen entrando
 * con lo que ya tenían.
 *
 * El tope de 72 bytes es el límite real de bcrypt: más allá, los caracteres
 * extra se ignoran en silencio, así que se rechazan en vez de aparentar que
 * cuentan.
 */
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX_BYTES = 72;

/** Costo de bcrypt (pgcrypto `gen_salt('bf', n)`). El default de pgcrypto es 6. */
export const BCRYPT_COST = 12;

const COMUNES = new Set([
  '12345678', '123456789', '1234567890', 'password', 'password1', 'contraseña',
  'qwertyui', 'qwerty123', 'abcd1234', 'admin123', 'admin1234', 'securegate',
  'securegate1', '11111111', '00000000', 'iloveyou', 'letmein1', 'residente',
]);

/** Devuelve el mensaje de error, o `null` si la contraseña es aceptable. */
export const validarPassword = (password: unknown, email?: string): string | null => {
  if (typeof password !== 'string' || password.length === 0) return 'La contraseña es requerida';
  if (password.length < PASSWORD_MIN) return `La contraseña debe tener al menos ${PASSWORD_MIN} caracteres`;
  if (Buffer.byteLength(password, 'utf8') > PASSWORD_MAX_BYTES) {
    return `La contraseña no puede superar ${PASSWORD_MAX_BYTES} bytes`;
  }
  if (COMUNES.has(password.toLowerCase())) return 'La contraseña es demasiado común';
  if (email && password.toLowerCase() === email.trim().toLowerCase()) {
    return 'La contraseña no puede ser igual al correo';
  }
  if (!/[A-Za-zÀ-ɏ]/.test(password) || !/\d/.test(password)) {
    return 'La contraseña debe combinar letras y números';
  }
  return null;
};
