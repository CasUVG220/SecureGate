/**
 * R-3 · Regresión de suspensión de empresa
 *
 * Componentes: Express (app.ts) → PATCH /api/empresas/:id/suspender|reactivar (owner),
 *   /api/auth/login y /refresh, /api/licencias/heartbeat, verifyToken (revocación en
 *   memoria) → utils/suspension.ts → Postgres real (empresas, refresh_tokens).
 * Condición: la empresa A tiene sesiones y una licencia de garita activas; el owner la
 *   suspende. La empresa B no se toca.
 * Datos: seed (empresas A y B, usuarios de A1 y B1, licencia activada de A1).
 * Resultado esperado (suspendida): login de sus usuarios → 423 (código empresa_suspendida);
 *   contraseña errada → 401 (no 423); heartbeat de la licencia → 423; access token vivo →
 *   401 "Sesión revocada"; refresh con la cookie previa → 423 con el motivo (sus refresh tokens quedan revocados, pero el cliente debe
 *   enterarse de por qué: S-11); la empresa B sigue operando. Tras reactivar: login → 200 y heartbeat → 200, y la cookie vieja → 401.
 */
import request from 'supertest';
import app from '../../app';
import { uno, cerrarPool } from '../helpers/db';
import { sembrar, Fixtures } from '../helpers/seed';
import { login, bearer } from '../helpers/auth';

let fx: Fixtures;
let owner: string;
let vivoA: { token: string; cookie: string };
let licA1: string;
let tokenB: string;
const dormir = (ms: number) => new Promise(r => setTimeout(r, ms));

beforeAll(async () => {
  fx = await sembrar();
  owner = (await login(app, fx.email.owner)).token!;
  const a = await login(app, fx.email.adminSucA1);
  vivoA = { token: a.token!, cookie: a.cookie! };
  const act = await request(app).post('/api/licencias/activar')
    .send({ codigo: fx.licencias.A1.codigo, fingerprint: fx.licencias.A1.fingerprint });
  expect(act.status).toBe(200);
  licA1 = act.body.token_licencia;
  tokenB = (await login(app, fx.email.adminSucB1)).token!;
});
afterAll(cerrarPool);

const heartbeat = (lic: string) =>
  request(app).post('/api/licencias/heartbeat').set('X-Licencia-Token', lic).send({});

describe('R-3 suspensión de empresa', () => {
  it('antes de suspender: todo opera (control positivo)', async () => {
    expect((await request(app).get('/api/accesos/activos').set(bearer(vivoA.token))).status).toBe(200);
    expect((await heartbeat(licA1)).status).toBe(200);
  });

  it('suspendida: login 423, contraseña errada 401, heartbeat 423, token vivo 401, refresh 423, B intacta', async () => {
    const s = await request(app).patch(`/api/empresas/${fx.empresas.A}/suspender`).set(bearer(owner)).send({ motivo: 'Prueba de regresión' });
    expect(s.status).toBe(200);
    expect(s.body.suspendida).toBe(true);
    await dormir(1100); // el `iat` del JWT tiene resolución de segundos (ver utils/revocacion.ts)

    for (const k of ['adminSucA1', 'agenteA1', 'resA1', 'adminEmpA']) {
      const r = await login(app, fx.email[k]);
      expect(r.status).toBe(423);
      expect(r.body.codigo).toBe('empresa_suspendida');
      expect(r.token).toBeUndefined();
    }

    const mala = await request(app).post('/api/auth/login').send({ email: fx.email.adminSucA1, password: 'Incorrecta#1' });
    expect(mala.status).toBe(401);

    expect((await heartbeat(licA1)).status).toBe(423);

    const vivo = await request(app).get('/api/accesos/activos').set(bearer(vivoA.token));
    expect(vivo.status).toBe(401);

    // Suspender revoca todos los refresh tokens de la empresa en BD: la sesión no se puede renovar, y el cliente debe
    // enterarse POR QUÉ (S-11): 423 con el motivo, no un 401 mudo que lo manda al login sin explicación.
    const refresh = await request(app).post('/api/auth/refresh').set('Cookie', vivoA.cookie);
    expect(refresh.status).toBe(423);
    expect(refresh.body).toMatchObject({ codigo: 'empresa_suspendida', motivo: 'Prueba de regresión' });
    expect(refresh.body.token).toBeUndefined();
    expect(([] as string[]).concat(refresh.headers['set-cookie'] ?? []).join(';')).toMatch(/refresh_token=;/);   // la cookie se limpia

    // Otra empresa sin afectar
    expect((await login(app, fx.email.adminSucB1)).status).toBe(200);
    expect((await request(app).get('/api/accesos/activos').set(bearer(tokenB))).status).toBe(200);
    const b = await uno('SELECT suspendida FROM empresas WHERE id = $1', [fx.empresas.B]);
    expect(b.suspendida).toBe(false);
  });

  it('reactivada: el login y el heartbeat vuelven a funcionar', async () => {
    const r = await request(app).patch(`/api/empresas/${fx.empresas.A}/reactivar`).set(bearer(owner)).send({});
    expect(r.status).toBe(200);
    await dormir(1100);
    const l = await login(app, fx.email.adminSucA1);
    expect(l.status).toBe(200);
    expect((await request(app).get('/api/accesos/activos').set(bearer(l.token))).status).toBe(200);
    expect((await heartbeat(licA1)).status).toBe(200);
    // Con la empresa en regla, el refresh token que la suspensión revocó sigue sin servir: 401 (hay que iniciar sesión).
    expect((await request(app).post('/api/auth/refresh').set('Cookie', vivoA.cookie)).status).toBe(401);
  });
});
