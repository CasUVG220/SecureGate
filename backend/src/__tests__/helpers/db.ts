import pool from '../../db/pool';

/** Consulta directa al Postgres real de prueba (el mismo pool que usa la app). */
export const q = async <T = any>(sql: string, params: unknown[] = []): Promise<T[]> =>
  (await pool.query(sql, params)).rows as T[];

export const uno = async <T = any>(sql: string, params: unknown[] = []): Promise<T | undefined> =>
  (await q<T>(sql, params))[0];

/** Cierra el pool al terminar un archivo de test (si no, jest no sale limpio). */
export const cerrarPool = (): Promise<void> => pool.end();
