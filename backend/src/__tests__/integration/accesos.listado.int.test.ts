/**
 * I-ENT · Listados de entradas en la web con los accesos del ANPR (Sprint 10, seguimiento) — integración.
 *
 * Componentes: Express (app.ts) → GET /api/accesos (nuevo, paginado), GET /api/dashboard (accesos recientes),
 *   GET /api/reportes/accesos (CSV), GET /api/anpr/evidencias/:id_cliente/:tipo (miniatura) → Postgres real.
 * Condición: en A1 una entrada de cada método (manual, clic, QR, ANPR automático y ANPR verificado por el agente, con evidencia);
 *   una en A2 (misma empresa) y una en B1 (otra empresa). Todas llevan la marca de esta corrida en la placa.
 * Resultado esperado: cada administración ve lo que ve hoy (su sucursal, su empresa o todo), los accesos ANPR aparecen con su método,
 *   confianza, «verificado por agente» y evidencia; filtros por método y placa; paginación estable; el personal de garita y los
 *   residentes no entran; la evidencia de otra empresa no se puede pedir.
 */
import request from 'supertest';
import { randomUUID, createHash } from 'crypto';
import app from '../../app';
import { q, uno, cerrarPool } from '../helpers/db';
import { sembrar, Fixtures } from '../helpers/seed';
import { login, bearer } from '../helpers/auth';

let fx: Fixtures;
const token: Record<string, string> = {};
let lic: string;
/** Tres letras de esta corrida: todas las placas de la prueba las llevan, así los filtros no ven filas de otros archivos. */
let marca: string;
const ids: Record<string, string> = {};
let idClienteAnpr: string;

const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, ...Array.from({ length: 64 }, (_, i) => i), 0xff, 0xd9]);
const listar = (k: string, qs: Record<string, string | number> = {}) => request(app).get('/api/accesos').query(qs).set(bearer(token[k]));

beforeAll(async () => {
  fx = await sembrar();
  marca = fx.sufijo.replace(/[^a-z]/g, 'x').slice(0, 3).toUpperCase().padEnd(3, 'X');
  for (const k of ['owner', 'adminEmpA', 'adminEmpB', 'adminSucA1', 'adminSucB1', 'agenteA1', 'resA1']) token[k] = (await login(app, fx.email[k])).token!;
  lic = (await request(app).post('/api/licencias/activar').send({ codigo: fx.licencias.A1.codigo, fingerprint: fx.licencias.A1.fingerprint, nombre_dispositivo: 'INT-entradas' })).body.token_licencia;

  // Visitantes (web): manual, clic y QR, cada uno con su placa.
  const visita = async (placa: string, extra: Record<string, unknown>) => {
    const r = await request(app).post('/api/accesos').set(bearer(token.agenteA1)).send({
      nombre_visitante: `Visita ${placa}`, numero_dpi: `EN${randomUUID().slice(0, 10)}`, residente_id: fx.residentes.A1, placa, ...extra,
    });
    expect(r.status).toBe(201);
    return r.body.registro.id as string;
  };
  ids.manual = await visita(`P111${marca}`, { capturado_manualmente: true });
  ids.clic = await visita(`P222${marca}`, { capturado_manualmente: false });
  const qr = await uno<{ id: string }>(
    `INSERT INTO invitaciones_qr (sucursal_id, residente_id, tipo, fecha_inicio) VALUES ($1, $2, 'grupal', CURRENT_DATE) RETURNING id`,
    [fx.sucursales.A1, fx.residentes.A1]);
  ids.qr = (await uno<{ id: string }>(
    `INSERT INTO registros_acceso (sucursal_id, visitante_id, residente_id, vehiculo_id, agente_id, tipo, invitacion_qr_id, origen)
     SELECT ra.sucursal_id, ra.visitante_id, ra.residente_id, ra.vehiculo_id, ra.agente_id, 'entrada', $2, 'desktop' FROM registros_acceso ra WHERE ra.id = $1
     RETURNING id`, [ids.clic, qr!.id]))!.id;

  // Residente por placas (ANPR): automático con evidencia, y otro confirmado con un clic del agente.
  const veh = await request(app).post('/api/anpr/vehiculos').set(bearer(token.adminSucA1)).send({ residente_id: fx.residentes.A1, placa: `P333${marca}` });
  expect(veh.status).toBe(201);
  const anpr = (modo: string, idc: string = randomUUID()) => request(app).post('/api/anpr/accesos').set(bearer(token.agenteA1)).set('X-Licencia-Token', lic).send({
    id_cliente: idc, vehiculo_id: veh.body.id, placa: veh.body.placa, confianza: 0.9634, track_id: 'entrada-ent-1', carril: 'entrada', modo,
    registrado_en: new Date(Date.now() - 20_000).toISOString(),
  });
  idClienteAnpr = randomUUID();
  const a = await anpr('automatico', idClienteAnpr);
  expect(a.status).toBe(201);
  ids.anpr = a.body.registro.id;
  const ev = await request(app).post('/api/anpr/evidencias').set(bearer(token.agenteA1)).set('X-Licencia-Token', lic).send({
    id_cliente: idClienteAnpr, tipo: 'placa', jpeg: jpeg.toString('base64'), sha256: createHash('sha256').update(jpeg).digest('hex'),
  });
  expect(ev.status).toBe(201);
  const v = await anpr('verificacion');
  expect(v.status).toBe(201);
  ids.verificado = v.body.registro.id;

  // Otra sucursal de la misma empresa y otra empresa (directo: lo que importa aquí es quién las ve).
  const otra = async (suc: string, res: string, agente: string, placa: string) => {
    const vis = await uno<{ id: string }>(`INSERT INTO visitantes (nombre, numero_dpi) VALUES ('Visita otra', $1) RETURNING id`, [`EO${randomUUID().slice(0, 10)}`]);
    const vehv = await uno<{ id: string }>(`INSERT INTO vehiculos (visitante_id, placa) VALUES ($1, $2) RETURNING id`, [vis!.id, placa]);
    return (await uno<{ id: string }>(
      `INSERT INTO registros_acceso (sucursal_id, visitante_id, residente_id, vehiculo_id, agente_id, tipo, origen)
       VALUES ($1, $2, $3, $4, $5, 'entrada', 'web') RETURNING id`, [suc, vis!.id, res, vehv!.id, agente]))!.id;
  };
  ids.a2 = await otra(fx.sucursales.A2, fx.residentes.A2, fx.usuarios.adminSucA2, `P444${marca}`);
  ids.b1 = await otra(fx.sucursales.B1, fx.residentes.B1, fx.usuarios.agenteB1, `P555${marca}`);
});
afterAll(cerrarPool);

