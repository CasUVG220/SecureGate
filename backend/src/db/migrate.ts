import fs from 'fs';
import path from 'path';
import pool from './pool';

/**
 * Resuelve la ruta de database/init.sql probando, en orden:
 *   1. INIT_SQL_PATH (override explícito)
 *   2. /app/database/init.sql  (montado en el contenedor vía docker-compose)
 *   3. ruta relativa al repo    (desarrollo local con `npm run dev`)
 */
function resolveInitSqlPath(): string | null {
  const candidates = [
    process.env.INIT_SQL_PATH,
    '/app/database/init.sql',
    path.resolve(__dirname, '../../../database/init.sql'),
  ].filter((p): p is string => !!p);

  return candidates.find(p => {
    try { return fs.existsSync(p); } catch { return false; }
  }) ?? null;
}

/** Igual que resolveInitSqlPath pero para el archivo de datos de demostración. */
function resolveSeedSqlPath(): string | null {
  const candidates = [
    process.env.SEED_SQL_PATH,
    '/app/database/seed-dev.sql',
    path.resolve(__dirname, '../../../database/seed-dev.sql'),
  ].filter((p): p is string => !!p);

  return candidates.find(p => {
    try { return fs.existsSync(p); } catch { return false; }
  }) ?? null;
}

/**
 * Cuentas demo que sembraba init.sql (ahora database/seed-dev.sql) y sus
 * contraseñas públicas. En producción se desactivan mientras conserven ESA
 * contraseña: son un acceso conocido por cualquiera que lea el repositorio.
 * Si el equipo ya cambió la contraseña de una cuenta, no se toca.
 */
export const CUENTAS_DEMO: ReadonlyArray<readonly [string, string]> = [
  ['admin@securegate.com', 'admin123'],
  ['empresa@securegate.com', 'empresa123'],
  ['sucursal@securegate.com', 'sucursal123'],
  ['agente1@securegate.com', 'agente123'],
  ['r1@securegate.com', 'res123'],
];

export async function desactivarCuentasDemo(db: { query: (sql: string, p?: unknown[]) => Promise<{ rows: any[] }> }): Promise<string[]> {
  const valores = CUENTAS_DEMO.map((_, i) => `($${i * 2 + 1}::text, $${i * 2 + 2}::text)`).join(', ');
  const params = CUENTAS_DEMO.flatMap(([email, pw]) => [email, pw]);
  const r = await db.query(
    `UPDATE usuarios u SET activo = FALSE
       FROM (VALUES ${valores}) AS d(email, pw)
      WHERE u.email = d.email AND u.activo = TRUE
        AND u.password_hash = crypt(d.pw, u.password_hash)
      RETURNING u.id, u.email`,
    params,
  );
  if (r.rows.length > 0) {
    await db.query(
      'UPDATE refresh_tokens SET revoked = TRUE WHERE usuario_id = ANY($1::uuid[]) AND revoked = FALSE',
      [r.rows.map(x => x.id)],
    );
  }
  return r.rows.map(x => x.email as string);
}

/**
 * Guarda de migraciones: aplica database/init.sql (idempotente — usa
 * CREATE TABLE IF NOT EXISTS, ALTER ... IF EXISTS y bloques DO $$ ... EXCEPTION)
 * contra la base ya existente en cada arranque del backend.
 *
 * Esto evita el problema clásico de docker-entrypoint-initdb.d, que sólo corre
 * los scripts en la primera inicialización del volumen: tras un deploy con
 * nuevas tablas/columnas, el esquema se pone al día solo.
 *
 * Nunca lanza: si algo falla, lo registra y deja que el servidor arranque igual
 * (mejor un endpoint con error visible que un crash-loop del backend).
 */
export async function runMigrations(): Promise<void> {
  const file = resolveInitSqlPath();
  if (!file) {
    console.warn('[migrate] init.sql no encontrado; se omiten las migraciones automáticas.');
    return;
  }

  let sql: string;
  try {
    sql = fs.readFileSync(file, 'utf8');
  } catch (err) {
    console.error('[migrate] No se pudo leer init.sql:', err);
    return;
  }

  const client = await pool.connect();
  try {
    console.log(`[migrate] Aplicando esquema idempotente desde ${file} …`);
    await client.query(sql);
    console.log('[migrate] Esquema al día.');

    if (process.env.NODE_ENV === 'production') {
      const desactivadas = await desactivarCuentasDemo(client);
      if (desactivadas.length > 0) {
        console.warn(
          `[migrate] SEGURIDAD: se desactivaron cuentas demo con contraseña pública: ${desactivadas.join(', ')}. ` +
          'Crea tu owner con `npm run owner:crear`.',
        );
      }
    } else if (process.env.SEED_DEMO === 'true') {
      const seed = resolveSeedSqlPath();
      if (seed) {
        await client.query(fs.readFileSync(seed, 'utf8'));
        console.log(`[migrate] Datos demo aplicados desde ${seed} (sólo desarrollo).`);
      }
    }
  } catch (err) {
    console.error('[migrate] Error aplicando migraciones (el backend continuará arrancando):', err);
  } finally {
    client.release();
  }
}
