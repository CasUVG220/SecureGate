/**
 * Placas de vehículo: una sola forma para guardar, comparar y mostrar.
 *
 * - **Canónica** (lo que se envía y se guarda): mayúsculas y solo A-Z / 0-9, p. ej. `P123ABC`.
 * - **Presentación** (lo que se lee en pantalla): `P-123ABC`.
 *
 * Es la misma regla que `desktop/src/lib/placa.ts` y `backend/src/utils/placa.ts`.
 * Antes cada pantalla mostraba un ejemplo distinto (`P123ABC` / `P-123ABC`) y guardaba lo
 * que se tecleara, así que la misma placa podía existir en tres formatos.
 */
export const PLACA_EJEMPLO = 'P-123ABC';
export const PLACA_MAX = 12;

/** Mayúsculas y solo A-Z / 0-9. */
export const normalizarPlaca = (valor: string | null | undefined): string =>
  (valor ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

const PLACA_GT = /^([A-Z]{1,3})(\d{3})([A-Z]{3})$/;

/** `P123ABC` → `P-123ABC`. Si no tiene la forma guatemalteca devuelve la normalizada tal cual. */
export const formatearPlaca = (valor: string | null | undefined): string => {
  const n = normalizarPlaca(valor);
  const m = PLACA_GT.exec(n);
  return m ? `${m[1]}-${m[2]}${m[3]}` : n;
};

/** ¿Tiene la forma de una placa guatemalteca (prefijo + 3 dígitos + 3 letras)? */
export const esPlacaGuatemalteca = (valor: string | null | undefined): boolean =>
  PLACA_GT.test(normalizarPlaca(valor));

/**
 * Para un `<input>`: normaliza mientras se escribe pero deja el guion que el usuario pone
 * entre el prefijo y los números, para que teclear no se sienta raro. Lo que se envía
 * al servidor siempre pasa por `normalizarPlaca`.
 */
export const placaParaInput = (valor: string): string => formatearPlaca(valor).slice(0, PLACA_MAX + 1);
