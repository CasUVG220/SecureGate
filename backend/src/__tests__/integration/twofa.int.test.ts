/**
 * I-15 · Verificación en dos pasos de los administradores — SCRUM-123
 *
 * Componentes: Express (app.ts) → /api/auth (login + /2fa/*) y /api/usuarios/:id/2fa → controllers → Postgres real
 *   (`usuario_2fa`, `usuario_2fa_recuperacion`, `refresh_tokens`, `audit_logs`). Sin mocks; los códigos TOTP los genera la
 *   prueba con el secreto que entrega la propia API, igual que una app de autenticación.
 * Condición: cada caso arma su propio administrador (los sembrados no se tocan).
 * Resultado esperado:
 *   - activar: iniciar entrega secreto + URL del QR; confirmar con un código válido la activa y entrega 10 códigos de
 *     recuperación UNA vez; el secreto y los códigos NO quedan en claro en la base ni en la bitácora;
 *   - ingreso: con el segundo factor activo la contraseña sola no abre sesión (200 con desafío, sin token ni cookie); el
 *     desafío más un código TOTP o de recuperación sí; un código usado no vale dos veces; un desafío inválido no sirve;
 *   - intentos: 5 fallos en 15 min bloquean a la PERSONA (429), aunque los intentos vengan con desafíos distintos; el bloqueo
 *     se levanta solo; es compartido entre ingreso, confirmar, desactivar y regenerar; un acierto reinicia la cuenta;
 *   - desactivar pide contraseña Y código; regenerar invalida los códigos anteriores; sólo los roles de administración usan
 *     las rutas con sesión;
 *   - un superior (dentro de su alcance) restablece el segundo factor de otra persona y le cierra las sesiones;
 *   - cada evento queda en `audit_logs` con la persona y la IP, sin secretos.
 */
import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../../app';
import { q, uno, cerrarPool } from '../helpers/db';
import { sembrar, Fixtures } from '../helpers/seed';
import { login, bearer, PASSWORD } from '../helpers/auth';
import { adminNuevo, activarDosPasos, liberarPaso, totp, AdminDePrueba } from '../helpers/twofa';

let fx: Fixtures;
const sesion: Record<string, string> = {};
beforeAll(async () => {
  fx = await sembrar();
  for (const k of ['owner', 'adminEmpA', 'adminEmpB', 'agenteA1', 'resA1']) {
    const s = await login(app, fx.email[k]);
    expect(s.status).toBe(200);
    sesion[k] = s.token!;
  }
});
afterAll(cerrarPool);

// ── ayudantes ───────────────────────────────────────────────────────────────────────────────────
const adminA1 = () => adminNuevo(app, 'admin_sucursal', fx.sucursales.A1, null, fx.sufijo);
const conDosPasos = async () => { const a = await adminA1(); return { a, ...(await activarDosPasos(app, a)) }; };
const filaDe = (id: string) => uno('SELECT * FROM usuario_2fa WHERE usuario_id = $1', [id]);
const codigosDe = (id: string) => q('SELECT * FROM usuario_2fa_recuperacion WHERE usuario_id = $1', [id]);

/** Primer paso del ingreso: contraseña correcta → desafío. */
const desafioDe = async (a: AdminDePrueba): Promise<string> => {
  const s = await login(app, a.email);
  expect(s.status).toBe(200);
  expect(s.body.requiere_2fa).toBe(true);
  return s.body.desafio as string;
};
const verificar = (desafio: string, codigo: unknown) => request(app).post('/api/auth/2fa/verificar').send({ desafio, codigo });
const post = (token: string, url: string, body: object = {}) => request(app).post(url).set(bearer(token)).send(body);

/** Espera (la fila se escribe al terminar la respuesta, sin esperar) a que haya al menos `n` filas de auditoría. */
const auditoria = async (accion: string, usuarioId: string, n = 1) => {
  const limite = Date.now() + 3000;
  let r: any[] = [];
  do {
    r = await q('SELECT * FROM audit_logs WHERE accion = $1 AND usuario_id = $2 ORDER BY created_at, id', [accion, usuarioId]);
    if (r.length >= n) return r;
    await new Promise(res => setTimeout(res, 50));
  } while (Date.now() < limite);
  return r;
};

