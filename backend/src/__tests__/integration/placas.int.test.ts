/**
 * I-7 · Una sola forma de placa: se guarda, se compara y se busca igual — SCRUM-113 / H08
 *
 * Componentes: Express (app.ts) → /api/accesos, /api/preautorizaciones, /api/invitaciones-qr →
 *   controllers → Postgres real (vehiculos, preautorizaciones, invitaciones_qr). Sin mocks.
 * Forma canónica: mayúsculas y solo A-Z / 0-9 (`P123ABC`); se escriba como se escriba
 * («p-123 abc», «P-123ABC»). Las filas guardadas ANTES de la normalización (con guion o en minúsculas)
 * se siguen encontrando, porque las comparaciones normalizan también la columna.
 * Resultado esperado:
 *   - una entrada con «p-123 abc» guarda `P123ABC` en vehiculos;
 *   - la búsqueda de salida encuentra la misma placa en cualquier formato (y en filas viejas), solo dentro del alcance;
 *   - preautorizaciones e invitaciones QR guardan la placa canónica; una placa absurda (3 caracteres) se rechaza;
 *   - una preautorización solo de placa marca la entrada como preautorizada.
 */
import request from 'supertest';
import { randomUUID } from 'crypto';
import app from '../../app';
import { q, uno, cerrarPool } from '../helpers/db';
import { sembrar, Fixtures } from '../helpers/seed';
import { login, bearer } from '../helpers/auth';

let fx: Fixtures;
beforeAll(async () => { fx = await sembrar(); });
afterAll(cerrarPool);

const dpiUnico = () => `INT-DPI-${randomUUID().slice(0, 8)}`;
const entrada = (token: string | undefined, residenteId: string, body: object) =>
  request(app).post('/api/accesos').set(bearer(token)).send({
    nombre_visitante: 'Visitante Placa', numero_dpi: dpiUnico(), residente_id: residenteId, ...body,
  });
const hoy = () => new Date(Date.now() - 6 * 3600_000).toISOString().slice(0, 10);   // día de Guatemala
const manana = () => new Date(Date.now() + 18 * 3600_000).toISOString().slice(0, 10);

describe('I-7 al guardar: placa canónica', () => {
  it('una entrada con «p-123 abc» guarda P123ABC en vehiculos', async () => {
    const agente = await login(app, fx.email.agenteA1);
    const r = await entrada(agente.token, fx.residentes.A1, { placa: 'p-123 abc' });
    expect(r.status).toBe(201);
    const v = await uno(`SELECT veh.placa FROM registros_acceso ra JOIN vehiculos veh ON veh.id = ra.vehiculo_id WHERE ra.id = $1`, [r.body.registro.id]);
    expect(v.placa).toBe('P123ABC');
  });

  it('una placa solo de símbolos no crea vehículo (la entrada sigue siendo válida)', async () => {
    const agente = await login(app, fx.email.agenteA1);
    const r = await entrada(agente.token, fx.residentes.A1, { placa: '---' });
    expect(r.status).toBe(201);
    const ra = await uno('SELECT vehiculo_id FROM registros_acceso WHERE id = $1', [r.body.registro.id]);
    expect(ra.vehiculo_id).toBeNull();
  });
});

describe('I-7 búsqueda de salida por placa', () => {
  let registroA1: string;

  beforeAll(async () => {
    const agente = await login(app, fx.email.agenteA1);
    const r = await entrada(agente.token, fx.residentes.A1, { placa: 'P-456 DEF' });
    expect(r.status).toBe(201);
    registroA1 = r.body.registro.id;
  });

  it.each(['P456DEF', 'p456def', 'P-456DEF', ' p 456 def ', 'P.456-DEF'])('encuentra el acceso abierto con %p', async formato => {
    const agente = await login(app, fx.email.agenteA1);
    const r = await request(app).get('/api/accesos/activo').query({ placa: formato }).set(bearer(agente.token));
    expect([formato, r.status]).toEqual([formato, 200]);
    expect(r.body.registro_id).toBe(registroA1);
    expect(r.body.placa).toBe('P456DEF');
  });

  it('también encuentra filas guardadas ANTES de la normalización (con guion y minúsculas)', async () => {
    const dpi = dpiUnico();
    const vis = (await uno<{ id: string }>('INSERT INTO visitantes (nombre, numero_dpi) VALUES ($1, $2) RETURNING id', ['Vieja', dpi]))!;
    const veh = (await uno<{ id: string }>(`INSERT INTO vehiculos (visitante_id, placa) VALUES ($1, 'p-777 zzz') RETURNING id`, [vis.id]))!;
    await q(
      `INSERT INTO registros_acceso (sucursal_id, visitante_id, residente_id, vehiculo_id, agente_id, tipo, autorizado)
       VALUES ($1, $2, $3, $4, $5, 'entrada', TRUE)`,
      [fx.sucursales.A1, vis.id, fx.residentes.A1, veh.id, fx.usuarios.agenteA1],
    );
    const agente = await login(app, fx.email.agenteA1);
    const r = await request(app).get('/api/accesos/activo').query({ placa: 'P777ZZZ' }).set(bearer(agente.token));
    expect(r.status).toBe(200);
    expect(r.body.visitante.numero_dpi).toBe(dpi);
  });

  it('solo dentro del alcance: otra empresa no ve el acceso (404) y una placa vacía es 400', async () => {
    for (const quien of ['agenteB1', 'adminSucB1', 'adminEmpB']) {
      const s = await login(app, fx.email[quien]);
      const r = await request(app).get('/api/accesos/activo').query({ placa: 'P456DEF' }).set(bearer(s.token));
      expect([quien, r.status]).toEqual([quien, 404]);
    }
    const adminEmpA = await login(app, fx.email.adminEmpA);
    expect((await request(app).get('/api/accesos/activo').query({ placa: 'P-456DEF' }).set(bearer(adminEmpA.token))).status).toBe(200);
    const agente = await login(app, fx.email.agenteA1);
    expect((await request(app).get('/api/accesos/activo').query({ placa: '--' }).set(bearer(agente.token))).status).toBe(400);
    expect((await request(app).get('/api/accesos/activo').set(bearer(agente.token))).status).toBe(400);
  });

  it('después de la salida ya no aparece', async () => {
    const agente = await login(app, fx.email.agenteA1);
    expect((await request(app).put(`/api/accesos/${registroA1}/salida`).set(bearer(agente.token))).status).toBe(200);
    expect((await request(app).get('/api/accesos/activo').query({ placa: 'P-456 DEF' }).set(bearer(agente.token))).status).toBe(404);
  });
});

