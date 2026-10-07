/**
 * I-4 · Edición y baja del personal (integración) — SCRUM-109 / H02
 *
 * Componentes: Express (app.ts) → /api/usuarios → usuarios.controller → Postgres real
 *   (usuarios, refresh_tokens, audit_logs); supertest, sin mocks.
 * Condición: administradores de distintas empresas/sucursales editan y dan de baja a
 *   agentes propios y ajenos.
 * Datos: seed (empresas A/B, sucursales A1/A2/B1); cada prueba crea su propio agente
 *   para no depender del orden.
 * Resultado esperado:
 *   - PUT /usuarios/:id cambia nombre/correo/rol/contraseña dentro del alcance y deja
 *     USUARIO_EDITADO en audit_logs con usuario, IP, código HTTP y los campos tocados
 *     (nunca la contraseña).
 *   - Fuera del alcance (otra empresa, otra sucursal, un owner) → 404 y la fila no cambia.
 *   - Cambiar la contraseña revoca los refresh tokens y el access token vigente.
 *   - DELETE /usuarios/:id da de baja, revoca los refresh tokens y no permite volver a entrar.
 */
import request from 'supertest';
import app from '../../app';
import { q, uno, cerrarPool } from '../helpers/db';
import { sembrar, Fixtures } from '../helpers/seed';
import { login, bearer, PASSWORD } from '../helpers/auth';
import { esperarAuditoria } from '../helpers/audit';

let fx: Fixtures;
let n = 0;
beforeAll(async () => { fx = await sembrar(); });
afterAll(cerrarPool);

/** Crea un usuario del personal con la contraseña de prueba y devuelve { id, email }. */
const nuevo = async (rol: 'agente' | 'admin_sucursal' | 'residente', sucursal: string, tag = 'x') => {
  const email = `${tag}${++n}.${fx.sufijo}@inttest.local`;
  const r = await uno<{ id: string }>(
    `INSERT INTO usuarios (nombre, email, password_hash, rol, sucursal_id, empresa_id, activo)
     VALUES ($1, $2, crypt($3, gen_salt('bf', 4)), $4, $5, NULL, TRUE) RETURNING id`,
    [`INT ${tag}${n}`, email, PASSWORD, rol, sucursal],
  );
  return { id: r!.id, email };
};

const fila = (id: string) => uno('SELECT nombre, email, rol, activo, password_hash FROM usuarios WHERE id = $1', [id]);
const put = (token: string | undefined, id: string, body: object) =>
  request(app).put(`/api/usuarios/${id}`).set(bearer(token)).send(body);

describe('I-4 PUT /usuarios/:id — edición dentro del alcance', () => {
  it('admin de sucursal edita nombre y correo de un agente de SU sucursal y queda auditado', async () => {
    const ag = await nuevo('agente', fx.sucursales.A1);
    const admin = await login(app, fx.email.adminSucA1);
    const r = await put(admin.token, ag.id, { nombre: '  Agente Renombrado  ', email: `NUEVO.${ag.email.toUpperCase()}` });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ id: ag.id, nombre: 'Agente Renombrado', email: `nuevo.${ag.email}`, rol: 'agente' });
    expect(r.body).not.toHaveProperty('password_hash');

    const db = await fila(ag.id);
    expect(db).toMatchObject({ nombre: 'Agente Renombrado', email: `nuevo.${ag.email}`, rol: 'agente', activo: true });

    const [a] = await esperarAuditoria('USUARIO_EDITADO', ag.id);
    expect(a).toBeDefined();
    expect(a.usuario_id).toBe(fx.usuarios.adminSucA1);
    expect(a.status_code).toBe(200);
    expect(a.tabla_afectada).toBe('usuarios');
    expect(a.ip_address).toBeTruthy();
    expect(a.datos_nuevos.campos).toEqual(['nombre', 'email']);
    expect(JSON.stringify(a.datos_nuevos)).not.toMatch(/pass/i);
  });

  it('cambia el rol agente → admin_sucursal, lo audita y deja el access token anterior sin validez', async () => {
    const ag = await nuevo('agente', fx.sucursales.A1);
    const sesionAgente = await login(app, ag.email);
    expect(sesionAgente.status).toBe(200);
    const admin = await login(app, fx.email.adminSucA1);

    const r = await put(admin.token, ag.id, { rol: 'admin_sucursal' });
    expect(r.status).toBe(200);
    expect((await fila(ag.id)).rol).toBe('admin_sucursal');

    const [a] = await esperarAuditoria('USUARIO_EDITADO', ag.id);
    expect(a.datos_nuevos).toMatchObject({ campos: ['rol'], rol_anterior: 'agente', rol_nuevo: 'admin_sucursal' });

    // El token viejo llevaba rol «agente»: se corta; con la sesión (refresh) trae el rol nuevo.
    const viejo = await request(app).get('/api/dashboard').set(bearer(sesionAgente.token));
    expect(viejo.status).toBe(401);
    const refresh = await request(app).post('/api/auth/refresh').set('Cookie', sesionAgente.cookie!);
    expect(refresh.status).toBe(200);
  });

  it('el admin de empresa edita al personal de CUALQUIER sucursal de su empresa', async () => {
    const adminA2 = await nuevo('admin_sucursal', fx.sucursales.A2);
    const adminEmp = await login(app, fx.email.adminEmpA);
    const r = await put(adminEmp.token, adminA2.id, { nombre: 'Admin A2 por la empresa' });
    expect(r.status).toBe(200);
    expect((await fila(adminA2.id)).nombre).toBe('Admin A2 por la empresa');
  });

  it('el owner edita a un admin de empresa (nombre) pero no puede cambiarle el rol', async () => {
    const owner = await login(app, fx.email.owner);
    const ok = await put(owner.token, fx.usuarios.adminEmpB, { nombre: 'Admin Empresa B (renombrado)' });
    expect(ok.status).toBe(200);
    const rol = await put(owner.token, fx.usuarios.adminEmpB, { rol: 'agente' });
    expect(rol.status).toBe(400);
    expect((await fila(fx.usuarios.adminEmpB)).rol).toBe('admin_empresa');
  });
});

