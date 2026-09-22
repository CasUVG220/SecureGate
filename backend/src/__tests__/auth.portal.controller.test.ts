/**
 * ── Por qué se prioriza esta lógica para testing ─────────────────────────────
 * La app se sirve desde dos entradas —/personal y /residente— y cada una admite
 * sólo a su público. Si esa comprobación se cae, el portal del residente vuelve
 * a aceptar credenciales de administración y la separación deja de existir sin
 * que nada falle a la vista. Se fija además el orden: la contraseña se valida
 * ANTES que el portal, para que el aviso de "portal equivocado" no revele desde
 * fuera qué correos existen ni con qué rol.
 */
jest.mock('../db/pool', () => ({
  __esModule: true,
  default: { query: jest.fn(), connect: jest.fn() },
}));
jest.mock('jsonwebtoken', () => ({ sign: jest.fn(() => 'token-firmado') }));

import pool from '../db/pool';
import { login } from '../controllers/auth.controller';
import type { Request, Response } from 'express';

const mockPool = pool as unknown as { query: jest.Mock };

function makeRes() {
  const res: Partial<Response> = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  res.cookie = jest.fn().mockReturnValue(res);
  return res as Response;
}

const usuario = (rol: string) => ({
  id: 'u1', nombre: 'Prueba', email: 'p@test.com', rol,
  sucursal_id: 's1', empresa_id: null, idioma: 'es', tema: 'dark',
  empresa_id_via_sucursal: 'e1',
});

const reqCon = (body: Record<string, unknown>) =>
  ({ body, headers: {}, ip: '127.0.0.1' } as unknown as Request);

/** El SELECT de la cuenta resuelve, crypt() confirma la contraseña y el INSERT del refresh token también. */
function credencialesValidas(rol: string) {
  mockPool.query.mockReset();
  mockPool.query.mockImplementation((sql: string) => {
    const q = String(sql);
    if (q.includes('crypt(')) return Promise.resolve({ rows: [{ ok: true }] });
    if (q.includes('FROM usuarios')) return Promise.resolve({ rows: [{ ...usuario(rol), password_hash: 'hash-real' }] });
    return Promise.resolve({ rows: [], rowCount: 1 });
  });
}

describe('login por portal', () => {
  beforeEach(() => { process.env.JWT_SECRET = 'secreto-de-prueba'; });

  it.each([
    ['admin_sucursal', 'personal'],
    ['agente', 'personal'],
    ['owner', 'personal'],
    ['residente', 'residente'],
  ])('%s entra por /%s', async (rol, portal) => {
    credencialesValidas(rol);
    const res = makeRes();
    await login(reqCon({ email: 'p@test.com', password: 'x', portal }), res);

    expect(res.status).not.toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ token: 'token-firmado' }));
  });

  it.each([
    ['admin_sucursal', 'residente', 'personal'],
    ['agente', 'residente', 'personal'],
    ['residente', 'personal', 'residente'],
  ])('%s NO entra por /%s y se le indica /%s', async (rol, portal, correcto) => {
    credencialesValidas(rol);
    const res = makeRes();
    await login(reqCon({ email: 'p@test.com', password: 'x', portal }), res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ portalCorrecto: correcto }));
    // Ni token ni cookie de refresco: el intento no deja sesión de ningún tipo.
    expect(res.cookie).not.toHaveBeenCalled();
  });

  it('la contraseña se valida antes que el portal', async () => {
    // Sin fila coincidente el controlador ni siquiera llega a mirar el portal:
    // así el 403 sólo lo ve quien ya demostró conocer la contraseña.
    mockPool.query.mockReset();
    mockPool.query.mockResolvedValue({ rows: [] });
    const res = makeRes();

    await login(reqCon({ email: 'p@test.com', password: 'mala', portal: 'residente' }), res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Credenciales incorrectas' });
  });

  it('rechaza un portal que no existe sin consultar la base', async () => {
    mockPool.query.mockReset();
    const res = makeRes();

    await login(reqCon({ email: 'p@test.com', password: 'x', portal: 'garita' }), res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockPool.query).not.toHaveBeenCalled();
  });
});
