/**
 * I-8 · Altas de empresa y sucursal: el aviso «sin administrador» — SCRUM-114 / H09
 *
 * Componentes: Express (app.ts) → GET /api/empresas, GET /api/sucursales, POST /api/invitaciones →
 *   controllers → Postgres real (empresas, sucursales, usuarios, invitaciones). Sin mocks; el correo usa el transporte "log".
 * Condición: una empresa (y una sucursal) recién creadas no tienen administrador; el owner/admin de empresa
 *   los invita y la persona acepta.
 * Resultado esperado (las listas del panel traen dos banderas por fila):
 *   - tiene_admin: hay un usuario activo con el rol de administrador de esa empresa/sucursal;
 *   - invitacion_pendiente: hay una invitación vigente (no aceptada, no revocada, no vencida) hacia ese alcance;
 *   - la empresa/sucursal sembradas con administrador salen con tiene_admin = true.
 */
import request from 'supertest';
import app from '../../app';
import { q, cerrarPool } from '../helpers/db';
import { sembrar, Fixtures } from '../helpers/seed';
import { login, bearer, PASSWORD } from '../helpers/auth';

let fx: Fixtures;
beforeAll(async () => { fx = await sembrar(); });
afterAll(cerrarPool);

const token = (enlace: string) => enlace.split('/invitacion/')[1];

describe('I-8 empresas: tiene_admin / invitacion_pendiente', () => {
  it('una empresa nueva sale sin administrador; la invitación la marca pendiente; al aceptar tiene administrador', async () => {
    const owner = await login(app, fx.email.owner);
    expect(owner.status).toBe(200);

    const nueva = await request(app).post('/api/empresas').set(bearer(owner.token)).send({ nombre: `INT Alta ${fx.sufijo}` });
    expect(nueva.status).toBe(201);
    const fila = async () => (await request(app).get('/api/empresas').set(bearer(owner.token))).body.find((e: any) => e.id === nueva.body.id);

    expect(await fila()).toMatchObject({ tiene_admin: false, invitacion_pendiente: false });

    const correo = `admin.alta.${fx.sufijo}@inttest.local`;
    const inv = await request(app).post('/api/invitaciones').set(bearer(owner.token))
      .send({ email: correo, rol_invitado: 'admin_empresa', empresa_id: nueva.body.id });
    expect(inv.status).toBe(201);
    expect(await fila()).toMatchObject({ tiene_admin: false, invitacion_pendiente: true });

    const acepta = await request(app).post(`/api/invitaciones/${token(inv.body.enlace)}/aceptar`).send({ nombre: 'Admin Alta', password: PASSWORD });
    expect(acepta.status).toBe(200);
    expect(await fila()).toMatchObject({ tiene_admin: true, invitacion_pendiente: false });
  });

  it('una invitación revocada deja de contar como pendiente', async () => {
    const owner = await login(app, fx.email.owner);
    const nueva = await request(app).post('/api/empresas').set(bearer(owner.token)).send({ nombre: `INT Revoca ${fx.sufijo}` });
    const inv = await request(app).post('/api/invitaciones').set(bearer(owner.token))
      .send({ email: `revoca.${fx.sufijo}@inttest.local`, rol_invitado: 'admin_empresa', empresa_id: nueva.body.id });
    expect(inv.status).toBe(201);
    expect((await request(app).patch(`/api/invitaciones/${inv.body.id}/revocar`).set(bearer(owner.token))).status).toBe(200);
    const e = (await request(app).get('/api/empresas').set(bearer(owner.token))).body.find((x: any) => x.id === nueva.body.id);
    expect(e).toMatchObject({ tiene_admin: false, invitacion_pendiente: false });
  });

  it('una invitación vencida tampoco cuenta como pendiente', async () => {
    const owner = await login(app, fx.email.owner);
    const nueva = await request(app).post('/api/empresas').set(bearer(owner.token)).send({ nombre: `INT Vence ${fx.sufijo}` });
    const inv = await request(app).post('/api/invitaciones').set(bearer(owner.token))
      .send({ email: `vence.${fx.sufijo}@inttest.local`, rol_invitado: 'admin_empresa', empresa_id: nueva.body.id });
    expect(inv.status).toBe(201);
    await q(`UPDATE invitaciones SET expira_en = NOW() - INTERVAL '1 hour' WHERE id = $1`, [inv.body.id]);
    const e = (await request(app).get('/api/empresas').set(bearer(owner.token))).body.find((x: any) => x.id === nueva.body.id);
    expect(e).toMatchObject({ tiene_admin: false, invitacion_pendiente: false });
  });

  it('la empresa sembrada con administrador sale con tiene_admin = true', async () => {
    const owner = await login(app, fx.email.owner);
    const lista = (await request(app).get('/api/empresas').set(bearer(owner.token))).body;
    expect(lista.find((e: any) => e.id === fx.empresas.A).tiene_admin).toBe(true);
    expect(lista.find((e: any) => e.id === fx.empresas.B).tiene_admin).toBe(true);
  });
});

describe('I-8 sucursales: tiene_admin / invitacion_pendiente', () => {
  it('una sucursal nueva sale sin administrador y la invitación la marca pendiente; las sembradas ya tienen', async () => {
    const admin = await login(app, fx.email.adminEmpA);
    const nueva = await request(app).post('/api/sucursales').set(bearer(admin.token))
      .send({ empresa_id: fx.empresas.A, nombre: `INT Sucursal Alta ${fx.sufijo}` });
    expect(nueva.status).toBe(201);
    const lista = async () => (await request(app).get('/api/sucursales').set(bearer(admin.token))).body;
    const fila = async () => (await lista()).find((s: any) => s.id === nueva.body.id);

    expect(await fila()).toMatchObject({ tiene_admin: false, invitacion_pendiente: false });
    expect((await lista()).find((s: any) => s.id === fx.sucursales.A1).tiene_admin).toBe(true);

    const inv = await request(app).post('/api/invitaciones').set(bearer(admin.token))
      .send({ email: `suc.alta.${fx.sufijo}@inttest.local`, rol_invitado: 'admin_sucursal', sucursal_id: nueva.body.id });
    expect(inv.status).toBe(201);
    expect(await fila()).toMatchObject({ tiene_admin: false, invitacion_pendiente: true });

    const acepta = await request(app).post(`/api/invitaciones/${token(inv.body.enlace)}/aceptar`).send({ nombre: 'Admin Sucursal', password: PASSWORD });
    expect(acepta.status).toBe(200);
    expect(await fila()).toMatchObject({ tiene_admin: true, invitacion_pendiente: false });
  });
});
