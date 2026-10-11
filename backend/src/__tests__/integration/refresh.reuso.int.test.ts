/**
 * I-18 · Rotación del refresh token con detección de reutilización — SCRUM-124 / S-06 (SCRUM-176)
 *
 * Componentes: Express (app.ts) → POST /api/auth/login | /refresh | /logout → auth.controller → Postgres real (refresh_tokens,
 *   audit_logs). supertest, sin mocks.
 * Condición: usuarios de prueba propios (cada caso abre sus sesiones; cerrar una familia corta los access tokens de la persona).
 * Resultado esperado:
 *   - cada inicio de sesión abre una FAMILIA; la renovación rota el token dentro de ella (el viejo queda revocado, con
 *     `rotado_en` y `reemplazado_por`; el nuevo hereda la familia);
 *   - un token ya rotado que se presenta otra vez pasada la gracia CIERRA la familia entera (también el token vigente de quien
 *     lo había rotado), corta los access tokens de la persona y deja una fila REFRESH_REUTILIZADO con la persona y la IP;
 *   - DENTRO de la gracia (dos pestañas renovando a la vez) no pasa nada: cada petición recibe su sucesor y la sesión sigue;
 *   - otra sesión de la misma persona (otra familia) no se ve afectada;
 *   - un token revocado por cierre de sesión o por cambio de contraseña NO es una señal de robo (401 normal, sin cerrar nada).
 */
import request from 'supertest';
import { createHash } from 'crypto';
import app from '../../app';
import { q, uno, cerrarPool } from '../helpers/db';
import { sembrar, Fixtures } from '../helpers/seed';
import { login, bearer } from '../helpers/auth';
import { adminNuevo } from '../helpers/twofa';

let fx: Fixtures;
beforeAll(async () => { fx = await sembrar(); });
afterAll(cerrarPool);

const hash = (cookie: string) => createHash('sha256').update(cookie.split('=')[1]).digest('hex');
const refrescar = (cookie: string) => request(app).post('/api/auth/refresh').set('Cookie', cookie).send({});
const nuevaCookie = (r: request.Response) =>
  ([] as string[]).concat(r.headers['set-cookie'] ?? []).find(c => c.startsWith('refresh_token='))?.split(';')[0];
const fila = (cookie: string) => uno('SELECT * FROM refresh_tokens WHERE token_hash = $1', [hash(cookie)]);

/** Un administrador propio con una sesión abierta (cookie incluida). */
const sesion = async () => {
  const a = await adminNuevo(app, 'admin_sucursal', fx.sucursales.A1, null, fx.sufijo);
  const s = await login(app, a.email);
  expect(s.status).toBe(200);
  return { a, s, cookie: s.cookie! };
};

/** Hace pasar el tiempo: el token se rotó hace 5 minutos (fuera de la gracia de 10 s). */
const envejecerRotaciones = (usuarioId: string) =>
  q(`UPDATE refresh_tokens SET rotado_en = NOW() - interval '5 minutes' WHERE usuario_id = $1 AND rotado_en IS NOT NULL`, [usuarioId]);

const auditoria = async (accion: string, usuarioId: string) => {
  const limite = Date.now() + 3000;
  let r: any[] = [];
  do {
    r = await q('SELECT * FROM audit_logs WHERE accion = $1 AND usuario_id = $2 ORDER BY created_at', [accion, usuarioId]);
    if (r.length) return r;
    await new Promise(res => setTimeout(res, 50));
  } while (Date.now() < limite);
  return r;
};

describe('I-18 la rotación conserva la familia', () => {
  it('cada inicio de sesión abre una familia distinta y la renovación la hereda', async () => {
    const { a, cookie } = await sesion();
    const segunda = await login(app, a.email);
    const f1 = await fila(cookie);
    const f2 = await fila(segunda.cookie!);
    expect(f1.familia_id).toBeTruthy();
    expect(f1.familia_id).not.toBe(f2.familia_id);

    const r = await refrescar(cookie);
    expect(r.status).toBe(200);
    const hijo = await fila(nuevaCookie(r)!);
    expect(hijo.familia_id).toBe(f1.familia_id);
    expect(hijo.revoked).toBe(false);
    expect(hijo.rotado_en).toBeNull();

    const padre = await fila(cookie);
    expect(padre).toMatchObject({ revoked: true, reemplazado_por: hijo.id });
    expect(padre.rotado_en).toBeTruthy();
    expect(padre.revoked_at).toBeTruthy();
  });
});

