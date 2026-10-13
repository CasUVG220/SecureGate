/**
 * I-26 · Alta autoservicio de una empresa (asistente de onboarding) — T12, Sprint 9 continuación
 *
 * Componentes: Express (app.ts) → /api/onboarding, /api/invitaciones/:token/aceptar, /api/licencias → onboarding.controller + services/onboarding →
 *   Postgres real. El correo se captura con un transporte de prueba; no hay mocks de base.
 * Resultado esperado:
 *   - el formulario público responde IGUAL exista o no una cuenta con el correo, el campo trampa no crea nada y hay un tope por correo;
 *   - el enlace del correo es el único acceso al asistente (token inexistente o mal formado: 404 uniforme; vencido: 410);
 *   - el borrador se valida estrictamente y se puede retomar; completar crea empresa + sucursal + suscripción en prueba + invitación EN UNA transacción;
 *   - la cuenta de administrador nace solo al aceptar la invitación (flujo en cascada ya existente) y desde ahí el progreso se deriva de los datos;
 *   - un enlace de una solicitud no sirve para tocar otra.
 */
import request from 'supertest';
import { randomBytes, createHash } from 'crypto';
import app from '../../app';
import { q, uno, cerrarPool } from '../helpers/db';
import { sembrar, Fixtures } from '../helpers/seed';
import { login, bearer } from '../helpers/auth';
import { _usarTransporte, type Mensaje } from '../../services/email';

let fx: Fixtures;
let owner: string;
const correos: Mensaje[] = [];
const uid = () => randomBytes(4).toString('hex');
const nuevoCorreo = () => `onb.${uid()}@inttest.local`;

beforeAll(async () => {
  fx = await sembrar();
  owner = (await login(app, fx.email.owner)).token!;
  _usarTransporte({ nombre: 'captura', enviar: async m => { correos.push(m); } });
});
afterAll(async () => { _usarTransporte(null); await cerrarPool(); });

const solicitar = (b: object) => request(app).post('/api/onboarding/solicitar').send(b);
/** Pide el alta y devuelve el token tomado del enlace del correo (lo único que lo trae: en la base solo vive el hash). */
const pedirAlta = async (email = nuevoCorreo(), empresa = `ONB Empresa ${uid()}`) => {
  const antes = correos.length;
  const r = await solicitar({ email, empresa_nombre: empresa, acepta_terminos: true });
  expect(r.status).toBe(202);
  const m = correos.slice(antes).find(c => c.to === email);
  const token = m?.text.match(/\/onboarding\/([A-Za-z0-9_-]{20,})/)?.[1];
  return { email, empresa, token: token!, correo: m };
};
const borrador = (extra: object = {}) => ({ sucursal_nombre: `ONB Sede ${uid()}`, direccion: 'Zona 10', tipo: 'condominio', plan_codigo: 'basico', ...extra });
const guardar = (token: string, b: object) => request(app).put(`/api/onboarding/${token}/borrador`).send(b);
const completar = (token: string) => request(app).post(`/api/onboarding/${token}/completar`).send({});