describe('I-7 preautorizaciones', () => {
  it('guarda la placa canónica, la encuentra en cualquier formato y rechaza una absurda', async () => {
    const admin = await login(app, fx.email.adminSucA1);
    const crear = await request(app).post('/api/preautorizaciones').set(bearer(admin.token)).send({
      residente_id: fx.residentes.A1, nombre_visitante: 'Taxi de la familia', placa: 'p-555 xyz',
      fecha_inicio: hoy(), fecha_fin: manana(),
    });
    expect(crear.status).toBe(201);
    expect(crear.body.placa).toBe('P555XYZ');

    const agente = await login(app, fx.email.agenteA1);
    for (const formato of ['P555XYZ', 'p-555xyz', 'P 555 XYZ']) {
      const b = await request(app).get('/api/preautorizaciones/buscar').query({ placa: formato }).set(bearer(agente.token));
      expect([formato, b.status, b.body?.nombre_visitante]).toEqual([formato, 200, 'Taxi de la familia']);
    }

    const corta = await request(app).post('/api/preautorizaciones').set(bearer(admin.token)).send({
      residente_id: fx.residentes.A1, nombre_visitante: 'X', placa: 'AB', fecha_inicio: hoy(), fecha_fin: manana(),
    });
    expect(corta.status).toBe(400);
    expect(corta.body.error).toMatch(/entre 4 y 12/);
  });

  it('una preautorización solo de placa marca la entrada como preautorizada (en cualquier formato)', async () => {
    const admin = await login(app, fx.email.adminSucA1);
    await request(app).post('/api/preautorizaciones').set(bearer(admin.token)).send({
      residente_id: fx.residentes.A1, nombre_visitante: 'Repartidor', placa: 'P-321 QWE', fecha_inicio: hoy(), fecha_fin: manana(),
    });
    const agente = await login(app, fx.email.agenteA1);
    const con = await entrada(agente.token, fx.residentes.A1, { placa: 'p321qwe' });
    expect(con.status).toBe(201);
    expect(con.body.preautorizado).toBe(true);
    const sin = await entrada(agente.token, fx.residentes.A1, { placa: 'P999ZZZ' });
    expect(sin.body.preautorizado).toBe(false);
  });

  it('la preautorización del residente (/mis) también guarda la forma canónica', async () => {
    const res = await login(app, fx.email.resA1);
    const r = await request(app).post('/api/preautorizaciones/mis').set(bearer(res.token)).send({
      nombre_visitante: 'Amigo', placa: 'c-088 ab', fecha_inicio: hoy(), fecha_fin: manana(),
    });
    expect(r.status).toBe(201);
    expect(r.body.placa).toBe('C088AB');
    const corta = await request(app).post('/api/preautorizaciones/mis').set(bearer(res.token)).send({
      nombre_visitante: 'Amigo', placa: 'X1', fecha_inicio: hoy(), fecha_fin: manana(),
    });
    expect(corta.status).toBe(400);
  });
});

describe('I-7 invitaciones QR', () => {
  it('guarda la placa canónica y el QR acepta la placa de la entrada en otro formato', async () => {
    const residente = await login(app, fx.email.resA1);
    const inv = await request(app).post('/api/invitaciones-qr/mis').set(bearer(residente.token)).send({
      tipo: 'individual', nombre_visitante: 'Con carro', numero_dpi: dpiUnico(), placa: 'p-901 lmn',
      fecha_inicio: hoy(), fecha_fin: manana(), usos_maximos: 2,
    });
    expect(inv.status).toBe(201);
    expect(inv.body.placa).toBe('P901LMN');

    // La sucursal exige placa en los QR: la entrada con otro formato de la misma placa NO se rechaza como «no coincide».
    await q(`INSERT INTO configuracion_qr (sucursal_id, requiere_placa) VALUES ($1, TRUE)
             ON CONFLICT (sucursal_id) DO UPDATE SET requiere_placa = TRUE`, [fx.sucursales.A1]);
    const agente = await login(app, fx.email.agenteA1);
    const ok = await entrada(agente.token, fx.residentes.A1, {
      numero_dpi: inv.body.numero_dpi, nombre_visitante: 'Con carro', placa: 'P-901LMN', invitacion_qr_id: inv.body.id,
    });
    expect([201, 200]).toContain(ok.status);
    const otra = await entrada(agente.token, fx.residentes.A1, {
      numero_dpi: inv.body.numero_dpi, nombre_visitante: 'Con carro', placa: 'P-000XXX', invitacion_qr_id: inv.body.id,
    });
    expect(otra.status).toBe(409);
    expect(otra.body.error).toMatch(/placa no coincide/i);
  });
});