describe('GET /api/accesos (listado de entradas)', () => {
  it('el administrador de sucursal ve sus entradas, también las del ANPR, con método, placa, confianza y evidencia', async () => {
    const r = await listar('adminSucA1', { placa: marca });
    expect(r.status).toBe(200);
    const porId = Object.fromEntries(r.body.accesos.map((a: { id: string }) => [a.id, a]));
    expect(Object.keys(porId).sort()).toEqual([ids.manual, ids.clic, ids.qr, ids.anpr, ids.verificado].sort());
    expect(r.body.total).toBe(5);
    expect(porId[ids.anpr]).toMatchObject({
      metodo: 'anpr', origen: 'anpr', es_residente: true, visitante_nombre: null, numero_dpi: null, placa: `P333${marca}`,
      confianza: 0.9634, verificado: false, evidencia_placa: true, evidencia_vehiculo: false, id_cliente: idClienteAnpr,
    });
    expect(porId[ids.verificado]).toMatchObject({ metodo: 'anpr', verificado: true, verificado_por_nombre: expect.stringContaining('agenteA1'), evidencia_placa: false, id_cliente: null });
    expect(porId[ids.manual]).toMatchObject({ metodo: 'manual', es_residente: false, placa: `P111${marca}`, confianza: null });
    expect(porId[ids.clic].metodo).toBe('clic');
    expect(porId[ids.qr].metodo).toBe('qr');
    // La más reciente primero.
    const fechas = r.body.accesos.map((a: { timestamp_entrada: string }) => Date.parse(a.timestamp_entrada));
    expect([...fechas].sort((a, b) => b - a)).toEqual(fechas);
  });

  it('filtro por método (manual, clic, QR, ANPR) y búsqueda por placa en cualquier formato', async () => {
    for (const [metodo, esperados] of [['anpr', [ids.anpr, ids.verificado]], ['manual', [ids.manual]], ['clic', [ids.clic]], ['qr', [ids.qr]]] as const) {
      const r = await listar('adminSucA1', { placa: marca, metodo });
      expect(r.status).toBe(200);
      expect(r.body.accesos.map((a: { id: string }) => a.id).sort()).toEqual([...esperados].sort());
    }
    const p = await listar('adminSucA1', { placa: `p-333 ${marca.toLowerCase()}` });
    expect(p.body.accesos.map((a: { id: string }) => a.id).sort()).toEqual([ids.anpr, ids.verificado].sort());
    expect((await listar('adminSucA1', { metodo: 'otro' })).status).toBe(400);
    expect((await listar('adminSucA1', { placa: 'x' })).status).toBe(400);
    expect((await listar('adminSucA1', { desde: '22-10-2026' })).status).toBe(400);
    const hoy = (await uno<{ d: string }>(`SELECT to_char(NOW() AT TIME ZONE 'America/Guatemala', 'YYYY-MM-DD') AS d`))!.d;
    expect((await listar('adminSucA1', { placa: marca, desde: hoy, hasta: hoy })).body.total).toBe(5);
    expect((await listar('adminSucA1', { placa: marca, hasta: '2020-01-01' })).body.total).toBe(0);
  });

  it('paginación estable: páginas sin huecos ni repetidos y el total de siempre', async () => {
    const vistas: string[] = [];
    for (let pagina = 1; pagina <= 3; pagina++) {
      const r = await listar('adminSucA1', { placa: marca, por_pagina: 2, pagina });
      expect(r.body).toMatchObject({ total: 5, pagina, por_pagina: 2 });
      vistas.push(...r.body.accesos.map((a: { id: string }) => a.id));
    }
    expect(vistas).toHaveLength(5);
    expect(new Set(vistas).size).toBe(5);
    expect((await listar('adminSucA1', { placa: marca, pagina: 4, por_pagina: 2 })).body.accesos).toEqual([]);
    expect((await listar('adminSucA1', { por_pagina: 101 })).status).toBe(400);
    expect((await listar('adminSucA1', { pagina: 0 })).status).toBe(400);
  });

  it('cada rol ve lo que ve hoy: sucursal, empresa (A1 y A2) u owner (todo); otra empresa nunca', async () => {
    const ver = async (k: string) => (await listar(k, { placa: marca })).body.accesos.map((a: { id: string }) => a.id) as string[];
    const sucA1 = await ver('adminSucA1');
    expect(sucA1).not.toContain(ids.a2);
    expect(sucA1).not.toContain(ids.b1);
    const empA = await ver('adminEmpA');
    expect(empA).toEqual(expect.arrayContaining([ids.anpr, ids.a2]));
    expect(empA).not.toContain(ids.b1);
    expect(await ver('adminSucB1')).toEqual([ids.b1]);
    expect(await ver('owner')).toEqual(expect.arrayContaining([ids.anpr, ids.a2, ids.b1]));
    // El personal de garita y los residentes no tienen este listado.
    expect((await listar('agenteA1')).status).toBe(403);
    expect((await listar('resA1')).status).toBe(403);
    expect((await request(app).get('/api/accesos')).status).toBe(401);
  });

  it('miniatura de la evidencia: la ve quien ve el registro; otra empresa recibe 404', async () => {
    const pedir = (k: string) => request(app).get(`/api/anpr/evidencias/${idClienteAnpr}/placa`).set(bearer(token[k]));
    for (const k of ['adminSucA1', 'adminEmpA', 'owner']) {
      const r = await pedir(k);
      expect([k, r.status, r.headers['content-type']]).toEqual([k, 200, 'image/jpeg']);
      expect(Buffer.from(r.body).equals(jpeg)).toBe(true);
    }
    for (const k of ['adminSucB1', 'adminEmpB']) expect([k, (await pedir(k)).status]).toEqual([k, 404]);
    expect((await pedir('resA1')).status).toBe(403);
  });
});

