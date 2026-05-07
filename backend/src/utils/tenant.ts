import { JwtPayload } from '../middleware/auth.middleware';

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

/**
 * Resolves sucursal_id for write operations.
 * Priority: JWT sucursal_id → body value → DB fallback (first active sucursal).
 * Returns null if none found.
 */
export async function resolveSucursalId(
  userSucursalId: string | null,
  bodySucursalId?: string,
  pool?: import('pg').Pool
): Promise<string | null> {
  if (userSucursalId) return userSucursalId;
  if (bodySucursalId) return bodySucursalId;
  if (!pool) return null;
  const fallback = await pool.query(
    'SELECT id FROM sucursales WHERE activo = TRUE ORDER BY created_at LIMIT 1'
  );
  return fallback.rows[0]?.id ?? null;
}
