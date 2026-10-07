/**
 * I-1 · Login y sesión (integración)
 *
 * Componentes: Express (app.ts) → ruta /api/auth → auth.controller → Postgres real
 *   (tablas usuarios y refresh_tokens), con supertest. Sin mocks.
 * Condición: usuario activo sembrado con contraseña conocida; luego credenciales
 *   incorrectas y un correo que no existe.
 * Datos: seed (helpers/seed.ts), usuario adminSucA1; contraseña de prueba.
 * Resultado esperado:
 *   - login válido → 200 con JWT y cookie refresh_token httpOnly; fila en refresh_tokens
 *     con el HASH del token (no el token) y revoked = false.
 *   - contraseña mala y correo inexistente → el MISMO 401 y el mismo cuerpo.
 *   - refresh rota: el token anterior da 401, el nuevo funciona, y la BD deja el
 *     anterior revocado.
 */
import request from 'supertest';
import app from '../../app';
import { q, cerrarPool } from '../helpers/db';
import { sembrar, Fixtures } from '../helpers/seed';
import { login, PASSWORD } from '../helpers/auth';

let fx: Fixtures;
beforeAll(async () => { fx = await sembrar(); });
afterAll(cerrarPool);

describe('I-1 login y sesión', () => {
  it('login válido devuelve JWT, cookie httpOnly y guarda el refresh token hasheado', async () => {
    const s = await login(app, fx.email.adminSucA1);
    expect(s.status).toBe(200);
    expect(typeof s.token).toBe('string');
    expect(s.body.usuario).toMatchObject({ email: fx.email.adminSucA1, rol: 'admin_sucursal' });

    const set = s.setCookie.find(c => c.startsWith('refresh_token='))!;
    expect(set).toBeDefined();
    expect(set).toMatch(/HttpOnly/i);
    expect(set).toMatch(/SameSite=Strict/i);

    const crudo = s.cookie!.split('=')[1];
    const filas = await q('SELECT token_hash, revoked, expires_at FROM refresh_tokens WHERE usuario_id = $1', [fx.usuarios.adminSucA1]);
    expect(filas).toHaveLength(1);
    expect(filas[0].revoked).toBe(false);
    expect(filas[0].token_hash).not.toBe(crudo);          // se guarda el hash, no el token
    expect(filas[0].token_hash).toMatch(/^[0-9a-f]{64}$/); // SHA-256 hex
    expect(new Date(filas[0].expires_at).getTime()).toBeGreaterThan(Date.now());
  });

  it('contraseña incorrecta y correo inexistente dan el mismo 401', async () => {
    const mala = await request(app).post('/api/auth/login').send({ email: fx.email.adminSucA1, password: 'Incorrecta#1' });
    const noExiste = await request(app).post('/api/auth/login').send({ email: `nadie.${fx.sufijo}@inttest.local`, password: PASSWORD });
    expect(mala.status).toBe(401);
    expect(noExiste.status).toBe(401);
    expect(mala.body).toEqual(noExiste.body);
    expect(mala.headers['set-cookie']).toBeUndefined();
  });

  it('refresh rota el token: el anterior da 401 y el nuevo funciona', async () => {
    const s = await login(app, fx.email.agenteA1);
    expect(s.cookie).toBeDefined();

    const r1 = await request(app).post('/api/auth/refresh').set('Cookie', s.cookie!);
    expect(r1.status).toBe(200);
    expect(typeof r1.body.token).toBe('string');
    const nueva = ([] as string[]).concat(r1.headers['set-cookie']).find(c => c.startsWith('refresh_token='))!.split(';')[0];
    expect(nueva).not.toBe(s.cookie);

    const viejo = await request(app).post('/api/auth/refresh').set('Cookie', s.cookie!);
    expect(viejo.status).toBe(401);

    const r2 = await request(app).post('/api/auth/refresh').set('Cookie', nueva);
    expect(r2.status).toBe(200);

    const revocados = await q('SELECT count(*)::int AS n FROM refresh_tokens WHERE usuario_id = $1 AND revoked = TRUE', [fx.usuarios.agenteA1]);
    expect(revocados[0].n).toBe(2); // el original y el primero rotado
  });
});