describe('I-18 reutilizar un token ya rotado cierra la sesión', () => {
  it('pasada la gracia: 401, cierra la familia entera (también el token vigente), corta los access tokens y lo audita', async () => {
    const { a, cookie: t1 } = await sesion();
    const r1 = await refrescar(t1);
    expect(r1.status).toBe(200);
    const t2 = nuevaCookie(r1)!;
    const accessAntes = r1.body.token as string;
    await envejecerRotaciones(a.id);

    const reuso = await refrescar(t1);                       // alguien presenta el T1 que ya se había cambiado
    expect(reuso.status).toBe(401);
    expect(reuso.body.codigo).toBe('sesion_comprometida');
    expect(reuso.headers['set-cookie']?.[0] ?? '').toMatch(/refresh_token=;/);        // la cookie se limpia

    // La familia entera quedó revocada: el T2 que tenía el dueño (o el ladrón) ya no sirve.
    expect((await fila(t2)).revoked).toBe(true);
    expect((await fila(t2)).revoked_at).toBeTruthy();
    const despues = await refrescar(t2);
    expect(despues.status).toBe(401);
    expect(despues.body.codigo).toBe('sesion_comprometida');          // el dueño legítimo se entera de por qué pierde la sesión…
    expect((await fila(t2)).cierre_motivo).toBe('reutilizacion');

    // Los access tokens de la persona anteriores a este momento dejan de servir.
    const conAccess = await request(app).get('/api/auth/2fa/estado').set(bearer(accessAntes));
    expect(conAccess.status).toBe(401);

    const f = (await auditoria('REFRESH_REUTILIZADO', a.id))[0];
    expect(f).toBeDefined();
    expect(f).toMatchObject({ status_code: 401, tabla_afectada: 'refresh_tokens', sucursal_id: fx.sucursales.A1 });
    expect(f.ip_address).toBeTruthy();
    expect(f.datos_nuevos).toMatchObject({ motivo: 'token_reutilizado', sesiones_cerradas: 1 });
    // …pero eso no es otro evento de robo: una sola fila REFRESH_REUTILIZADO, y el intento con T2 es un rechazo normal con su motivo.
    expect((await q(`SELECT 1 FROM audit_logs WHERE accion = 'REFRESH_REUTILIZADO' AND usuario_id = $1`, [a.id])).length).toBe(1);
    const rechazos = await q(`SELECT datos_nuevos FROM audit_logs WHERE accion = 'REFRESH_RECHAZADO' AND usuario_id = $1`, [a.id]);
    expect(rechazos.map((r: any) => r.datos_nuevos.motivo)).toContain('sesion_cerrada_por_reuso');
  });

  it('otra sesión de la misma persona (otra familia) no se ve afectada', async () => {
    const { a, cookie: t1 } = await sesion();
    const otraSesion = await login(app, a.email);                                   // otro dispositivo
    await refrescar(t1);
    await envejecerRotaciones(a.id);
    expect((await refrescar(t1)).status).toBe(401);                                 // reuso en la primera familia

    expect((await fila(otraSesion.cookie!)).revoked).toBe(false);
    expect((await refrescar(otraSesion.cookie!)).status).toBe(200);                 // la otra sigue renovando
  });

  it('cada vez que se presenta el token viejo queda auditado; la segunda ya no tiene nada que cerrar', async () => {
    const { a, cookie: t1 } = await sesion();
    await refrescar(t1);
    await envejecerRotaciones(a.id);
    expect((await refrescar(t1)).status).toBe(401);
    expect((await refrescar(t1)).status).toBe(401);                     // quien insiste con la copia robada deja rastro cada vez
    const limite = Date.now() + 3000;
    let eventos: any[] = [];
    do {
      eventos = await q(`SELECT datos_nuevos FROM audit_logs WHERE accion = 'REFRESH_REUTILIZADO' AND usuario_id = $1 ORDER BY created_at`, [a.id]);
      if (eventos.length >= 2) break;
      await new Promise(res => setTimeout(res, 50));
    } while (Date.now() < limite);
    expect(eventos.map(e => e.datos_nuevos.sesiones_cerradas)).toEqual([1, 0]);
  });
});