describe('listados que ya existían', () => {
  it('«Accesos recientes» del panel incluye la entrada ANPR del residente con su método', async () => {
    const r = await request(app).get('/api/dashboard').set(bearer(token.adminSucA1));
    expect(r.status).toBe(200);
    const anpr = r.body.accesos_recientes.find((a: { id: string }) => a.id === ids.anpr);
    expect(anpr).toMatchObject({ metodo: 'anpr', es_residente: true, verificado: false, placa: `P333${marca}` });
    expect(anpr.nombre_visitante).toContain('resA1');
    const ver = r.body.accesos_recientes.find((a: { id: string }) => a.id === ids.verificado);
    expect(ver).toMatchObject({ metodo: 'anpr', verificado: true });
  });

  it('el reporte de entradas (CSV) incluye los accesos ANPR y el método de cada fila, sin mover las columnas de antes', async () => {
    // De ayer a mañana: el reporte cuenta los días en la hora de la base (UTC) y de 18:00 a 24:00 en Guatemala ya es «mañana»
    // allí. Las filas de esta prueba se reconocen por su placa única, así que el rango amplio no mezcla nada.
    const dias = (await uno<{ desde: string; hasta: string }>(
      `SELECT to_char(NOW() - INTERVAL '1 day', 'YYYY-MM-DD') AS desde, to_char(NOW() + INTERVAL '1 day', 'YYYY-MM-DD') AS hasta`))!;
    const r = await request(app).get('/api/reportes/accesos').query(dias).set(bearer(token.adminSucA1));
    expect(r.status).toBe(200);
    const [cab, ...filas] = r.text.split('\n');
    expect(cab).toBe('fecha,hora_entrada,hora_salida,nombre_visitante,numero_dpi,placa,numero_casa,cargo_generado,metodo,persona,residente,verificado_por_agente,confianza');
    const deAnpr = filas.filter(f => f.includes(`P333${marca}`));
    expect(deAnpr).toHaveLength(2);
    expect(deAnpr.some(f => /Automático \(placas\),Residente,[^,]*resA1[^,]*,No,0\.96$/.test(f))).toBe(true);
    expect(deAnpr.some(f => /Automático \(placas\),Residente,[^,]*,Sí,0\.96$/.test(f))).toBe(true);
    expect(filas.find(f => f.includes(`P111${marca}`))).toMatch(/,Manual,Visitante,/);
    expect(filas.some(f => f.includes(`P555${marca}`))).toBe(false);
  });
});
