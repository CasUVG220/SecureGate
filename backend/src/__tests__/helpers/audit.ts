import { q } from './db';

/**
 * La auditoría se escribe cuando termina la respuesta (`finish`) y sin esperar
 * (fire-and-forget), así que la fila puede llegar unos milisegundos después de que
 * supertest devuelve. Esta espera consulta hasta que aparezcan `minimo` filas o se
 * agote el tiempo (y entonces devuelve lo que haya, para que el `expect` falle
 * con un mensaje útil en vez de con un timeout).
 */
export const esperarAuditoria = async (
  accion: string,
  registroId: string,
  opts: { minimo?: number; timeoutMs?: number; usuarioId?: string } = {},
): Promise<any[]> => {
  const { minimo = 1, timeoutMs = 3000, usuarioId } = opts;
  const limite = Date.now() + timeoutMs;
  let filas: any[] = [];
  do {
    filas = await q(
      `SELECT id, usuario_id, accion, tabla_afectada, registro_id, ip_address, user_agent,
              sucursal_id, status_code, datos_nuevos, created_at
         FROM audit_logs
        WHERE accion = $1 AND registro_id = $2 AND ($3::uuid IS NULL OR usuario_id = $3)
        ORDER BY created_at, id`,
      [accion, registroId, usuarioId ?? null],
    );
    if (filas.length >= minimo) return filas;
    await new Promise(r => setTimeout(r, 50));
  } while (Date.now() < limite);
  return filas;
};
