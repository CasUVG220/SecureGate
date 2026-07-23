/**
 * ── Por qué se prioriza esta lógica para testing ─────────────────────────────
 * runMigrations() es la guarda que mantiene el esquema al día en cada deploy.
 * Si fallara silenciosamente, volveríamos al bug de "tabla/columna no existe"
 * tras cada release. Es infraestructura crítica de arranque, no un CRUD.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

jest.mock('../db/pool', () => ({
  __esModule: true,
  default: { connect: jest.fn(), query: jest.fn() },
}));

import pool from '../db/pool';
import { runMigrations } from '../db/migrate';

const mockPool = pool as unknown as { connect: jest.Mock };

describe('runMigrations (guarda de migraciones)', () => {
  afterEach(() => { delete process.env.INIT_SQL_PATH; });

  it('ejecuta el SQL del archivo apuntado por INIT_SQL_PATH y libera el cliente', async () => {
    const tmp = path.join(os.tmpdir(), `init_test_${process.pid}.sql`);
    const sql = 'CREATE TABLE IF NOT EXISTS __probe__ ();';
    fs.writeFileSync(tmp, sql);
    process.env.INIT_SQL_PATH = tmp;

    const client = { query: jest.fn().mockResolvedValue({}), release: jest.fn() };
    mockPool.connect.mockResolvedValue(client);

    await runMigrations();

    expect(client.query).toHaveBeenCalledWith(sql);
    expect(client.release).toHaveBeenCalled();

    fs.unlinkSync(tmp);
  });

  it('no lanza (y no conecta) si el archivo no se puede resolver', async () => {
    process.env.INIT_SQL_PATH = path.join(os.tmpdir(), 'no_existe_jamas.sql');
    // Simula que tampoco existe el fallback del repo para aislar el caso.
    const spy = jest.spyOn(fs, 'existsSync').mockReturnValue(false);

    await expect(runMigrations()).resolves.toBeUndefined();
    expect(mockPool.connect).not.toHaveBeenCalled();

    spy.mockRestore();
  });
});