describe('I-26 formulario público', () => {
  it('manda el enlace por correo y guarda solo el hash del token', async () => {
    const { email, empresa, token, correo } = await pedirAlta();
    expect(token).toBeTruthy();
    expect(correo!.subject).toMatch(/alta de tu empresa/i);
    expect(correo!.text).toContain(empresa);
    const fila = await uno(`SELECT token_hash, estado, email FROM onboarding_solicitudes WHERE email = $1`, [email]);
    expect(fila).toMatchObject({ estado: 'abierta', email });
    expect(fila!.token_hash).toBe(createHash('sha256').update(token).digest('hex'));
    expect(JSON.stringify(fila)).not.toContain(token);
    // Hasta seguir el enlace no existe nada de la empresa.
    expect(await q(`SELECT 1 FROM empresas WHERE nombre = $1`, [empresa])).toHaveLength(0);
  });

  it('responde igual exista o no una cuenta con ese correo y a la cuenta existente le avisa por correo', async () => {
    const nueva = await solicitar({ email: nuevoCorreo(), empresa_nombre: 'Misma Empresa', acepta_terminos: true });
    const antes = correos.length;
    const existente = await solicitar({ email: fx.email.adminEmpA, empresa_nombre: 'Misma Empresa', acepta_terminos: true });
    expect(existente.status).toBe(nueva.status);
    expect(existente.body).toEqual(nueva.body);
    const aviso = correos.slice(antes).find(c => c.to === fx.email.adminEmpA);
    expect(aviso?.subject).toMatch(/Ya tienes una cuenta/);
    expect(aviso?.text).not.toMatch(/\/onboarding\//);                                   // nunca se manda un enlace a una cuenta existente
    expect(await q(`SELECT 1 FROM onboarding_solicitudes WHERE email = $1 AND estado = 'abierta'`, [fx.email.adminEmpA])).toHaveLength(0);
  });

  it('valida: correo, nombre, términos', async () => {
    const ok = { email: nuevoCorreo(), empresa_nombre: 'Empresa Válida', acepta_terminos: true };
    for (const malo of [{ email: 'x' }, { email: 'a@b.com\r\nBcc: v@x.com' }, { empresa_nombre: '<script>x</script>' }, { empresa_nombre: 'a' }, { acepta_terminos: false }, { acepta_terminos: undefined }, { email: ['a@b.com'] }]) {
      const r = await solicitar({ ...ok, ...malo });
      expect([r.status, JSON.stringify(malo)]).toEqual([400, JSON.stringify(malo)]);
    }
    expect((await request(app).post('/api/onboarding/solicitar').send('no es json').set('Content-Type', 'text/plain')).status).toBe(400);
  });

  it('el campo trampa (sitio_web) parece éxito pero no crea ni manda nada', async () => {
    const email = nuevoCorreo(); const antes = correos.length;
    const r = await solicitar({ email, empresa_nombre: 'Robot SA', acepta_terminos: true, sitio_web: 'http://spam.example' });
    expect(r.status).toBe(202);
    expect(await q(`SELECT 1 FROM onboarding_solicitudes WHERE email = $1`, [email])).toHaveLength(0);
    expect(correos.slice(antes).filter(c => c.to === email)).toHaveLength(0);
  });

  it('tope por correo: a la 4.ª solicitud en 24 h responde 429', async () => {
    const email = nuevoCorreo();
    for (let i = 0; i < 3; i++) expect((await solicitar({ email, empresa_nombre: 'Insistente', acepta_terminos: true })).status).toBe(202);
    const r = await solicitar({ email, empresa_nombre: 'Insistente', acepta_terminos: true });
    expect(r.status).toBe(429);
    expect(await q(`SELECT 1 FROM onboarding_solicitudes WHERE email = $1`, [email])).toHaveLength(3);
  });
});

describe('I-26 el enlace y el borrador', () => {
  it('un token inexistente, mal formado o de otra clase responde 404 uniforme', async () => {
    for (const t of [randomBytes(32).toString('base64url'), 'corto', 'a'.repeat(200), '%00%00%00%00%00%00%00%00%00%00%00', "' OR 1=1 --xxxxxxxxxxxxxxxxxxxx"]) {
      const r = await request(app).get(`/api/onboarding/${encodeURIComponent(t)}`);
      expect([r.status, t]).toEqual([404, t]);
      expect(r.body).toEqual({ error: 'Enlace no válido' });
    }
    expect((await request(app).put(`/api/onboarding/${randomBytes(32).toString('base64url')}/borrador`).send({ plan_codigo: 'basico' })).status).toBe(404);
    expect((await completar(randomBytes(32).toString('base64url'))).status).toBe(404);
    expect((await request(app).post(`/api/onboarding/${randomBytes(32).toString('base64url')}/reenviar`).send({})).status).toBe(404);
  });

  it('el estado trae el borrador y los planes disponibles (con la marca de supuesto), sin datos de otras empresas', async () => {
    const { token, empresa, email } = await pedirAlta();
    const r = await request(app).get(`/api/onboarding/${token}`);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ estado: 'abierta', email, borrador: { empresa_nombre: empresa }, invitacion: null });
    const basico = r.body.planes.find((p: any) => p.codigo === 'basico');
    expect(basico).toMatchObject({ supuesto: true, moneda: 'GTQ' });
    expect(typeof basico.precio_mensual_centavos).toBe('number');
    expect(JSON.stringify(r.body)).not.toMatch(/token_hash|ip_origen|empresa_id/);
  });

  it('guarda el borrador por partes y se puede retomar con el mismo enlace', async () => {
    const { token } = await pedirAlta();
    expect((await guardar(token, { sucursal_nombre: 'Torre Norte', tipo: 'edificio' })).status).toBe(200);
    expect((await guardar(token, { plan_codigo: 'estandar', nit: '1234567-k' })).body.borrador).toMatchObject({ sucursal_nombre: 'Torre Norte', tipo: 'edificio', plan_codigo: 'estandar', nit: '1234567-K' });
    const otra = await request(app).get(`/api/onboarding/${token}`);                       // "otro equipo"
    expect(otra.body.borrador).toMatchObject({ sucursal_nombre: 'Torre Norte', plan_codigo: 'estandar' });
  });

  it('valida el borrador de forma estricta', async () => {
    const { token } = await pedirAlta();
    for (const malo of [{}, { empresa_id: fx.empresas.A }, { rol: 'owner' }, { nit: 'ABC' }, { tipo: 'castillo' }, { sucursal_nombre: '<img src=x onerror=1>' }, { plan_codigo: '../etc' }, { sucursal_nombre: 5 }]) {
      const r = await guardar(token, malo);
      expect([r.status, JSON.stringify(malo)]).toEqual([400, JSON.stringify(malo)]);
    }
    expect((await guardar(token, { plan_codigo: 'no-existe' })).status).toBe(422);
    const planes = await q(`SELECT 1 FROM planes WHERE codigo = 'no-existe'`);
    expect(planes).toHaveLength(0);
  });

  it('un enlace vencido responde 410 en todo', async () => {
    const { token } = await pedirAlta();
    await q(`UPDATE onboarding_solicitudes SET expira_en = NOW() - interval '1 minute' WHERE token_hash = $1`, [createHash('sha256').update(token).digest('hex')]);
    expect((await request(app).get(`/api/onboarding/${token}`)).status).toBe(410);
    expect((await guardar(token, borrador())).status).toBe(410);
    expect((await completar(token)).status).toBe(410);
  });
});