describe('I-15 activar la verificación en dos pasos', () => {
  it('sin activar, el estado lo dice y el ingreso sigue siendo sólo con contraseña', async () => {
    const a = await adminA1();
    const e = await request(app).get('/api/auth/2fa/estado').set(bearer(a.token));
    expect(e.status).toBe(200);
    expect(e.body).toEqual({ activado: false, activado_en: null, codigos_restantes: 0 });
    const s = await login(app, a.email);
    expect(s.status).toBe(200);
    expect(s.token).toBeDefined();
    expect(s.body.requiere_2fa).toBeUndefined();
  });

  it('iniciar entrega el secreto y la URL del QR; en la base queda CIFRADO y sin activar', async () => {
    const a = await adminA1();
    const r = await post(a.token, '/api/auth/2fa/iniciar');
    expect(r.status).toBe(200);
    expect(r.body.secreto).toMatch(/^[A-Z2-7]{32}$/);
    const url = new URL(r.body.otpauth_url);
    expect(url.protocol).toBe('otpauth:');
    expect(url.searchParams.get('secret')).toBe(r.body.secreto);
    expect(decodeURIComponent(url.pathname)).toContain(a.email);
    expect(r.headers['cache-control']).toBe('no-store');

    const f = await filaDe(a.id);
    expect(f.activado).toBe(false);
    expect(f.secreto_cifrado).toMatch(/^v1\./);
    expect(f.secreto_cifrado).not.toContain(r.body.secreto);
    // Aún sin confirmar no afecta el ingreso.
    expect((await login(app, a.email)).token).toBeDefined();
  });

  it('confirmar con un código errado no la activa; con el correcto sí, y entrega 10 códigos de recuperación una sola vez', async () => {
    const a = await adminA1();
    const ini = await post(a.token, '/api/auth/2fa/iniciar');

    const mal = await post(a.token, '/api/auth/2fa/confirmar', { codigo: '000000' });
    expect(mal.status).toBe(400);                                  // 400, nunca 401: el cliente tomaría el 401 por sesión vencida
    expect(mal.body.codigo).toBe('CODIGO_INCORRECTO');
    expect((await filaDe(a.id)).activado).toBe(false);

    const ok = await post(a.token, '/api/auth/2fa/confirmar', { codigo: totp(ini.body.secreto) });
    expect(ok.status).toBe(200);
    expect(ok.body.activado).toBe(true);
    expect(ok.body.codigos_recuperacion).toHaveLength(10);
    for (const c of ok.body.codigos_recuperacion) expect(c).toMatch(/^[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}$/);

    const f = await filaDe(a.id);
    expect(f.activado).toBe(true);
    expect(f.activado_en).toBeTruthy();
    const guardados = await codigosDe(a.id);
    expect(guardados).toHaveLength(10);
    for (const g of guardados) {
      expect(g.codigo_hash).toMatch(/^[0-9a-f]{64}$/);                                           // HMAC, no el código
      expect(ok.body.codigos_recuperacion.map((c: string) => c.replace('-', ''))).not.toContain(g.codigo_hash);
      expect(g.usado_en).toBeNull();
    }
    const e = await request(app).get('/api/auth/2fa/estado').set(bearer(a.token));
    expect(e.body).toMatchObject({ activado: true, codigos_restantes: 10 });
  });

  it('confirmar sin haber iniciado, o ya activa, responde 409', async () => {
    const a = await adminA1();
    const sinIniciar = await post(a.token, '/api/auth/2fa/confirmar', { codigo: '123456' });
    expect(sinIniciar.status).toBe(409);
    expect(sinIniciar.body.codigo).toBe('SIN_INICIAR');

    const { secreto } = await activarDosPasos(app, a);
    const otraVez = await post(a.token, '/api/auth/2fa/confirmar', { codigo: totp(secreto, 1) });
    expect(otraVez.status).toBe(409);
    expect(otraVez.body.codigo).toBe('YA_ACTIVA');
  });

  it('iniciar con la verificación ya activa no pisa el secreto (409); a medio configurar sí lo reemplaza', async () => {
    const { a, secreto } = await conDosPasos();
    const antes = (await filaDe(a.id)).secreto_cifrado;
    const r = await post(a.token, '/api/auth/2fa/iniciar');
    expect(r.status).toBe(409);
    expect(r.body.codigo).toBe('YA_ACTIVA');
    expect((await filaDe(a.id)).secreto_cifrado).toBe(antes);
    expect(secreto).toBeTruthy();

    const b = await adminA1();
    const primero = await post(b.token, '/api/auth/2fa/iniciar');
    const segundo = await post(b.token, '/api/auth/2fa/iniciar');
    expect(segundo.body.secreto).not.toBe(primero.body.secreto);
    const conElViejo = await post(b.token, '/api/auth/2fa/confirmar', { codigo: totp(primero.body.secreto) });
    expect(conElViejo.status).toBe(400);
    const conElNuevo = await post(b.token, '/api/auth/2fa/confirmar', { codigo: totp(segundo.body.secreto) });
    expect(conElNuevo.status).toBe(200);
  });
});

