/**
 * ── Por qué existe este test ─────────────────────────────────────────────────
 * Piezas de endurecimiento que no son un controller concreto:
 *   - política de contraseñas y secreto JWT (arranque seguro),
 *   - revocación inmediata de access tokens al desactivar/suspender,
 *   - limpieza de cuentas demo con contraseña pública en producción,
 *   - auditoría con el resultado real de cada acción,
 *   - promesas rechazadas de handlers async (antes tumbaban el proceso).
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import http from 'http';
import type { AddressInfo } from 'net';

jest.mock('../db/pool', () => ({
  __esModule: true,
  default: { query: jest.fn(), connect: jest.fn() },
}));

import pool from '../db/pool';
import { validarPassword, PASSWORD_MIN } from '../utils/password';
import { validarJwtSecret, trustProxyHops, SECRETOS_CONOCIDOS } from '../config/env';
import { revocarAccesoDeUsuario, revocarAccesoDeEmpresa, tokenRevocado, _reiniciarRevocaciones } from '../utils/revocacion';
import { runMigrations, desactivarCuentasDemo, CUENTAS_DEMO } from '../db/migrate';
import { auditLog } from '../middleware/audit.middleware';
import { refresh } from '../controllers/auth.controller';
import { verifyToken, requireStaff } from '../middleware/auth.middleware';
import '../utils/asyncErrors';
import express from 'express';
import jwt from 'jsonwebtoken';
import { EventEmitter } from 'events';
import type { Request, Response } from 'express';

const mockPool = pool as unknown as { query: jest.Mock; connect: jest.Mock };

const makeRes = () => {
  const res: Partial<Response> = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res as Response;
};

beforeEach(() => {
  mockPool.query.mockReset();
  mockPool.connect.mockReset();
  _reiniciarRevocaciones();
});

// ─────────────────────────────────────────────────────────────────────────────
describe('validarPassword', () => {
  it.each([
    ['', 'vacía'],
    ['abc123', `corta (< ${PASSWORD_MIN})`],
    ['12345678', 'común'],
    ['password', 'común'],
    ['admin123', 'la de las cuentas demo públicas'],
    ['solo-letras', 'sin números'],
    ['123456789012', 'sin letras'],
    ['a1'.repeat(40), 'más de 72 bytes (bcrypt truncaría en silencio)'],
  ])('rechaza %p (%s)', pw => {
    expect(validarPassword(pw)).not.toBeNull();
  });

  it('rechaza una contraseña igual al correo', () => {
    expect(validarPassword('ana1@sg.com', 'ANA1@sg.com')).not.toBeNull();
  });

  it('acepta una contraseña razonable', () => {
    expect(validarPassword('mi-clave-larga-2026')).toBeNull();
    expect(validarPassword('Contraseña9')).toBeNull();
  });

  it('no es un string → error', () => {
    expect(validarPassword(undefined)).not.toBeNull();
    expect(validarPassword({ a: 1 })).not.toBeNull();
  });
});

describe('validarJwtSecret (arranque seguro)', () => {
  const fuerte = 'a'.repeat(48);

  it('acepta un secreto largo tanto en producción como en desarrollo', () => {
    expect(validarJwtSecret({ NODE_ENV: 'production', JWT_SECRET: fuerte } as any)).toEqual({ secret: fuerte, generado: false });
    expect(validarJwtSecret({ NODE_ENV: 'development', JWT_SECRET: fuerte } as any).generado).toBe(false);
  });

  it.each([...SECRETOS_CONOCIDOS])('rechaza el valor público %p en cualquier entorno', valor => {
    expect(() => validarJwtSecret({ NODE_ENV: 'production', JWT_SECRET: valor } as any)).toThrow(/público/);
    expect(() => validarJwtSecret({ NODE_ENV: 'development', JWT_SECRET: valor } as any)).toThrow(/público/);
  });

  it('en PRODUCCIÓN aborta si falta o es corto', () => {
    expect(() => validarJwtSecret({ NODE_ENV: 'production' } as any)).toThrow(/obligatorio/);
    expect(() => validarJwtSecret({ NODE_ENV: 'production', JWT_SECRET: 'corto' } as any)).toThrow(/obligatorio/);
  });

  it('en desarrollo, si falta genera uno aleatorio distinto cada vez (nunca uno conocido)', () => {
    const a = validarJwtSecret({ NODE_ENV: 'development' } as any);
    const b = validarJwtSecret({} as any);
    expect(a.generado).toBe(true);
    expect(a.secret.length).toBeGreaterThanOrEqual(32);
    expect(a.secret).not.toBe(b.secret);
    expect(SECRETOS_CONOCIDOS.has(a.secret)).toBe(false);
  });

  it('en desarrollo un secreto definido pero corto también se rechaza', () => {
    expect(() => validarJwtSecret({ NODE_ENV: 'development', JWT_SECRET: 'corto' } as any)).toThrow(/al menos/);
  });
});

describe('trustProxyHops', () => {
  it('0 por defecto (X-Forwarded-For no se cree); acota valores absurdos', () => {
    expect(trustProxyHops({} as any)).toBe(0);
    expect(trustProxyHops({ TRUST_PROXY: '1' } as any)).toBe(1);
    expect(trustProxyHops({ TRUST_PROXY: '999' } as any)).toBe(0);
    expect(trustProxyHops({ TRUST_PROXY: 'true' } as any)).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('revocación inmediata de access tokens', () => {
  const ahora = Math.floor(Date.now() / 1000);

  it('un token anterior a la revocación del usuario queda invalidado; uno posterior no', () => {
    revocarAccesoDeUsuario('u-1', (ahora) * 1000);
    expect(tokenRevocado({ id: 'u-1', iat: ahora - 30 })).toBe(true);
    expect(tokenRevocado({ id: 'u-1', iat: ahora + 5 })).toBe(false);
    expect(tokenRevocado({ id: 'u-2', iat: ahora - 30 })).toBe(false);
  });

  it('suspender una empresa invalida los tokens de TODOS sus usuarios', () => {
    revocarAccesoDeEmpresa('emp-1', ahora * 1000);
    expect(tokenRevocado({ id: 'a', empresa_id: 'emp-1', iat: ahora - 5 })).toBe(true);
    expect(tokenRevocado({ id: 'b', empresa_id: 'emp-1', iat: ahora - 500 })).toBe(true);
    expect(tokenRevocado({ id: 'c', empresa_id: 'emp-2', iat: ahora - 5 })).toBe(false);
    expect(tokenRevocado({ id: 'd', empresa_id: null, iat: ahora - 5 })).toBe(false);
  });

  it('verifyToken responde 401 «Sesión revocada» (y el cliente intenta refresh, que también falla)', () => {
    process.env.JWT_SECRET = 'verify-token-test-'.padEnd(40, 'z');
    const token = jwt.sign({ id: 'u-9', rol: 'agente', sucursal_id: 's', empresa_id: 'e' }, process.env.JWT_SECRET, { expiresIn: '1h' });
    const r = { headers: { authorization: `Bearer ${token}` } } as unknown as Request;

    const ok = makeRes(); const next1 = jest.fn();
    verifyToken(r, ok, next1);
    expect(next1).toHaveBeenCalled();

    revocarAccesoDeUsuario('u-9', Date.now() + 1000);
    const res = makeRes(); const next2 = jest.fn();
    verifyToken({ headers: { authorization: `Bearer ${token}` } } as unknown as Request, res, next2);
    expect(next2).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('requireStaff es lista blanca: un rol ausente o desconocido NO pasa (antes sólo se excluía a "residente")', () => {
    for (const rol of [undefined, 'residente', 'licencia', 'x']) {
      const res = makeRes(); const next = jest.fn();
      requireStaff({ user: rol === undefined ? {} : { rol } } as unknown as Request, res, next);
      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(403);
    }
    const next = jest.fn();
    requireStaff({ user: { rol: 'agente' } } as unknown as Request, makeRes(), next);
    expect(next).toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('migraciones y cuentas demo', () => {
  const entorno = { ...process.env };
  afterEach(() => {
    process.env = { ...entorno };
    delete process.env.INIT_SQL_PATH;
    delete process.env.SEED_SQL_PATH;
  });

  const conArchivos = () => {
    const init = path.join(os.tmpdir(), `init_sec_${process.pid}.sql`);
    const seed = path.join(os.tmpdir(), `seed_sec_${process.pid}.sql`);
    fs.writeFileSync(init, 'SELECT 1;');
    fs.writeFileSync(seed, "INSERT INTO usuarios VALUES ('demo');");
    process.env.INIT_SQL_PATH = init;
    process.env.SEED_SQL_PATH = seed;
    return { init, seed };
  };

  it('desactivarCuentasDemo: sólo toca cuentas que AÚN usan la contraseña pública, y les cierra las sesiones', async () => {
    const db = { query: jest.fn()
      .mockResolvedValueOnce({ rows: [{ id: 'u-1', email: 'admin@securegate.com' }] })
      .mockResolvedValueOnce({ rows: [] }) };
    const out = await desactivarCuentasDemo(db);

    expect(out).toEqual(['admin@securegate.com']);
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('u.password_hash = crypt(d.pw, u.password_hash)'); // si ya cambió la clave, no se toca
    expect(params).toEqual(CUENTAS_DEMO.flatMap(([e, p]) => [e, p]));
    expect(params).toContain('admin@securegate.com');
    expect(db.query.mock.calls[1][0]).toContain('UPDATE refresh_tokens SET revoked = TRUE');
  });

  it('desactivarCuentasDemo: si no hay cuentas demo, no toca refresh_tokens', async () => {
    const db = { query: jest.fn().mockResolvedValueOnce({ rows: [] }) };
    expect(await desactivarCuentasDemo(db)).toEqual([]);
    expect(db.query).toHaveBeenCalledTimes(1);
  });

  it('en PRODUCCIÓN: aplica init.sql, desactiva las cuentas demo y NUNCA corre el seed (aunque SEED_DEMO=true)', async () => {
    const { init, seed } = conArchivos();
    process.env.NODE_ENV = 'production';
    process.env.SEED_DEMO = 'true';
    const client = { query: jest.fn().mockResolvedValue({ rows: [] }), release: jest.fn() };
    mockPool.connect.mockResolvedValue(client);
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});

    await runMigrations();

    const sqls = client.query.mock.calls.map(c => c[0] as string);
    log.mockRestore();
    expect(sqls[0]).toBe('SELECT 1;');
    expect(sqls.some(s => s.includes('crypt(d.pw'))).toBe(true);
    expect(sqls.some(s => s.includes("INSERT INTO usuarios VALUES ('demo')"))).toBe(false);
    warn.mockRestore(); fs.unlinkSync(init); fs.unlinkSync(seed);
  });

  it('en desarrollo el seed SÓLO corre con SEED_DEMO=true', async () => {
    const { init, seed } = conArchivos();
    process.env.NODE_ENV = 'development';
    const client = { query: jest.fn().mockResolvedValue({ rows: [] }), release: jest.fn() };
    mockPool.connect.mockResolvedValue(client);
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});

    delete process.env.SEED_DEMO;
    await runMigrations();
    expect(client.query.mock.calls.map(c => c[0])).not.toContain("INSERT INTO usuarios VALUES ('demo');");

    client.query.mockClear();
    process.env.SEED_DEMO = 'true';
    await runMigrations();
    expect(client.query.mock.calls.map(c => c[0])).toContain("INSERT INTO usuarios VALUES ('demo');");
    log.mockRestore(); fs.unlinkSync(init); fs.unlinkSync(seed);
  });

  it('init.sql ya NO contiene las cuentas demo ni sus contraseñas públicas', () => {
    const initSql = fs.readFileSync(path.resolve(__dirname, '../../../database/init.sql'), 'utf8');
    for (const [email, pw] of CUENTAS_DEMO) {
      expect(initSql).not.toContain(email);
      expect(initSql).not.toContain(`crypt('${pw}'`);
    }
    const seedSql = fs.readFileSync(path.resolve(__dirname, '../../../database/seed-dev.sql'), 'utf8');
    expect(seedSql).toContain('admin@securegate.com'); // siguen existiendo, pero sólo para desarrollo
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('refresh token', () => {
  it('un usuario DESACTIVADO ya no puede renovar sesión (antes conservaba 7 días de refresh)', async () => {
    // El usuario se trae con su estado (SCRUM-129 / S-11 dejó de filtrarlo en el WHERE para poder distinguir una
    // empresa suspendida); si está dado de baja se responde 401 sin consultar nada más ni rotar el token.
    mockPool.query.mockResolvedValueOnce({ rows: [{
      id: 'rt-1', usuario_id: 'u-1', revoked: false, vigente: true, activo: false,
      nombre: 'Ana', email: 'a@x.com', rol: 'agente', sucursal_id: 'suc-1', empresa_id: null, empresa_id_via_sucursal: 'emp-1',
    }] });
    const res = Object.assign(makeRes(), { clearCookie: jest.fn() });
    await refresh({ cookies: { refresh_token: 'x'.repeat(128) }, ip: '1.1.1.1' } as unknown as Request, res);

    expect(mockPool.query.mock.calls[0][0]).toContain('u.activo');
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.clearCookie).toHaveBeenCalled();
    expect(mockPool.query).toHaveBeenCalledTimes(1);               // ni empresa, ni UPDATE, ni INSERT del token nuevo
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('auditLog', () => {
  const armar = (over: Record<string, unknown> = {}) => {
    const res = Object.assign(new EventEmitter(), { statusCode: 200 }) as unknown as Response;
    const req = {
      ip: '10.1.2.3',
      headers: { 'user-agent': 'jest', 'x-forwarded-for': '6.6.6.6' },
      params: {},
      body: {},
      user: { id: 'u-1', sucursal_id: 'suc-1' },
      ...over,
    } as unknown as Request;
    return { req, res };
  };

  it('escribe AL TERMINAR la respuesta, con el código HTTP real y sin creerle a X-Forwarded-For', () => {
    mockPool.query.mockResolvedValue({ rows: [] });
    const { req, res } = armar({ params: { id: '3f2504e0-4f89-11d3-9a0c-0305e82c3301' } });
    const next = jest.fn();
    auditLog({ accion: 'USUARIO_DESACTIVADO', tabla: 'usuarios' })(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(mockPool.query).not.toHaveBeenCalled();           // todavía no: la acción no terminó
    (res as any).statusCode = 403;
    (res as unknown as EventEmitter).emit('finish');

    const [, p] = mockPool.query.mock.calls[0];
    expect(p).toEqual([
      'u-1', 'USUARIO_DESACTIVADO', 'usuarios', '3f2504e0-4f89-11d3-9a0c-0305e82c3301',
      '10.1.2.3', 'jest', 'suc-1', 403, null,
    ]);
    expect(p).not.toContain('6.6.6.6');
  });

  it('en un LOGIN guarda el correo intentado (nunca la contraseña) aunque no haya sesión', () => {
    mockPool.query.mockResolvedValue({ rows: [] });
    const { req, res } = armar({ user: undefined, body: { email: ' Victima@SG.com ', password: 'secreto-1' } });
    auditLog({ accion: 'LOGIN' })(req, res, jest.fn());
    (res as unknown as EventEmitter).emit('finish');

    const params = mockPool.query.mock.calls[0][1];
    expect(params[8]).toBe(JSON.stringify({ email: 'Victima@SG.com' }));
    expect(JSON.stringify(params)).not.toContain('secreto-1');
  });

  it('si la auditoría falla, la petición no se ve afectada', () => {
    mockPool.query.mockRejectedValue(new Error('db caída'));
    const { req, res } = armar();
    auditLog({ accion: 'X' })(req, res, jest.fn());
    expect(() => (res as unknown as EventEmitter).emit('finish')).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('handlers async que lanzan (antes: unhandledRejection → el proceso caía)', () => {
  it('una promesa rechazada llega al manejador de errores y responde 500 sin filtrar el mensaje', async () => {
    const app = express();
    app.get('/boom', async () => { throw new Error('relation "usuarios" does not exist'); });
    app.use((err: Error, _req: Request, res: Response, _n: unknown) => res.status(500).json({ error: 'Error en el servidor' }));
    const server = http.createServer(app);
    await new Promise<void>(r => server.listen(0, r));
    try {
      const res = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/boom`);
      expect(res.status).toBe(500);
      expect(JSON.stringify(await res.json())).not.toContain('usuarios');
    } finally {
      await new Promise(r => server.close(r));
    }
  });
});