describe('I-26 completar', () => {
  it('con el borrador incompleto no crea nada', async () => {
    const { token, empresa } = await pedirAlta();
    await guardar(token, { sucursal_nombre: 'Sin plan' });
    const r = await completar(token);
    expect(r.status).toBe(422);
    expect(r.body.codigo).toBe('BORRADOR_INCOMPLETO');
    expect(await q(`SELECT 1 FROM empresas WHERE nombre = $1`, [empresa])).toHaveLength(0);
  });

  it('crea empresa, primera sucursal, suscripción en prueba e invitación de administrador, y manda el correo', async () => {
    const { token, email, empresa } = await pedirAlta();
    await guardar(token, borrador({ sucursal_nombre: 'Sede Central', nit: '7654321-0', plan_codigo: 'estandar' }));
    const antes = correos.length;
    const r = await completar(token);
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ ok: true, estado: 'invitada', email });

    const e = await uno(`SELECT id, nit FROM empresas WHERE nombre = $1`, [empresa]);
    expect(e).toMatchObject({ nit: '7654321-0' });
    expect(await q(`SELECT nombre FROM sucursales WHERE empresa_id = $1`, [e!.id])).toEqual([{ nombre: 'Sede Central' }]);
    const susc = await uno(`SELECT s.estado, p.codigo, s.prueba_hasta FROM suscripciones s JOIN planes p ON p.id = s.plan_id WHERE s.empresa_id = $1`, [e!.id]);
    expect(susc).toMatchObject({ estado: 'prueba', codigo: 'estandar' });
    expect(new Date(susc!.prueba_hasta).getTime()).toBeGreaterThan(Date.now() + 13 * 86_400_000);
    const hist = await q(`SELECT motivo, cambiado_por FROM suscripcion_historial WHERE empresa_id = $1`, [e!.id]);
    expect(hist).toEqual([{ motivo: 'Alta por autoservicio', cambiado_por: null }]);
    const inv = await uno(`SELECT rol_invitado, empresa_id, invitado_por, estado FROM invitaciones WHERE email = $1`, [email]);
    expect(inv).toMatchObject({ rol_invitado: 'admin_empresa', empresa_id: e!.id, invitado_por: null, estado: 'pendiente' });

    const correo = correos.slice(antes).find(c => c.to === email);
    expect(correo?.subject).toMatch(/Invitación a SecureGate/);
    expect(correo?.text).toMatch(/Pediste crear/);
    expect(correo?.text).toMatch(/\/invitacion\/[A-Za-z0-9_-]{20,}/);
    expect(await q(`SELECT 1 FROM usuarios WHERE email = $1`, [email])).toHaveLength(0);   // la cuenta nace SOLO al aceptar
    expect((await request(app).get(`/api/onboarding/${token}`)).body).toMatchObject({ estado: 'invitada', planes: [], invitacion: { estado: 'pendiente', puede_reenviar: true } });
  });

  it('completar dos veces no duplica nada (409)', async () => {
    const { token, empresa } = await pedirAlta();
    await guardar(token, borrador());
    expect((await completar(token)).status).toBe(201);
    const otra = await completar(token);
    expect(otra.status).toBe(409);
    expect(otra.body.codigo).toBe('YA_COMPLETADA');
    expect(await q(`SELECT 1 FROM empresas WHERE nombre = $1`, [empresa])).toHaveLength(1);
    expect((await guardar(token, { sucursal_nombre: 'Tarde' })).status).toBe(409);
  });

  it('es atómico: si el plan deja de estar disponible no queda empresa ni sucursal a medias', async () => {
    const { token, empresa } = await pedirAlta();
    const plan = (await request(app).post('/api/planes').set(bearer(owner)).send({
      codigo: `onb-${uid()}`, nombre: 'Temporal', precio_mensual_centavos: 100, visitas_incluidas: 1, precio_visita_extra_centavos: 1,
    })).body;
    await guardar(token, borrador({ plan_codigo: plan.codigo }));
    await request(app).put(`/api/planes/${plan.id}`).set(bearer(owner)).send({ activo: false });
    const r = await completar(token);
    expect(r.status).toBe(422);
    expect(r.body.codigo).toBe('PLAN_NO_DISPONIBLE');
    expect(await q(`SELECT 1 FROM empresas WHERE nombre = $1`, [empresa])).toHaveLength(0);
    expect(await q(`SELECT 1 FROM sucursales WHERE nombre LIKE 'ONB Sede%' AND empresa_id IN (SELECT id FROM empresas WHERE nombre = $1)`, [empresa])).toHaveLength(0);
    expect((await uno(`SELECT estado FROM onboarding_solicitudes WHERE email = (SELECT email FROM onboarding_solicitudes WHERE empresa_nombre = $1)`, [empresa]))!.estado).toBe('abierta');
  });

  it('si mientras tanto el correo ya tiene cuenta, no se crea nada', async () => {
    const { token, email, empresa } = await pedirAlta();
    await guardar(token, borrador());
    await q(`INSERT INTO usuarios (nombre, email, password_hash, rol, activo) VALUES ('Ganó de mano', $1, 'x', 'residente', FALSE)`, [email]);
    expect((await completar(token)).status).toBe(409);
    expect(await q(`SELECT 1 FROM empresas WHERE nombre = $1`, [empresa])).toHaveLength(0);
  });
});

