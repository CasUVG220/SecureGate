/**
 * Placas de vehículo: una sola forma canónica para guardar y comparar.
 *
 * Canónica (almacenamiento y comparación): mayúsculas y solo A-Z / 0-9, p. ej.
 * `P123ABC`. Presentación al usuario: `P-123ABC` (ver `formatearPlaca`). Es la misma
 * regla que `desktop/src/lib/placa.ts` y `frontend/src/utils/placa.ts`.
 *
 * Antes cada pantalla guardaba lo que se tecleaba (`P123ABC`, `P-123ABC`, `p 123abc`)
 * y las comparaciones con `UPPER(placa) = UPPER($1)` fallaban entre formatos.
 */
export const PLACA_MIN = 4;
export const PLACA_MAX = 12;

/** Mayúsculas y solo A-Z / 0-9. Cualquier valor que no sea texto da cadena vacía. */
export const normalizarPlaca = (valor: unknown): string =>
  typeof valor === 'string' ? valor.toUpperCase().replace(/[^A-Z0-9]/g, '') : '';

/** ¿Tiene una longitud razonable para ser una placa? (no valida el formato guatemalteco: hay placas extranjeras) */
export const placaPlausible = (normalizada: string): boolean =>
  normalizada.length >= PLACA_MIN && normalizada.length <= PLACA_MAX;

const PLACA_GT = /^([A-Z]{1,3})(\d{3})([A-Z]{3})$/;

/**
 * ¿Tiene la forma guatemalteca (prefijo de 1-3 letras + 3 dígitos + 3 letras, ya normalizada)? Es la única que lee el ANPR
 * (`desktop/sidecar-ocr/src/anpr/placa.js`): una placa autorizada con otra forma nunca abriría sola, así que los vehículos de
 * los residentes la exigen. Los visitantes y la captura manual siguen aceptando placas extranjeras (`placaPlausible`).
 */
export const esPlacaGuatemalteca = (normalizada: string): boolean => PLACA_GT.test(normalizada);

/** `P123ABC` → `P-123ABC`; si no tiene la forma guatemalteca devuelve la normalizada tal cual. */
export const formatearPlaca = (valor: unknown): string => {
  const n = normalizarPlaca(valor);
  const m = PLACA_GT.exec(n);
  return m ? `${m[1]}-${m[2]}${m[3]}` : n;
};

/** Expresión SQL que normaliza una columna de placa igual que `normalizarPlaca` (para filas antiguas sin normalizar). */
export const sqlPlacaNormalizada = (columna: string): string =>
  `regexp_replace(upper(${columna}), '[^A-Z0-9]', '', 'g')`;