describe('I-4 PUT /usuarios/:id — contraseña', () => {
  it('cambiar la contraseña revoca refresh tokens y access token; la anterior deja de servir', async () => {
    const ag = await nuevo('agente', fx.sucursales.A1);
    const sesion = await login(app, ag.email);
    expect(sesion.status).toBe(200);
    expect((await q('SELECT 1 FROM refresh_tokens WHERE usuario_id = $1 AND revoked = FALSE', [ag.id])).length).toBe(1);
    const hashAntes = (await fila(ag.id)).password_hash;

    const admin = await login(app, fx.email.adminSucA1);
    const r = await put(admin.token, ag.id, { password: 'NuevaClave#2026' });
    expect(r.status).toBe(200);
    expect(r.body).not.toHaveProperty('password_hash');

    expect((await fila(ag.id)).password_hash).not.toBe(hashAntes);
    expect((await q('SELECT 1 FROM refresh_tokens WHERE usuario_id = $1 AND revoked = FALSE', [ag.id])).length).toBe(0);

    expect((await request(app).get('/api/dashboard').set(bearer(sesion.token))).status).toBe(401);
    expect((await request(app).post('/api/auth/refresh').set('Cookie', sesion.cookie!)).status).toBe(401);
    expect((await login(app, ag.email, PASSWORD)).status).toBe(401);
    expect((await login(app, ag.email, 'NuevaClave#2026')).status).toBe(200);

    const [a] = await esperarAuditoria('USUARIO_EDITADO', ag.id);
    expect(a.datos_nuevos.campos).toEqual(['password']);
    expect(JSON.stringify(a)).not.toContain('NuevaClave');
  });

  it.each([
    ['corta', 'abc1'],
    ['solo letras', 'sololetrasaqui'],
    ['común', 'password1'],
  ])('rechaza una contraseña %s con 400 y no toca la fila', async (_n, clave) => {
    const ag = await nuevo('agente', fx.sucursales.A1);
    const admin = await login(app, fx.email.adminSucA1);
    const antes = await fila(ag.id);
    const r = await put(admin.token, ag.id, { password: clave });
    expect(r.status).toBe(400);
    expect(await fila(ag.id)).toEqual(antes);
  });

  it('una contraseña vacía significa «no cambiar»', async () => {
    const ag = await nuevo('agente', fx.sucursales.A1);
    const admin = await login(app, fx.email.adminSucA1);
    const antes = await fila(ag.id);
    const r = await put(admin.token, ag.id, { nombre: 'Solo nombre', password: '' });
    expect(r.status).toBe(200);
    expect((await fila(ag.id)).password_hash).toBe(antes.password_hash);
  });
});

