/**
 * ── Hallazgo S-01 (backend/securitytest, Sprint 8) ───────────────────────────
 * Con un correo inexistente el login no ejecutaba bcrypt (2 ms) y con uno real
 * sí (~190 ms): la latencia revelaba qué cuentas existen aunque el mensaje 401
 * fuera idéntico. Ahora SIEMPRE se ejecuta un crypt(), contra el hash real o
 * contra un hash señuelo. Estos tests fijan ese invariante.
 */
jest.mock('../db/pool', () => ({ __esModule: true, default: { query: jest.fn(), connect: jest.fn() } }));
jest.mock('jsonwebtoken', () => ({ sign: jest.fn(() => 'token-firmado') }));

import pool from '../db/pool';
import { login } from '../controllers/auth.controller';

const mockPool = pool as unknown as { query: jest.Mock };
const res = () => { const r: any = {}; r.status = jest.fn().mockReturnValue(r); r.json = jest.fn().mockReturnValue(r); r.cookie = jest.fn(); return r; };
const req = (email: string, password: string) => ({ body: { email, password }, headers: {}, ip: '1.1.1.1' } as any);
const llamadasCrypt = () => mockPool.query.mock.calls.filter(c => /crypt\(/.test(c[0]));

beforeEach(() => { mockPool.query.mockReset(); process.env.JWT_SECRET = 'x'.repeat(40); });

it('correo inexistente: 401 idéntico y crypt() contra un hash señuelo bcrypt', async () => {
  mockPool.query
    .mockResolvedValueOnce({ rows: [] })                    // no hay cuenta
    .mockResolvedValueOnce({ rows: [{ ok: false }] });      // crypt() contra el señuelo
  const r = res();
  await login(req('nadie@x.com', 'cualquiera1'), r);

  expect(r.status).toHaveBeenCalledWith(401);
  expect(r.json).toHaveBeenCalledWith({ error: 'Credenciales incorrectas' });
  expect(llamadasCrypt()).toHaveLength(1);
  const hashUsado = llamadasCrypt()[0][1][1] as string;
  expect(hashUsado).toMatch(/^\$2[aby]\$12\$/);              // costo 12: mismo trabajo que una cuenta real
});

it('cuenta real con contraseña mala: 401 idéntico y también UN solo crypt()', async () => {
  mockPool.query
    .mockResolvedValueOnce({ rows: [{ id: 'u1', rol: 'agente', password_hash: '$2a$12$hashreal' }] })
    .mockResolvedValueOnce({ rows: [{ ok: false }] });
  const r = res();
  await login(req('real@x.com', 'mala-clave1'), r);

  expect(r.status).toHaveBeenCalledWith(401);
  expect(r.json).toHaveBeenCalledWith({ error: 'Credenciales incorrectas' });
  expect(llamadasCrypt()).toHaveLength(1);
  expect(llamadasCrypt()[0][1][1]).toBe('$2a$12$hashreal');
});

it('cuenta inactiva/inexistente y cuenta real fallida hacen el mismo número de consultas', async () => {
  mockPool.query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ ok: false }] });
  await login(req('nadie@x.com', 'x1234567'), res());
  const sinCuenta = mockPool.query.mock.calls.length;

  mockPool.query.mockReset();
  mockPool.query.mockResolvedValueOnce({ rows: [{ id: 'u1', rol: 'agente', password_hash: 'h' }] }).mockResolvedValueOnce({ rows: [{ ok: false }] });
  await login(req('real@x.com', 'mala-clave1'), res());
  expect(mockPool.query.mock.calls.length).toBe(sinCuenta);
});

it('la contraseña del señuelo jamás autentica (ok=true con cuenta inexistente sigue siendo 401)', async () => {
  mockPool.query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ ok: true }] });
  const r = res();
  await login(req('nadie@x.com', 'senuelo-no-es-una-clave-real'), r);
  expect(r.status).toHaveBeenCalledWith(401);
  expect(r.cookie).not.toHaveBeenCalled();
});
