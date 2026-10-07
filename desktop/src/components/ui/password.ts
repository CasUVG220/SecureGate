/**
 * Requisitos de contraseña que el navegador puede comprobar por sí solo. Reflejan
 * la política del backend (`utils/password.ts`): mínimo 8 caracteres y mezcla de
 * letras y números. Las reglas que dependen del servidor (lista de contraseñas
 * comunes, igual al correo) las responde la API con un mensaje claro.
 */
export const PASSWORD_MIN = 8;

export interface RequisitoClave {
  id: 'largo' | 'mezcla';
  ok: boolean;
  texto: string;
}

export const requisitosDeClave = (valor: string): RequisitoClave[] => [
  { id: 'largo', ok: valor.length >= PASSWORD_MIN, texto: `Al menos ${PASSWORD_MIN} caracteres` },
  { id: 'mezcla', ok: /[A-Za-zÀ-ɏ]/.test(valor) && /\d/.test(valor), texto: 'Letras y números' },
];