describe('I-4 PUT /usuarios/:id — validaciones', () => {
  it('cuerpo vacío, id inválido, correo inválido y tipos incorrectos → 400', async () => {
    const ag = await nuevo('agente', fx.sucursales.A1);
    const admin = await login(app, fx.email.adminSucA1);
    expect((await put(admin.token, ag.id, {})).status).toBe(400);
    expect((await put(admin.token, 'no-es-uuid', { nombre: 'X' })).status).toBe(400);
    expect((await put(admin.token, ag.id, { email: 'sin-arroba' })).status).toBe(400);
    expect((await put(admin.token, ag.id, { nombre: '   ' })).status).toBe(400);
    expect((await put(admin.token, ag.id, { nombre: { $ne: 1 } })).status).toBe(400);
    expect((await put(admin.token, ag.id, { nombre: 'x'.repeat(101) })).status).toBe(400);
  });

  it('roles no asignables (owner, admin_empresa, residente) → 400; no hay escalada', async () => {
    const ag = await nuevo('agente', fx.sucursales.A1);
    const admin = await login(app, fx.email.adminSucA1);
    for (const rol of ['owner', 'admin_empresa', 'residente', 'superadmin']) {
      expect((await put(admin.token, ag.id, { rol })).status).toBe(400);
    }
    expect((await fila(ag.id)).rol).toBe('agente');
  });

  it('un residente no cambia de rol por esta ruta', async () => {
    const adminSuc = await login(app, fx.email.adminSucA1);
    const r = await put(adminSuc.token, fx.usuarios.resA1, { rol: 'agente' });
    expect(r.status).toBe(400);
    expect((await fila(fx.usuarios.resA1)).rol).toBe('residente');
  });

  it('correo duplicado → 409 y la fila no cambia', async () => {
    const a = await nuevo('agente', fx.sucursales.A1);
    const b = await nuevo('agente', fx.sucursales.A1);
    const admin = await login(app, fx.email.adminSucA1);
    const r = await put(admin.token, a.id, { email: b.email });
    expect(r.status).toBe(409);
    expect((await fila(a.id)).email).toBe(a.email);
  });

  it('nadie se edita a sí mismo (ni siquiera el rol o la contraseña)', async () => {
    const admin = await login(app, fx.email.adminSucA1);
    for (const body of [{ nombre: 'Yo' }, { rol: 'agente' }, { password: 'OtraClave#2026' }]) {
      expect((await put(admin.token, fx.usuarios.adminSucA1, body)).status).toBe(400);
    }
    expect((await fila(fx.usuarios.adminSucA1)).rol).toBe('admin_sucursal');
    expect((await login(app, fx.email.adminSucA1)).status).toBe(200);
  });

  it('un id que no existe → 404', async () => {
    const admin = await login(app, fx.email.adminSucA1);
    expect((await put(admin.token, '3f2504e0-4f89-11d3-9a0c-0305e82c3301', { nombre: 'X' })).status).toBe(404);
  });
});

