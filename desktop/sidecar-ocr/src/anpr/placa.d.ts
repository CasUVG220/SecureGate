/**
 * Tipos de `placa.js` (copia en JavaScript de `desktop/src/lib/placa.ts` para el ANPR). Los usa la prueba de paridad del
 * escritorio (`src/lib/__tests__/placa.paridad.test.ts`); deben coincidir con los de `lib/placa.ts`.
 */
export interface CandidatoPlaca {
  placa: string;
  formateada: string;
  valida: boolean;
  prefijoConocido: boolean;
  correcciones: number;
  confianza: number;
  requiereRevision: boolean;
}
export declare const PREFIJOS_CONOCIDOS: readonly string[];
export declare const PLACA_RE: RegExp;
export declare const UMBRAL_CONFIANZA: number;
export declare function normalizar(s: string): string;
export declare function formatear(placa: string): string;
export declare function esValida(s: string): boolean;
export declare function candidatosDe(texto: string, confianza: number): CandidatoPlaca[];
export declare function mejorCandidato(items: Array<{ texto: string; confianza: number }>, textoCrudo?: string): CandidatoPlaca;
