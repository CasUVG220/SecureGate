/**
 * Validación y formato de tarjetas — 100 % en el navegador.
 *
 * Nada de esto viaja a un servicio externo: comprueba que el dato tenga sentido
 * antes de gastar una llamada a la pasarela. La autorización de verdad la
 * decide el procesador (hoy simulado, ver `pagarConTarjeta` en el backend).
 */

export type MarcaTarjeta = 'visa' | 'mastercard' | 'amex' | 'desconocida';

/** Deja solo dígitos: el usuario puede pegar el número con espacios o guiones. */
export const soloDigitos = (valor: string): string => valor.replace(/\D/g, '');

/**
 * Algoritmo de Luhn (ISO/IEC 7812-1): detecta errores de tecleo antes de
 * enviar el cobro. Un número puede pasar Luhn y aun así no existir.
 */
export function esLuhnValido(numero: string): boolean {
  const digitos = soloDigitos(numero);
  if (digitos.length < 2) return false;

  let suma = 0;
  let duplicar = false;
  for (let i = digitos.length - 1; i >= 0; i--) {
    let d = digitos.charCodeAt(i) - 48;
    if (duplicar) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    suma += d;
    duplicar = !duplicar;
  }
  return suma % 10 === 0;
}

export function detectarMarca(numero: string): MarcaTarjeta {
  const d = soloDigitos(numero);
  if (/^4/.test(d)) return 'visa';
  if (/^(5[1-5]|2[2-7])/.test(d)) return 'mastercard';
  if (/^3[47]/.test(d)) return 'amex';
  return 'desconocida';
}

/**
 * Agrupa el número mientras se escribe: 4-6-5 en American Express y bloques de
 * 4 en el resto. El corte se hace sobre los dígitos, así que borrar en medio
 * del número no descoloca los grupos.
 */
export function formatearNumero(valor: string): string {
  const d = soloDigitos(valor).slice(0, 19);
  const grupos = detectarMarca(d) === 'amex' ? [4, 6, 5] : [4, 4, 4, 4, 3];

  const partes: string[] = [];
  let i = 0;
  for (const tam of grupos) {
    if (i >= d.length) break;
    partes.push(d.slice(i, i + tam));
    i += tam;
  }
  if (i < d.length) partes.push(d.slice(i));
  return partes.join(' ');
}

/** Normaliza el vencimiento a MM/AA mientras se escribe. */
export function formatearVencimiento(valor: string): string {
  const d = soloDigitos(valor).slice(0, 4);
  if (d.length === 0) return '';
  // Un "4" suelto sólo puede ser abril: se completa a 04 para no dejar "4/".
  if (d.length === 1) return Number(d) > 1 ? `0${d}/` : d;
  const mes = d.slice(0, 2);
  const anio = d.slice(2);
  return anio ? `${mes}/${anio}` : mes;
}

export const cvvEsperado = (numero: string): number => (detectarMarca(numero) === 'amex' ? 4 : 3);

export interface DatosTarjeta {
  numero: string;
  titular: string;
  vencimiento: string;
  cvv: string;
}

/** Claves de traducción del primer error de cada campo; vacío = todo correcto. */
export type ErroresTarjeta = Partial<Record<keyof DatosTarjeta | 'monto', string>>;

/**
 * Valida el formulario completo.
 *
 * `ahora` se inyecta para que las pruebas fijen la fecha y el caso "tarjeta
 * vencida" no dependa del día en que se ejecuten.
 */
export function validarTarjeta(datos: DatosTarjeta, monto: number, ahora: Date = new Date()): ErroresTarjeta {
  const errores: ErroresTarjeta = {};
  const digitos = soloDigitos(datos.numero);

  if (digitos.length < 13 || digitos.length > 19) {
    errores.numero = 'card.errNumberLength';
  } else if (!esLuhnValido(digitos)) {
    errores.numero = 'card.errNumber';
  }

  if (!datos.titular.trim()) errores.titular = 'card.errHolder';

  const m = /^(\d{2})\/(\d{2})$/.exec(datos.vencimiento.trim());
  if (!m) {
    errores.vencimiento = 'card.errExpiryFormat';
  } else {
    const mes = Number(m[1]);
    const anio = 2000 + Number(m[2]);
    if (mes < 1 || mes > 12) {
      errores.vencimiento = 'card.errExpiryFormat';
    } else {
      // La tarjeta vale hasta el último día de su mes de vencimiento.
      const finDeMes = new Date(anio, mes, 1);
      if (finDeMes <= ahora) errores.vencimiento = 'card.errExpiryPast';
    }
  }

  const cvv = soloDigitos(datos.cvv);
  if (cvv.length !== cvvEsperado(datos.numero)) errores.cvv = 'card.errCvv';

  if (!Number.isFinite(monto) || monto <= 0) errores.monto = 'card.errAmount';

  return errores;
}