describe('I-4 PUT /usuarios/:id — aislamiento entre empresas y sucursales', () => {
  const intentos: Array<[string, string, string]> = [
    ['admin de sucursal A1', 'adminSucA1', 'agenteB1'],          // otra empresa
    ['admin de sucursal A1', 'adminSucA1', 'adminSucB1'],         // otra empresa, mismo rol
    ['admin de empresa A', 'adminEmpA', 'agenteB1'],              // otra empresa
    ['admin de empresa A', 'adminEmpA', 'adminEmpB'],             // otra empresa, rol superior
    ['admin de empresa B', 'adminEmpB', 'agenteA1'],
    ['admin de sucursal A1', 'adminSucA1', 'adminSucA2'],         // misma empresa, OTRA sucursal
    ['admin de sucursal A1', 'adminSucA1', 'adminEmpA'],          // hacia arriba
    ['admin de sucursal A1', 'adminSucA1', 'owner'],              // hacia arriba
    ['admin de empresa A', 'adminEmpA', 'owner'],
  ];

  it.each(intentos)('%s (%s) NO puede editar a %s: 404 y la fila no cambia', async (_desc, quien, objetivo) => {
    const sesion = await login(app, fx.email[quien]);
    const antes = await fila(fx.usuarios[objetivo]);
    const r = await put(sesion.token, fx.usuarios[objetivo], { nombre: 'HACKEADO', email: `hack.${fx.sufijo}@evil.test`, password: 'Hackeado#2026' });
    expect(r.status).toBe(404);
    expect(await fila(fx.usuarios[objetivo])).toEqual(antes);
  });

  it('el owner no puede editar a otro owner', async () => {
    const otro = await uno<{ id: string }>(
      `INSERT INTO usuarios (nombre, email, password_hash, rol, activo)
       VALUES ('INT otro owner', $1, crypt($2, gen_salt('bf', 4)), 'owner', TRUE) RETURNING id`,
      [`owner2.${fx.sufijo}@inttest.local`, PASSWORD],
    );
    const owner = await login(app, fx.email.owner);
    const antes = await fila(otro!.id);
    expect((await put(owner.token, otro!.id, { nombre: 'X' })).status).toBe(404);
    expect(await fila(otro!.id)).toEqual(antes);
  });

  it('agente y residente reciben 403 (no son administración)', async () => {
    const ag = await nuevo('agente', fx.sucursales.A1);
    for (const quien of ['agenteA1', 'resA1']) {
      const sesion = await login(app, fx.email[quien]);
      expect((await put(sesion.token, ag.id, { nombre: 'X' })).status).toBe(403);
    }
  });

  it('sin token → 401', async () => {
    const ag = await nuevo('agente', fx.sucursales.A1);
    expect((await request(app).put(`/api/usuarios/${ag.id}`).send({ nombre: 'X' })).status).toBe(401);
  });

  it('el intento rechazado también queda en la auditoría (con su código HTTP)', async () => {
    const sesion = await login(app, fx.email.adminSucA1);
    const r = await put(sesion.token, fx.usuarios.agenteB1, { nombre: 'X' });
    expect(r.status).toBe(404);
    const filas = await esperarAuditoria('USUARIO_EDITADO', fx.usuarios.agenteB1, { usuarioId: fx.usuarios.adminSucA1 });
    expect(filas.length).toBeGreaterThanOrEqual(1);
    expect(filas.at(-1).status_code).toBe(404);
  });
});

describe('I-4 DELETE /usuarios/:id — baja de personal', () => {
  it('da de baja, revoca los refresh tokens del agente, corta su sesión y lo audita', async () => {
    const ag = await nuevo('agente', fx.sucursales.A1);
    const sesion = await login(app, ag.email);
    expect(sesion.status).toBe(200);
    expect((await q('SELECT 1 FROM refresh_tokens WHERE usuario_id = $1 AND revoked = FALSE', [ag.id])).length).toBe(1);

    const admin = await login(app, fx.email.adminSucA1);
    const r = await request(app).delete(`/api/usuarios/${ag.id}`).set(bearer(admin.token));
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ id: ag.id, activo: false });

    expect((await fila(ag.id)).activo).toBe(false);
    expect((await q('SELECT 1 FROM refresh_tokens WHERE usuario_id = $1 AND revoked = FALSE', [ag.id])).length).toBe(0);
    expect((await request(app).post('/api/auth/refresh').set('Cookie', sesion.cookie!)).status).toBe(401);
    expect((await request(app).get('/api/dashboard').set(bearer(sesion.token))).status).toBe(401);
    expect((await login(app, ag.email)).status).toBe(401);

    const [a] = await esperarAuditoria('USUARIO_DESACTIVADO', ag.id);
    expect(a).toMatchObject({ usuario_id: fx.usuarios.adminSucA1, status_code: 200, tabla_afectada: 'usuarios' });
    expect(a.ip_address).toBeTruthy();
  });

  it('no se puede dar de baja a alguien de otra empresa/sucursal, a un superior ni a sí mismo (404 y sigue activo)', async () => {
    const casos: Array<[string, string]> = [
      ['adminSucA1', 'agenteB1'], ['adminEmpA', 'agenteB1'], ['adminSucA1', 'adminSucA2'],
      ['adminSucA1', 'owner'], ['adminSucA1', 'adminEmpA'], ['adminSucA1', 'adminSucA1'],
    ];
    for (const [quien, objetivo] of casos) {
      const sesion = await login(app, fx.email[quien]);
      const r = await request(app).delete(`/api/usuarios/${fx.usuarios[objetivo]}`).set(bearer(sesion.token));
      expect([quien, objetivo, r.status]).toEqual([quien, objetivo, 404]);
      expect((await fila(fx.usuarios[objetivo])).activo).toBe(true);
    }
  });
});