describe('I-18 la ventana de gracia', () => {
  it('dentro de la gracia el mismo token se acepta otra vez (dos pestañas) y la sesión sigue viva', async () => {
    const { a, cookie: t1 } = await sesion();
    const primera = await refrescar(t1);
    const segunda = await refrescar(t1);                    // la otra pestaña, justo después
    expect([primera.status, segunda.status]).toEqual([200, 200]);

    const t2 = nuevaCookie(primera)!;
    const t3 = nuevaCookie(segunda)!;
    expect(t2).not.toBe(t3);
    const [f2, f3, f1] = [await fila(t2), await fila(t3), await fila(t1)];
    expect(f2.familia_id).toBe(f1.familia_id);
    expect(f3.familia_id).toBe(f1.familia_id);
    expect([f2.revoked, f3.revoked]).toEqual([false, false]);
    expect((await q(`SELECT 1 FROM audit_logs WHERE accion = 'REFRESH_REUTILIZADO' AND usuario_id = $1`, [a.id])).length).toBe(0);

    // Los dos sucesores renuevan sin problema.
    expect((await refrescar(t2)).status).toBe(200);
    expect((await refrescar(t3)).status).toBe(200);
  });

  it('dos peticiones SIMULTÁNEAS con el mismo token: las dos entran, una rota y la otra recibe su sucesor', async () => {
    const { a, cookie: t1 } = await sesion();
    const [x, y] = await Promise.all([refrescar(t1), refrescar(t1)]);
    expect([x.status, y.status]).toEqual([200, 200]);
    expect(nuevaCookie(x)).not.toBe(nuevaCookie(y));
    const familia = (await fila(t1)).familia_id;
    const vivos = await q('SELECT 1 FROM refresh_tokens WHERE familia_id = $1 AND revoked = FALSE', [familia]);
    expect(vivos.length).toBe(2);
    expect((await q(`SELECT 1 FROM audit_logs WHERE accion = 'REFRESH_REUTILIZADO' AND usuario_id = $1`, [a.id])).length).toBe(0);
  });

  it('la gracia se acota por entorno: con 0 segundos cualquier reuso ya es robo', async () => {
    const previo = process.env.REFRESH_GRACIA_SEGUNDOS;
    process.env.REFRESH_GRACIA_SEGUNDOS = '0';
    try {
      const { a, cookie: t1 } = await sesion();
      await refrescar(t1);
      await new Promise(res => setTimeout(res, 50));
      const reuso = await refrescar(t1);
      expect(reuso.status).toBe(401);
      expect(reuso.body.codigo).toBe('sesion_comprometida');
      expect((await auditoria('REFRESH_REUTILIZADO', a.id)).length).toBe(1);
    } finally {
      if (previo === undefined) delete process.env.REFRESH_GRACIA_SEGUNDOS; else process.env.REFRESH_GRACIA_SEGUNDOS = previo;
    }
  });
});

describe('I-18 lo que NO es una señal de robo', () => {
  it('un token revocado por cierre de sesión da el 401 de siempre (REFRESH_RECHAZADO), sin cerrar la familia', async () => {
    const { a, cookie } = await sesion();
    const hijo = await refrescar(cookie);
    const t2 = nuevaCookie(hijo)!;
    expect((await request(app).post('/api/auth/logout').set('Cookie', t2).send({})).status).toBe(200);
    const f = await fila(t2);
    expect(f.revoked).toBe(true);
    expect(f.revoked_at).toBeTruthy();
    expect(f.rotado_en).toBeNull();

    const r = await refrescar(t2);
    expect(r.status).toBe(401);
    expect(r.body.codigo).toBeUndefined();
    expect((await q(`SELECT 1 FROM audit_logs WHERE accion = 'REFRESH_REUTILIZADO' AND usuario_id = $1`, [a.id])).length).toBe(0);
    const rechazo = await auditoria('REFRESH_RECHAZADO', a.id);
    expect(rechazo.at(-1).datos_nuevos).toMatchObject({ motivo: 'token_revocado' });
  });

  it('un token revocado por cambio de contraseña de la persona tampoco', async () => {
    const { a, cookie } = await sesion();
    // Lo que hace updateUsuario cuando un superior cambia la contraseña: revoca las sesiones.
    await request(app).put(`/api/usuarios/${a.id}`)
      .set(bearer((await login(app, fx.email.adminEmpA)).token!))
      .send({ password: 'ClaveNueva#2027x' });
    const r = await refrescar(cookie);
    expect(r.status).toBe(401);
    expect(r.body.codigo).toBeUndefined();
    expect((await q(`SELECT 1 FROM audit_logs WHERE accion = 'REFRESH_REUTILIZADO' AND usuario_id = $1`, [a.id])).length).toBe(0);
  });
});