describe('I-15 ingreso con el segundo factor', () => {
  it('la contraseña sola ya no abre sesión: 200 con desafío, sin token ni cookie ni refresh token; la fila LOGIN lo explica', async () => {
    const { a } = await conDosPasos();
    const antes = (await q('SELECT 1 FROM refresh_tokens WHERE usuario_id = $1', [a.id])).length;
    const s = await login(app, a.email);
    expect(s.status).toBe(200);
    expect(s.body.requiere_2fa).toBe(true);
    expect(typeof s.body.desafio).toBe('string');
    expect(s.body.token).toBeUndefined();
    expect(s.body.usuario).toBeUndefined();
    expect(s.cookie).toBeUndefined();
    expect((await q('SELECT 1 FROM refresh_tokens WHERE usuario_id = $1', [a.id])).length).toBe(antes);

    const f = (await auditoria('LOGIN', a.id, 2)).pop();
    expect(f.status_code).toBe(200);
    expect(f.datos_nuevos).toMatchObject({ segundo_paso: 'pendiente' });
    expect(JSON.stringify(f.datos_nuevos)).not.toContain(s.body.desafio);
  });

  it('con la contraseña errada sigue siendo el mismo 401 de siempre (no se entrega desafío)', async () => {
    const { a } = await conDosPasos();
    const r = await request(app).post('/api/auth/login').send({ email: a.email, password: 'Incorrecta#1' });
    expect(r.status).toBe(401);
    expect(r.body.desafio).toBeUndefined();
  });

  it('desafío + código TOTP abre la sesión completa, y esa sesión funciona', async () => {
    const { a, secreto } = await conDosPasos();
    const d = await desafioDe(a);
    const r = await verificar(d, totp(secreto));
    expect(r.status).toBe(200);
    expect(typeof r.body.token).toBe('string');
    expect(r.body.usuario).toMatchObject({ id: a.id, email: a.email, rol: 'admin_sucursal' });
    const set = ([] as string[]).concat(r.headers['set-cookie'] ?? []).find(c => c.startsWith('refresh_token='))!;
    expect(set).toMatch(/HttpOnly/i);
    expect((await q('SELECT 1 FROM refresh_tokens WHERE usuario_id = $1 AND revoked = FALSE', [a.id])).length).toBeGreaterThan(0);

    const yo = await request(app).get('/api/auth/2fa/estado').set(bearer(r.body.token));
    expect(yo.status).toBe(200);
    expect(yo.body.activado).toBe(true);
  });

  it('acepta los códigos con espacios o guion («123 456») y los del intervalo anterior y siguiente (desfase de reloj)', async () => {
    const { a, secreto } = await conDosPasos();
    const c = totp(secreto, -1);
    expect((await verificar(await desafioDe(a), `${c.slice(0, 3)} ${c.slice(3)}`)).status).toBe(200);
    expect((await verificar(await desafioDe(a), totp(secreto, 1))).status).toBe(200);
  });

  it('un código usado no vale dos veces, pero el del intervalo siguiente sí', async () => {
    const { a, secreto } = await conDosPasos();
    const c = totp(secreto);
    expect((await verificar(await desafioDe(a), c)).status).toBe(200);
    const repetido = await verificar(await desafioDe(a), c);
    expect(repetido.status).toBe(401);
    expect(repetido.body.codigo).toBe('CODIGO_INCORRECTO');
    expect(repetido.body.token).toBeUndefined();
    expect((await verificar(await desafioDe(a), totp(secreto, 1))).status).toBe(200);
  });

  it('dos peticiones simultáneas con el MISMO código: sólo una entra', async () => {
    const { a, secreto } = await conDosPasos();
    const [d1, d2] = [await desafioDe(a), await desafioDe(a)];
    const c = totp(secreto);
    const resultados = await Promise.all([verificar(d1, c), verificar(d2, c)]);
    expect(resultados.map(r => r.status).sort()).toEqual([200, 401]);
  });

  it('un código errado o mal formado no abre sesión', async () => {
    const { a } = await conDosPasos();
    for (const malo of ['000000', '12345', 'abcdef', '', undefined, 123456, { a: 1 }, ['1', '2']]) {
      const r = await verificar(await desafioDe(a), malo);
      expect([r.status, r.body.token]).toEqual([401, undefined]);
      expect(r.headers['set-cookie']).toBeUndefined();
      await q('UPDATE usuario_2fa SET intentos_fallidos = 0, ultimo_fallo_en = NULL WHERE usuario_id = $1', [a.id]);   // para no llegar al bloqueo
    }
  });

  it('un desafío ausente, alterado, vencido o de otra clase no sirve', async () => {
    const { a, secreto } = await conDosPasos();
    const secretoJwt = process.env.JWT_SECRET as string;
    const buenos = totp(secreto);
    const sesionDeA = (await login(app, fx.email.adminEmpA)).token;     // un token de sesión, no un desafío
    const malos: unknown[] = [
      undefined, '', 'basura', await desafioDe(a) + 'x', sesionDeA,
      jwt.sign({ typ: '2fa', id: a.id }, secretoJwt, { expiresIn: -5 }),                       // vencido
      jwt.sign({ typ: '2fa', id: a.id }, 'otra-firma-'.padEnd(48, 'z'), { expiresIn: '5m' }),  // firmado por otro
      jwt.sign({ id: a.id }, secretoJwt, { expiresIn: '5m' }),                                 // sin typ
      jwt.sign({ typ: 'licencia', id: a.id }, secretoJwt, { expiresIn: '5m' }),
    ];
    for (const d of malos) {
      const r = await verificar(d as string, buenos);
      expect([r.status, r.body.codigo]).toEqual([401, 'DESAFIO_INVALIDO']);
      expect(r.body.token).toBeUndefined();
    }
  });

  it('el desafío no sirve como sesión: las rutas protegidas lo rechazan', async () => {
    const { a } = await conDosPasos();
    const r = await request(app).get('/api/auth/2fa/estado').set(bearer(await desafioDe(a)));
    expect(r.status).toBe(403);
  });

  it('si la cuenta se da de baja entre la contraseña y el código, no entra', async () => {
    const { a, secreto } = await conDosPasos();
    const d = await desafioDe(a);
    await q('UPDATE usuarios SET activo = FALSE WHERE id = $1', [a.id]);
    const r = await verificar(d, totp(secreto));
    expect([r.status, r.body.codigo]).toEqual([401, 'DESAFIO_INVALIDO']);
    expect(r.body.token).toBeUndefined();
  });

  it('si la empresa se suspende entre la contraseña y el código, responde 423', async () => {
    const emp = (await uno<{ id: string }>(`INSERT INTO empresas (nombre) VALUES ($1) RETURNING id`, [`INT 2FA Empresa ${fx.sufijo}`]))!.id;
    const suc = (await uno<{ id: string }>(`INSERT INTO sucursales (empresa_id, nombre, direccion, tipo) VALUES ($1, 'INT 2FA suc', 'dir', 'residencial') RETURNING id`, [emp]))!.id;
    const a = await adminNuevo(app, 'admin_sucursal', suc, null, fx.sufijo);
    const { secreto } = await activarDosPasos(app, a);
    const d = await desafioDe(a);
    await q(`UPDATE empresas SET suspendida = TRUE, suspension_motivo = 'prueba', suspendida_en = NOW() WHERE id = $1`, [emp]);
    const r = await verificar(d, totp(secreto));
    expect(r.status).toBe(423);
    expect(r.body.token).toBeUndefined();
  });

  it('el segundo factor sigue exigiéndose aunque la persona ya no tenga rol de administración', async () => {
    const { a, secreto } = await conDosPasos();
    await q(`UPDATE usuarios SET rol = 'agente' WHERE id = $1`, [a.id]);
    const s = await login(app, a.email);
    expect(s.body.requiere_2fa).toBe(true);
    expect(s.token).toBeUndefined();
    expect((await verificar(s.body.desafio, totp(secreto))).status).toBe(200);
  });
});

