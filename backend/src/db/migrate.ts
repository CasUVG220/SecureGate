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
  } catch (err) {
    console.error('[migrate] Error aplicando migraciones (el backend continuará arrancando):', err);
  } finally {
    client.release();
  }
}
