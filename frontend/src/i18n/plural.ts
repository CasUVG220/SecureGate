import { rellenar } from '../components/charts/format';

/**
 * Concordancia de número: «1 sigue abierta» / «3 siguen abiertas».
 *
 * Una clave con singular y plural se escribe como DOS entradas, `clave.one` y `clave.other` (la base `clave` queda de
 * respaldo). `{n}` se rellena solo; cualquier otra variable va en `vars`. Si un texto lleva un número junto a un
 * sustantivo, o usa esto, o escribe «Etiqueta: {n}» (sin concordar nada).
 */
export function plural(
  t: (clave: string, respaldo?: string) => string,
  clave: string,
  n: number | string,
  vars: Record<string, string | number> = {},
  /** El valor numérico que decide singular/plural, si `n` ya viene formateado («1,200»). */
  cuenta: number = typeof n === 'number' ? n : Number(n),
): string {
  const variante = `${clave}.${cuenta === 1 ? 'one' : 'other'}`;
  return rellenar(t(variante, t(clave)), { n, ...vars });
}