describe('I-15 códigos de recuperación', () => {
  it('uno vale para entrar UNA vez (con o sin guion, en minúsculas); gasta uno de los 10', async () => {
    const { a, codigos } = await conDosPasos();
    const r = await verificar(await desafioDe(a), codigos[0]);
    expect(r.status).toBe(200);
    expect(typeof r.body.token).toBe('string');

    const otraVez = await verificar(await desafioDe(a), codigos[0]);
    expect(otraVez.status).toBe(401);

    const sinGuion = await verificar(await desafioDe(a), codigos[1].replace('-', '').toLowerCase());
    expect(sinGuion.status).toBe(200);

    const e = await request(app).get('/api/auth/2fa/estado').set(bearer(r.body.token));
    expect(e.body.codigos_restantes).toBe(8);
    expect((await codigosDe(a.id)).filter(c => c.usado_en !== null)).toHaveLength(2);
  });

  it('el código de recuperación de otra persona no sirve', async () => {
    const x = await conDosPasos();
    const y = await conDosPasos();
    const r = await verificar(await desafioDe(y.a), x.codigos[0]);
    expect(r.status).toBe(401);
    expect((await codigosDe(x.a.id)).every(c => c.usado_en === null)).toBe(true);
  });

  it('para confirmar o regenerar sólo vale un código TOTP, no uno de recuperación', async () => {
    const { a, codigos } = await conDosPasos();
    const r = await post(a.token, '/api/auth/2fa/codigos-recuperacion', { codigo: codigos[0] });
    expect(r.status).toBe(400);
    expect((await codigosDe(a.id)).every(c => c.usado_en === null)).toBe(true);
  });

  it('regenerar pide un TOTP, entrega 10 nuevos y los anteriores dejan de valer', async () => {
    const { a, secreto, codigos } = await conDosPasos();
    const mal = await post(a.token, '/api/auth/2fa/codigos-recuperacion', { codigo: '000000' });
    expect(mal.status).toBe(400);

    const r = await post(a.token, '/api/auth/2fa/codigos-recuperacion', { codigo: totp(secreto) });
    expect(r.status).toBe(200);
    expect(r.body.codigos_recuperacion).toHaveLength(10);
    expect(r.body.codigos_recuperacion.filter((c: string) => codigos.includes(c))).toEqual([]);
    expect(await codigosDe(a.id)).toHaveLength(10);

    expect((await verificar(await desafioDe(a), codigos[0])).status).toBe(401);                 // los viejos ya no
    expect((await verificar(await desafioDe(a), r.body.codigos_recuperacion[0])).status).toBe(200); // los nuevos sí
  });

  it('regenerar sin la verificación activa responde 409', async () => {
    const a = await adminA1();
    const r = await post(a.token, '/api/auth/2fa/codigos-recuperacion', { codigo: '123456' });
    expect([r.status, r.body.codigo]).toEqual([409, 'NO_ACTIVA']);
  });
});

