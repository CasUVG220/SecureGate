/**
 * I-16 · Límites de tasa de la verificación en dos pasos — SCRUM-123 / SCRUM-125
 *
 * Componentes: Express (app.ts) → limitadores (middleware/limitadores.ts) de /api/auth/2fa/* → controllers → Postgres real.
 * Condición: los topes se bajan por variables de entorno ANTES de cargar la app, para poder agotarlos.
 * Resultado esperado (además del bloqueo por PERSONA en la base, que prueba `twofa.int.test.ts`):
 *   - ingreso: pasado el tope de fallos por IP, el siguiente intento es 429 aunque el código sea el correcto, y queda en
 *     `audit_logs` como TWOFA_VERIFICACION con status 429 y el nombre del límite;
 *   - desactivar: el cupo es de la PERSONA (otro administrador desde la misma IP no se ve afectado); el bloqueo queda
 *     auditado con la persona y la IP.
 */
process.env.RATE_LIMIT_2FA_MAX = '3';
process.env.RATE_LIMIT_2FA_DESACTIVAR_MAX = '2';

import request from 'supertest';
import app from '../../app';
import { q, cerrarPool } from '../helpers/db';
import { sembrar, Fixtures } from '../helpers/seed';
import { login, bearer, PASSWORD } from '../helpers/auth';
import { adminNuevo, activarDosPasos, totp } from '../helpers/twofa';

let fx: Fixtures;
beforeAll(async () => { fx = await sembrar(); });
afterAll(cerrarPool);

const filas = async (sql: string, params: unknown[], n = 1) => {
  const limite = Date.now() + 3000;
  let r: any[] = [];
  do {
    r = await q(sql, params);
    if (r.length >= n) return r;
    await new Promise(res => setTimeout(res, 50));
  } while (Date.now() < limite);
  return r;
};

describe('I-16 límites de tasa de dos pasos', () => {
  it('desactivar: el 3.er intento fallido es 429 (el cupo es de la persona) y queda auditado con ella', async () => {
    const x = await adminNuevo(app, 'admin_sucursal', fx.sucursales.A1, null, fx.sufijo);
    const y = await adminNuevo(app, 'admin_sucursal', fx.sucursales.A1, null, fx.sufijo);
    const dx = await activarDosPasos(app, x);
    const dy = await activarDosPasos(app, y);

    const mal = (a: typeof x) => request(app).post('/api/auth/2fa/desactivar').set(bearer(a.token)).send({ password: PASSWORD, codigo: '000000' });
    expect((await mal(x)).status).toBe(400);
    expect((await mal(x)).status).toBe(400);
    const bloqueado = await mal(x);
    expect(bloqueado.status).toBe(429);

    // Aunque ya traiga el código bueno, el cupo de x está agotado.
    const conElBueno = await request(app).post('/api/auth/2fa/desactivar').set(bearer(x.token)).send({ password: PASSWORD, codigo: totp(dx.secreto) });
    expect(conElBueno.status).toBe(429);

    // y, desde la misma IP, y sí puede.
    const ok = await request(app).post('/api/auth/2fa/desactivar').set(bearer(y.token)).send({ password: PASSWORD, codigo: totp(dy.secreto) });
    expect(ok.status).toBe(200);

    const f = await filas(`SELECT usuario_id, ip_address, status_code, datos_nuevos FROM audit_logs WHERE accion = 'TWOFA_DESACTIVADO' AND status_code = 429 AND usuario_id = $1`, [x.id], 2);
    expect(f).toHaveLength(2);
    for (const fila of f) {
      expect(fila.ip_address).toBeTruthy();
      expect(fila.datos_nuevos).toMatchObject({ limite: 'dos-pasos-usuario-desactivado' });
    }
  });

  it('ingreso: pasado el tope de fallos por IP, el siguiente intento es 429 aunque el código sea el bueno, y queda auditado', async () => {
    const a = await adminNuevo(app, 'admin_sucursal', fx.sucursales.A1, null, fx.sufijo);
    const { secreto } = await activarDosPasos(app, a);
    const d = (await login(app, a.email)).body.desafio as string;

    const mal = () => request(app).post('/api/auth/2fa/verificar').send({ desafio: d, codigo: '000000' });
    expect([(await mal()).status, (await mal()).status, (await mal()).status]).toEqual([401, 401, 401]);

    const frenado = await request(app).post('/api/auth/2fa/verificar').send({ desafio: d, codigo: totp(secreto) });
    expect(frenado.status).toBe(429);
    expect(frenado.body.token).toBeUndefined();

    const f = await filas(`SELECT ip_address, status_code, datos_nuevos FROM audit_logs WHERE accion = 'TWOFA_VERIFICACION' AND status_code = 429 AND datos_nuevos->>'limite' = 'dos-pasos-ip'`, []);
    expect(f.length).toBeGreaterThanOrEqual(1);
    expect(f[0].ip_address).toBeTruthy();
  });
});
