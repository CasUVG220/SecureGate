import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

/**
 * `max` default (20): sin fijarlo, `pg` usa 10 — con un solo backend Node
 * en la VM actual (e2-micro) eso agota el pool a ~140-160 VU/s bajo carga
 * (ver backend/loadtest/RESULTADOS-sprint7.md). 20 deja margen bajo el
 * `max_connections=100` de Postgres 15 (un solo proceso Node, sin otros
 * consumidores) sin saturar una VM de recursos limitados. Configurable por
 * env var porque Sprint 8 contempla migrar a Cloud SQL, donde este número
 * probablemente deba subir.
 */
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: parseInt(process.env.DB_POOL_MAX || '20', 10),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

export default pool;