describe('I-15 límite de intentos por persona', () => {
  it('5 fallos seguidos bloquean a la persona (429 con espera) aunque cada intento use un desafío distinto; el acierto tampoco entra', async () => {
    const { a, secreto } = await conDosPasos();
    const estados: number[] = [];
    let ultimo: request.Response | undefined;
    for (let i = 0; i < 5; i++) {
      ultimo = await verificar(await desafioDe(a), '000000');
      estados.push(ultimo.status);
    }
    expect(estados).toEqual([401, 401, 401, 401, 429]);
    expect(ultimo!.body.codigo).toBe('BLOQUEADO');
    expect(Number(ultimo!.headers['retry-after'])).toBeGreaterThan(0);
    expect(ultimo!.body.espera_s).toBe(15 * 60);

    const f = await filaDe(a.id);
    expect(new Date(f.bloqueado_hasta).getTime()).toBeGreaterThan(Date.now());

    const conElBueno = await verificar(await desafioDe(a), totp(secreto));
    expect(conElBueno.status).toBe(429);
    expect(conElBueno.body.token).toBeUndefined();
    expect(conElBueno.headers['set-cookie']).toBeUndefined();

    // Cada intento quedó en la bitácora con la persona; el bloqueo lleva su motivo.
    const filas = await auditoria('TWOFA_VERIFICACION', a.id, 6);
    expect(filas.map(x => x.status_code)).toEqual([401, 401, 401, 401, 429, 429]);
    expect(filas[4].datos_nuevos).toMatchObject({ motivo: 'bloqueado' });
    expect(filas[0].datos_nuevos).toMatchObject({ motivo: 'codigo_incorrecto' });
    for (const x of filas) expect(x.ip_address).toBeTruthy();
  });

  it('el bloqueo se levanta solo al vencer, y entonces el código correcto entra y reinicia la cuenta', async () => {
    const { a, secreto } = await conDosPasos();
    for (let i = 0; i < 5; i++) await verificar(await desafioDe(a), '000000');
    expect((await verificar(await desafioDe(a), totp(secreto))).status).toBe(429);

    await q(`UPDATE usuario_2fa SET bloqueado_hasta = NOW() - interval '1 second' WHERE usuario_id = $1`, [a.id]);
    expect((await verificar(await desafioDe(a), totp(secreto))).status).toBe(200);
    const f = await filaDe(a.id);
    expect([f.intentos_fallidos, f.bloqueado_hasta, f.ultimo_fallo_en]).toEqual([0, null, null]);
  });

  it('un acierto reinicia la cuenta: 4 fallos + acierto + 4 fallos no bloquean', async () => {
    const { a, secreto } = await conDosPasos();
    for (let i = 0; i < 4; i++) expect((await verificar(await desafioDe(a), '000000')).status).toBe(401);
    expect((await verificar(await desafioDe(a), totp(secreto))).status).toBe(200);
    for (let i = 0; i < 4; i++) expect((await verificar(await desafioDe(a), '000000')).status).toBe(401);
    expect((await filaDe(a.id)).bloqueado_hasta).toBeNull();
  });

  it('los fallos de hace más de 15 minutos ya no cuentan', async () => {
    const { a } = await conDosPasos();
    for (let i = 0; i < 4; i++) await verificar(await desafioDe(a), '000000');
    await q(`UPDATE usuario_2fa SET ultimo_fallo_en = NOW() - interval '16 minutes' WHERE usuario_id = $1`, [a.id]);
    expect((await verificar(await desafioDe(a), '000000')).status).toBe(401);       // cuenta como el primero, no como el quinto
    expect((await filaDe(a.id)).intentos_fallidos).toBe(1);
  });

  it('el bloqueo es de la persona: otra con la verificación activa sigue entrando', async () => {
    const x = await conDosPasos();
    const y = await conDosPasos();
    for (let i = 0; i < 5; i++) await verificar(await desafioDe(x.a), '000000');
    expect((await verificar(await desafioDe(x.a), totp(x.secreto))).status).toBe(429);
    expect((await verificar(await desafioDe(y.a), totp(y.secreto))).status).toBe(200);
  });

  it('el cupo se comparte con confirmar, desactivar y regenerar: 3 fallos aquí + 2 allá bloquean', async () => {
    const { a, secreto } = await conDosPasos();
    for (let i = 0; i < 3; i++) expect((await post(a.token, '/api/auth/2fa/desactivar', { password: PASSWORD, codigo: '000000' })).status).toBe(400);
    expect((await verificar(await desafioDe(a), '000000')).status).toBe(401);
    const quinto = await post(a.token, '/api/auth/2fa/codigos-recuperacion', { codigo: '000000' });
    expect(quinto.status).toBe(429);
    expect(quinto.body.codigo).toBe('BLOQUEADO');

    // Bloqueada: ni el código correcto sirve en ninguna ruta.
    expect((await post(a.token, '/api/auth/2fa/codigos-recuperacion', { codigo: totp(secreto) })).status).toBe(429);
    expect((await post(a.token, '/api/auth/2fa/desactivar', { password: PASSWORD, codigo: totp(secreto) })).status).toBe(429);
    expect((await filaDe(a.id)).activado).toBe(true);
  });

  it('confirmar también cuenta los fallos: 5 códigos errados al activar bloquean', async () => {
    const a = await adminA1();
    await post(a.token, '/api/auth/2fa/iniciar');
    const estados: number[] = [];
    for (let i = 0; i < 5; i++) estados.push((await post(a.token, '/api/auth/2fa/confirmar', { codigo: '000000' })).status);
    expect(estados).toEqual([400, 400, 400, 400, 429]);
  });
});