describe('I-26 reenvío y aceptación (flujo en cascada) y progreso', () => {
  const alta = async () => {
    const a = await pedirAlta();
    await guardar(a.token, borrador());
    const antes = correos.length;
    expect((await completar(a.token)).status).toBe(201);
    const enlace = correos.slice(antes).find(c => c.to === a.email)!.text.match(/\/invitacion\/([A-Za-z0-9_-]{20,})/)![1];
    return { ...a, enlace };
  };

  it('el administrador acepta la invitación, entra con su cuenta y el progreso se deriva de los datos', async () => {
    const a = await alta();
    const aceptar = await request(app).post(`/api/invitaciones/${a.enlace}/aceptar`).send({ nombre: 'Ana Admin', password: 'Clave#Segura2026' });
    expect(aceptar.status).toBeLessThan(300);
    const u = await uno(`SELECT id, rol, empresa_id FROM usuarios WHERE email = $1`, [a.email]);
    expect(u).toMatchObject({ rol: 'admin_empresa' });
    expect((await uno(`SELECT nombre FROM empresas WHERE id = $1`, [u!.empresa_id]))!.nombre).toBe(a.empresa);

    const sesion = await login(app, a.email, 'Clave#Segura2026');
    expect(sesion.status).toBe(200);
    const p = await request(app).get('/api/onboarding/progreso').set(bearer(sesion.token));
    expect(p.status).toBe(200);
    expect(p.body.pasos).toEqual([
      { id: 'empresa', hecho: true }, { id: 'sucursal', hecho: true }, { id: 'plan', hecho: true }, { id: 'admin', hecho: true }, { id: 'garita', hecho: false },
    ]);
    expect(p.body.completo).toBe(false);
    expect(p.body.primera_sucursal_id).toBeTruthy();

    // Último paso: la primera garita, con la ruta normal (y bajo el límite del plan).
    const lic = await request(app).post('/api/licencias').set(bearer(sesion.token)).send({ sucursal_id: p.body.primera_sucursal_id, etiqueta: 'Garita principal' });
    expect(lic.status).toBe(201);
    const fin = await request(app).get('/api/onboarding/progreso').set(bearer(sesion.token));
    expect(fin.body.completo).toBe(true);
    expect((await request(app).get(`/api/onboarding/${a.token}`)).body.invitacion).toMatchObject({ estado: 'aceptada', puede_reenviar: false });
  });

  it('reenviar genera un enlace nuevo, el anterior deja de servir y hay un tope de 3', async () => {
    const a = await alta();
    const reenviar = () => request(app).post(`/api/onboarding/${a.token}/reenviar`).send({});
    const antes = correos.length;
    expect((await reenviar()).status).toBe(200);
    const nuevo = correos.slice(antes).find(c => c.to === a.email)!.text.match(/\/invitacion\/([A-Za-z0-9_-]{20,})/)![1];
    expect(nuevo).not.toBe(a.enlace);
    expect((await request(app).get(`/api/invitaciones/${a.enlace}`)).status).toBe(404);   // el viejo ya no existe
    expect((await request(app).get(`/api/invitaciones/${nuevo}`)).status).toBe(200);
    expect((await reenviar()).status).toBe(200);
    expect((await reenviar()).status).toBe(200);
    expect((await reenviar()).status).toBe(429);
    expect((await request(app).get(`/api/onboarding/${a.token}`)).body.invitacion.puede_reenviar).toBe(false);
  });

  it('no se puede reenviar antes de completar ni después de aceptada', async () => {
    const antes = await pedirAlta();
    expect((await request(app).post(`/api/onboarding/${antes.token}/reenviar`).send({})).status).toBe(409);
    const a = await alta();
    await request(app).post(`/api/invitaciones/${a.enlace}/aceptar`).send({ nombre: 'Ana Admin', password: 'Clave#Segura2026' });
    expect((await request(app).post(`/api/onboarding/${a.token}/reenviar`).send({})).status).toBe(409);
  });

  it('el progreso es solo del admin de su empresa: sin sesión 401, residente 403, y siempre trae SU empresa', async () => {
    expect((await request(app).get('/api/onboarding/progreso')).status).toBe(401);
    const res = await login(app, fx.email.resA1);
    expect((await request(app).get('/api/onboarding/progreso').set(bearer(res.token))).status).toBe(403);
    const adminA = await login(app, fx.email.adminEmpA);
    const pA = await request(app).get('/api/onboarding/progreso').set(bearer(adminA.token));
    const adminB = await login(app, fx.email.adminEmpB);
    const pB = await request(app).get('/api/onboarding/progreso').set(bearer(adminB.token));
    expect(pA.body.primera_sucursal_id).not.toBe(pB.body.primera_sucursal_id);
    expect((await q(`SELECT empresa_id FROM sucursales WHERE id = $1`, [pA.body.primera_sucursal_id]))[0].empresa_id).toBe(fx.empresas.A);
  });
});
