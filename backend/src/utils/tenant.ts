import { JwtPayload } from '../middleware/auth.middleware';
import { esUuid } from './http';

export interface TenantSql {
  joinClause: string;
  whereClause: string;  // references params starting at $1
  params: (string | null)[];
}

/**
 * Builds tenant-scoped JOIN + WHERE for SELECT queries.
 * The WHERE clause always binds params starting at $1.
 * Append additional query params after ts.params.
 */
export function tenantFilter(user: JwtPayload, tableAlias: string): TenantSql {
  if (user.rol === 'owner') {
    return { joinClause: '', whereClause: 'TRUE', params: [] };
  }
  if (user.rol === 'admin_empresa') {
    return {
      joinClause: `JOIN sucursales _ts ON _ts.id = ${tableAlias}.sucursal_id`,
      whereClause: '_ts.empresa_id = $1',
      params: [user.empresa_id],
    };
  }
  return {
    joinClause: '',
    whereClause: `${tableAlias}.sucursal_id = $1`,
    params: [user.sucursal_id],
  };
}

/**
 * EXISTS subquery for tenant ownership in UPDATE/DELETE WHERE clauses.
 * Caller must append ownershipParams(user) to query params at position `offset`.
 */
export function ownershipClause(tableAlias: string, offset: number): string {
  return `EXISTS (
    SELECT 1 FROM sucursales _os
    WHERE _os.id = ${tableAlias}.sucursal_id
      AND ($${offset}::text = 'owner'
           OR ($${offset}::text = 'admin_empresa' AND _os.empresa_id = $${offset + 1})
           OR _os.id = $${offset + 2})
  )`;
}

export function ownershipParams(user: JwtPayload): [string, string | null, string | null] {
  return [user.rol, user.empresa_id, user.sucursal_id];
}

/** Ejecutor mínimo de consultas (Pool o PoolClient). */
interface Consultable {
  query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }>;
}

export type ResultadoSucursal =
  | { ok: true; id: string }
  | { ok: false; status: 400 | 403; error: string };

/**
 * Resuelve la sucursal sobre la que va a escribir el usuario.
 *
 * - Quien tiene sucursal en el JWT (admin_sucursal, agente, residente) escribe
 *   SIEMPRE en la suya; un `sucursal_id` distinto en el body se ignora.
 * - owner y admin_empresa no tienen sucursal propia: deben indicarla en el body
 *   y se comprueba contra la base que la sucursal esté activa y sea de su
 *   alcance (el owner, cualquiera; el admin de empresa, las de su empresa).
 *
 * Antes esta función caía a "la primera sucursal activa de toda la base" y no
 * validaba el body: un admin de empresa que omitía el campo publicaba anuncios,
 * áreas o configuración en una empresa ajena.
 */
export async function resolverSucursal(
  user: JwtPayload,
  bodySucursalId: unknown,
  db: Consultable,
): Promise<ResultadoSucursal> {
  if (user.sucursal_id) return { ok: true, id: user.sucursal_id };

  if (bodySucursalId === undefined || bodySucursalId === null || bodySucursalId === '') {
    return { ok: false, status: 400, error: 'Especifica sucursal_id.' };
  }
  if (!esUuid(bodySucursalId)) {
    return { ok: false, status: 400, error: 'sucursal_id inválido.' };
  }

  const r = await db.query(
    `SELECT s.id FROM sucursales s
     WHERE s.id = $1
       AND s.activo = TRUE
       AND ($2::text = 'owner' OR ($2::text = 'admin_empresa' AND s.empresa_id = $3))`,
    [bodySucursalId, user.rol, user.empresa_id],
  );
  if (r.rows.length === 0) return { ok: false, status: 403, error: 'Sin acceso a esa sucursal' };
  return { ok: true, id: r.rows[0].id };
}