describe('I-15 desactivar', () => {
  it('pide la contraseña Y un código; una contraseña errada no gasta intentos del segundo factor', async () => {
    const { a, secreto } = await conDosPasos();
    const sinClave = await post(a.token, '/api/auth/2fa/desactivar', { codigo: totp(secreto) });
    expect(sinClave.status).toBe(400);

    const claveMala = await post(a.token, '/api/auth/2fa/desactivar', { password: 'Incorrecta#1', codigo: totp(secreto) });
    expect([claveMala.status, claveMala.body.codigo]).toEqual([400, 'PASSWORD_INCORRECTA']);
    expect((await filaDe(a.id)).intentos_fallidos).toBe(0);

    const codigoMalo = await post(a.token, '/api/auth/2fa/desactivar', { password: PASSWORD, codigo: '000000' });
    expect([codigoMalo.status, codigoMalo.body.codigo]).toEqual([400, 'CODIGO_INCORRECTO']);
    expect((await filaDe(a.id)).activado).toBe(true);

    const ok = await post(a.token, '/api/auth/2fa/desactivar', { password: PASSWORD, codigo: totp(secreto) });
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ activado: false });
    expect(await filaDe(a.id)).toBeUndefined();
    expect(await codigosDe(a.id)).toHaveLength(0);

    const s = await login(app, a.email);                       // vuelve a entrar sólo con contraseña
    expect(s.token).toBeDefined();
    expect(s.body.requiere_2fa).toBeUndefined();
  });

  it('también se puede con un código de recuperación (perdió el teléfono pero guardó los códigos)', async () => {
    const { a, codigos } = await conDosPasos();
    const r = await post(a.token, '/api/auth/2fa/desactivar', { password: PASSWORD, codigo: codigos[3] });
    expect(r.status).toBe(200);
    expect(await filaDe(a.id)).toBeUndefined();
  });

  it('sin la verificación activa responde 409', async () => {
    const a = await adminA1();
    const r = await post(a.token, '/api/auth/2fa/desactivar', { password: PASSWORD, codigo: '123456' });
    expect([r.status, r.body.codigo]).toEqual([409, 'NO_ACTIVA']);
  });

  it('después de desactivar se puede activar de nuevo con un secreto nuevo', async () => {
    const { a, secreto } = await conDosPasos();
    await post(a.token, '/api/auth/2fa/desactivar', { password: PASSWORD, codigo: totp(secreto) });
    const otra = await activarDosPasos(app, a);
    expect(otra.secreto).not.toBe(secreto);
    expect((await login(app, a.email)).body.requiere_2fa).toBe(true);
  });
});

