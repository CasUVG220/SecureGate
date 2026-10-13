/**
 * globalSetup de integración/regresión.
 *  1. Valida la guarda (host local + base *_test).
 *  2. Deja la base limpia (DROP SCHEMA public) — seguro porque la guarda lo permite.
 *  3. Aplica el esquema con runMigrations() (la MISMA función que usa producción al
 *     arrancar; lee database/init.sql).
 *  4. Verifica que las tablas y columnas clave existen: runMigrations nunca lanza
 *     (traga los errores), así que un esquema a medias no fallaría solo.
 */
import { Client } from 'pg';
import { validarBaseDePrueba } from './guardaBd';

const TABLAS = [
  'empresas', 'sucursales', 'usuarios', 'residentes', 'refresh_tokens', 'invitaciones',
  'licencias_dispositivo', 'registros_acceso', 'visitantes', 'anuncios', 'anuncio_lecturas',
  'areas_comunes', 'reservas_areas', 'audit_logs', 'planes', 'suscripciones', 'suscripcion_historial', 'facturas_saas', 'facturas_saas_avisos', 'saas_contadores', 'onboarding_solicitudes',
];
const COLUMNAS: Array<[string, string]> = [
  ['registros_acceso', 'id_cliente'], ['registros_acceso', 'recibido_en'], ['registros_acceso', 'registrado_en'],
  ['registros_acceso', 'licencia_id'], ['registros_acceso', 'origen_dpi'], ['empresas', 'suspendida'], ['empresas', 'suspension_motivo'],
  ['invitaciones', 'token_hash'], ['invitaciones', 'expira_en'],
];

export default async function globalSetup(): Promise<void> {
  process.env.DATABASE_URL = process.env.DATABASE_URL
    || 'postgresql://postgres:postgres@127.0.0.1:55432/securegate_test';
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'secreto-de-prueba-solo-para-tests-0123456789abcdef';
  const url = process.env.DATABASE_URL;
  validarBaseDePrueba(url);

  const c = new Client({ connectionString: url });
  try {
    await c.connect();
  } catch (e) {
    throw new Error(`[globalSetup] No se pudo conectar a la base de prueba (${(e as Error).message}). ¿Está corriendo Postgres? Ver docs/tarea5_pruebas.md.`);
  }
  await c.query('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;');
  await c.end();

  const pool = (await import('../../db/pool')).default;
  const { runMigrations } = await import('../../db/migrate');
  await runMigrations();

  try {
    const t = await pool.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`);
    const hay = new Set(t.rows.map(r => r.table_name as string));
    const faltan = TABLAS.filter(x => !hay.has(x));
    const col = await pool.query(
      `SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public'`);
    const cols = new Set(col.rows.map(r => `${r.table_name}.${r.column_name}`));
    const faltanCols = COLUMNAS.filter(([a, b]) => !cols.has(`${a}.${b}`)).map(([a, b]) => `${a}.${b}`);
    if (faltan.length || faltanCols.length) {
      throw new Error(
        `[globalSetup] El esquema no quedó completo tras runMigrations() (revisa el log "[migrate]" arriba). ` +
        `Tablas faltantes: ${faltan.join(', ') || '—'}. Columnas faltantes: ${faltanCols.join(', ') || '—'}.`);
    }
  } finally {
    await pool.end();
  }
}
