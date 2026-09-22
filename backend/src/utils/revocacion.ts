/**
 * Revocación inmediata de access tokens.
 *
 * El JWT de acceso dura 1 h y no se consulta contra la base en cada petición
 * (sería una query extra por request). Eso significa que desactivar a un
 * guardia o suspender una empresa dejaba la sesión viva hasta 1 h. Este registro
 * en memoria cierra esa ventana: al desactivar un usuario, cambiarle el rol o
 * suspender su empresa se anota la hora, y `verifyToken` rechaza cualquier token
 * emitido antes de ella.
 *
 * Limitaciones asumidas:
 * - Vive en el proceso: con varias réplicas del backend haría falta Redis (o una
 *   columna `tokens_validos_desde` en `usuarios`). Hoy hay una sola.
 * - Se pierde al reiniciar; los tokens anteriores caducan solos en ≤ 1 h y el
 *   refresh token ya está revocado en la base, así que la ventana sigue acotada.
 */
const TTL_MS = 2 * 60 * 60 * 1000; // > ACCESS_EXPIRES (1 h): pasado eso el token ya caducó solo

const usuarios = new Map<string, number>();
const empresas = new Map<string, number>();

const marcar = (mapa: Map<string, number>, id: string | null | undefined, ahora: number): void => {
  if (!id) return;
  mapa.set(id, ahora);
};

const limpiar = (mapa: Map<string, number>, ahora: number): void => {
  for (const [k, t] of mapa) if (ahora - t > TTL_MS) mapa.delete(k);
};

export const revocarAccesoDeUsuario = (usuarioId: string | null | undefined, ahora = Date.now()): void => {
  limpiar(usuarios, ahora);
  marcar(usuarios, usuarioId, ahora);
};

export const revocarAccesoDeEmpresa = (empresaId: string | null | undefined, ahora = Date.now()): void => {
  limpiar(empresas, ahora);
  marcar(empresas, empresaId, ahora);
};

/**
 * `true` si el token (con su `iat` en segundos) es anterior o contemporáneo a una
 * revocación de su usuario o de su empresa. `iat` tiene resolución de segundos,
 * así que se compara contra el segundo entero de la revocación.
 */
export const tokenRevocado = (
  payload: { id?: string; empresa_id?: string | null; iat?: number },
): boolean => {
  const iat = payload.iat ?? 0;
  const u = payload.id ? usuarios.get(payload.id) : undefined;
  if (u !== undefined && iat <= Math.floor(u / 1000)) return true;
  const e = payload.empresa_id ? empresas.get(payload.empresa_id) : undefined;
  if (e !== undefined && iat <= Math.floor(e / 1000)) return true;
  return false;
};

/** Sólo para tests. */
export const _reiniciarRevocaciones = (): void => { usuarios.clear(); empresas.clear(); };