describe('I-15 quién puede usarla', () => {
  it('el personal de garita y los residentes reciben 403 en todas las rutas con sesión; sin sesión, 401', async () => {
    const rutas: Array<[string, string]> = [
      ['get', '/api/auth/2fa/estado'], ['post', '/api/auth/2fa/iniciar'], ['post', '/api/auth/2fa/confirmar'],
      ['post', '/api/auth/2fa/desactivar'], ['post', '/api/auth/2fa/codigos-recuperacion'],
    ];
    for (const quien of ['agenteA1', 'resA1']) {
      for (const [metodo, url] of rutas) {
        const r = await (request(app) as any)[metodo](url).set(bearer(sesion[quien]));
        expect([quien, url, r.status]).toEqual([quien, url, 403]);
      }
    }
    for (const [metodo, url] of rutas) {
      const r = await (request(app) as any)[metodo](url);
      expect([url, r.status]).toEqual([url, 401]);
    }
    expect(await uno(`SELECT 1 FROM usuario_2fa WHERE usuario_id = ANY($1::uuid[])`, [[fx.usuarios.agenteA1, fx.usuarios.resA1]])).toBeUndefined();
  });

  it('el owner y los administradores de empresa también pueden activarla', async () => {
    for (const quien of ['owner', 'adminEmpB']) {
      const ini = await post(sesion[quien], '/api/auth/2fa/iniciar');
      expect([quien, ini.status]).toEqual([quien, 200]);
      expect((await post(sesion[quien], '/api/auth/2fa/confirmar', { codigo: totp(ini.body.secreto) })).status).toBe(200);
    }
  });
});

describe('I-15 restablecer la verificación de otra persona', () => {
  it('el administrador de la empresa se la restablece a quien perdió todo: se borra, se cierran sus sesiones y entra sólo con contraseña', async () => {
    const { a, secreto } = await conDosPasos();
    const sesionAbierta = await verificar(await desafioDe(a), totp(secreto));
    expect(sesionAbierta.status).toBe(200);
    const cookie = ([] as string[]).concat(sesionAbierta.headers['set-cookie']).find(c => c.startsWith('refresh_token='))!.split(';')[0];

    const r = await request(app).delete(`/api/usuarios/${a.id}/2fa`).set(bearer(sesion.adminEmpA));
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ restablecido: true });
    expect(await filaDe(a.id)).toBeUndefined();
    expect(await codigosDe(a.id)).toHaveLength(0);

    expect((await request(app).post('/api/auth/refresh').set('Cookie', cookie)).status).toBe(401);   // su sesión se cerró
    const s = await login(app, a.email);
    expect(s.token).toBeDefined();

    const fila = (await auditoria('TWOFA_RESTABLECIDO', fx.usuarios.adminEmpA)).pop();
    expect(fila.status_code).toBe(200);
    expect(fila.registro_id).toBe(a.id);
    expect(fila.ip_address).toBeTruthy();
  });

  it('el owner se la restablece a un administrador de empresa (uno propio de la prueba: restablecer le corta la sesión)', async () => {
    const admin = await adminNuevo(app, 'admin_empresa', null, fx.empresas.A, fx.sufijo);
    await activarDosPasos(app, admin);
    const r = await request(app).delete(`/api/usuarios/${admin.id}/2fa`).set(bearer(sesion.owner));
    expect(r.status).toBe(200);
    expect(await filaDe(admin.id)).toBeUndefined();
    // Su sesión abierta quedó revocada: lo que traía en la mano ya no abre nada.
    expect((await request(app).get('/api/auth/2fa/estado').set(bearer(admin.token))).status).toBe(401);
  });

  it('fuera de su alcance es 404 y nada cambia; sin verificación activa es 409; a sí mismo, 400; el owner no se restablece por la API', async () => {
    const { a } = await conDosPasos();
    const deOtraEmpresa = await request(app).delete(`/api/usuarios/${a.id}/2fa`).set(bearer(sesion.adminEmpB));
    expect(deOtraEmpresa.status).toBe(404);
    expect(await filaDe(a.id)).toBeDefined();

    const sinActivar = await adminA1();
    expect((await request(app).delete(`/api/usuarios/${sinActivar.id}/2fa`).set(bearer(sesion.adminEmpA))).status).toBe(409);

    expect((await request(app).delete(`/api/usuarios/${fx.usuarios.adminEmpA}/2fa`).set(bearer(sesion.adminEmpA))).status).toBe(400);

    const aOwner = await request(app).delete(`/api/usuarios/${fx.usuarios.owner}/2fa`).set(bearer(sesion.adminEmpA));
    expect(aOwner.status).toBe(404);
    expect((await request(app).delete(`/api/usuarios/${fx.usuarios.owner}/2fa`).set(bearer(sesion.owner))).status).toBe(400);
    expect((await request(app).delete(`/api/usuarios/no-es-un-uuid/2fa`).set(bearer(sesion.adminEmpA))).status).toBe(400);
  });

  it('el personal de garita no puede restablecer a nadie (403)', async () => {
    const { a } = await conDosPasos();
    const r = await request(app).delete(`/api/usuarios/${a.id}/2fa`).set(bearer(sesion.agenteA1));
    expect(r.status).toBe(403);
    expect(await filaDe(a.id)).toBeDefined();
  });

  it('la lista de usuarios dice quién la tiene activada', async () => {
    const { a } = await conDosPasos();
    const sin = await adminA1();
    const lista = await request(app).get('/api/usuarios').set(bearer(sesion.adminEmpA));
    expect(lista.status).toBe(200);
    const por = Object.fromEntries(lista.body.map((u: any) => [u.id, u.dos_pasos]));
    expect(por[a.id]).toBe(true);
    expect(por[sin.id]).toBe(false);
  });
});

describe('I-15 lo que NO debe quedar en ningún lado', () => {
  it('ni el secreto ni los códigos (TOTP o de recuperación) aparecen en audit_logs, y el secreto no está en claro en la base', async () => {
    const a = await adminA1();
    const ini = await post(a.token, '/api/auth/2fa/iniciar');
    const codigoTotp = totp(ini.body.secreto);
    const conf = await post(a.token, '/api/auth/2fa/confirmar', { codigo: codigoTotp });
    await liberarPaso(a.id);
    const d = await desafioDe(a);
    await verificar(d, conf.body.codigos_recuperacion[0]);
    await verificar(d, '000000');
    await post(a.token, '/api/auth/2fa/desactivar', { password: PASSWORD, codigo: totp(ini.body.secreto, 1) });

    await auditoria('TWOFA_DESACTIVADO', a.id);
    const filas = await q('SELECT * FROM audit_logs WHERE usuario_id = $1', [a.id]);
    const todo = JSON.stringify(filas);
    for (const secreto of [ini.body.secreto, PASSWORD, d, ...conf.body.codigos_recuperacion, ...conf.body.codigos_recuperacion.map((c: string) => c.replace('-', ''))]) {
      expect(todo).not.toContain(secreto);
    }
    // Seis dígitos pueden coincidir por azar con una fecha o un id: el código TOTP se busca sólo en el detalle de los eventos de dos pasos.
    const detalles = JSON.stringify(filas.filter(f => f.accion.startsWith('TWOFA_')).map(f => f.datos_nuevos));
    expect(detalles).not.toContain(codigoTotp);
    for (const accion of ['TWOFA_INICIADO', 'TWOFA_ACTIVADO', 'TWOFA_VERIFICACION', 'TWOFA_DESACTIVADO']) {
      expect(todo).toContain(accion);
    }
    // La vía por la que entró sí queda.
    const entrada = (await auditoria('TWOFA_VERIFICACION', a.id, 2)).find(f => f.status_code === 200);
    expect(entrada.datos_nuevos).toMatchObject({ via: 'recuperacion' });
  });

  it('cada evento queda con la persona, la IP y el código HTTP real', async () => {
    const a = await adminA1();
    const ini = await post(a.token, '/api/auth/2fa/iniciar');
    await post(a.token, '/api/auth/2fa/confirmar', { codigo: '000000' });                // 400
    await post(a.token, '/api/auth/2fa/confirmar', { codigo: totp(ini.body.secreto) });  // 200
    const esperado: Array<[string, number[]]> = [['TWOFA_INICIADO', [200]], ['TWOFA_ACTIVADO', [400, 200]]];
    for (const [accion, estados] of esperado) {
      const filas = await auditoria(accion, a.id, estados.length);
      expect(filas.map(f => f.status_code)).toEqual(estados);
      for (const f of filas) { expect(f.ip_address).toBeTruthy(); expect(f.sucursal_id).toBe(fx.sucursales.A1); }
    }
  });
});
