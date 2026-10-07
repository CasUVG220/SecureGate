/**
 * I-14 · El panel de auditoría muestra las acciones nuevas y se puede filtrar por ellas — SCRUM-125 / SCRUM-180
 *
 * Componentes: Express (app.ts) → GET /api/audit-logs y /api/audit-logs/acciones (solo owner) → audit.controller → Postgres real.
 * Resultado esperado:
 *   - /acciones lista las acciones que EXISTEN en la bitácora (incluidas las nuevas: LOGOUT, TICKET_CREADO, REFRESH_RECHAZADO…) con su
 *     cantidad, y solo la ve el owner;
 *   - se filtra por acción, por resultado (correctas / rechazadas / bloqueadas por límite / error) y por persona o correo intentado;
 *   - un valor de resultado inválido → 400; las filas traen status_code y datos_nuevos para mostrar el límite que frenó un intento.
 */
process.env.RATE_LIMIT_TICKET_CREAR_MAX = '1';

import request from 'supertest';
import { randomUUID } from 'crypto';
import app from '../../app';
import { q, cerrarPool } from '../helpers/db';
import { sembrar, Fixtures } from '../helpers/seed';
import { login, bearer } from '../helpers/auth';

let fx: Fixtures;
let owner: string;
let res: string;
beforeAll(async () => {
  fx = await sembrar();
  owner = (await login(app, fx.email.owner)).token!;
  res = (await login(app, fx.email.resA1)).token!;

  // Material de prueba: una acción buena, una rechazada (403) y una bloqueada por límite (429).
  const ticket = () => request(app).post('/api/tickets').set(bearer(res)).send({ tipo: 'otro', titulo: `PANEL ${randomUUID().slice(0, 6)}`, mensaje: 'hola' });
  expect((await ticket()).status).toBe(201);                              // TICKET_CREADO 201
  expect((await ticket()).status).toBe(429);                              // TICKET_CREADO 429 (límite de 1)
  expect((await request(app).put(`/api/tickets/${randomUUID()}/cerrar`).set(bearer(res))).status).toBe(403);  // ACCESO_DENEGADO 403: cerrar es del personal
  await request(app).post('/api/auth/login').send({ email: `nadie.${fx.sufijo}@inttest.local`, password: 'Incorrecta#1' });  // LOGIN 401, sin persona
  await new Promise(r => setTimeout(r, 300));
});
afterAll(cerrarPool);

const logs = (params: Record<string, string> = {}) =>
  request(app).get('/api/audit-logs').query({ limit: '200', ...params }).set(bearer(owner));

describe('I-14 /api/audit-logs/acciones', () => {
  it('lista las acciones que existen, incluidas las nuevas, con su cantidad', async () => {
    const r = await request(app).get('/api/audit-logs/acciones').set(bearer(owner));
    expect(r.status).toBe(200);
    const nombres: string[] = r.body.acciones.map((a: { accion: string }) => a.accion);
    expect(nombres).toEqual(expect.arrayContaining(['LOGIN', 'TICKET_CREADO', 'ACCESO_DENEGADO']));
    expect(nombres).toEqual([...nombres].sort());
    const ticket = r.body.acciones.find((a: { accion: string }) => a.accion === 'TICKET_CREADO');
    expect(ticket.total).toBeGreaterThanOrEqual(2);
  });

  it('solo el owner la ve', async () => {
    for (const k of ['adminEmpA', 'adminSucA1', 'agenteA1', 'resA1']) {
      const s = await login(app, fx.email[k]);
      expect([k, (await request(app).get('/api/audit-logs/acciones').set(bearer(s.token))).status]).toEqual([k, 403]);
    }
    expect((await request(app).get('/api/audit-logs/acciones')).status).toBe(401);
  });
});

describe('I-14 /api/audit-logs filtros', () => {
  it('por acción: solo las de esa acción, con su código y su detalle', async () => {
    const r = await logs({ accion: 'TICKET_CREADO' });
    expect(r.status).toBe(200);
    expect(r.body.logs.length).toBeGreaterThanOrEqual(2);
    expect(r.body.logs.every((l: { accion: string }) => l.accion === 'TICKET_CREADO')).toBe(true);
    const bloqueada = r.body.logs.find((l: { status_code: number }) => l.status_code === 429);
    expect(bloqueada.datos_nuevos).toMatchObject({ limite: 'ticket-crear-usuario' });
    expect(bloqueada.usuario_email).toBe(fx.email.resA1.toLowerCase());
    expect(bloqueada.ip_address).toBeTruthy();
  });

  it('por resultado: correctas, bloqueadas por límite, rechazadas y con error', async () => {
    const ok = await logs({ estado: 'ok', accion: 'TICKET_CREADO' });
    expect(ok.body.logs.every((l: { status_code: number }) => l.status_code < 400)).toBe(true);
    expect(ok.body.logs.length).toBeGreaterThanOrEqual(1);

    const bloqueadas = await logs({ estado: 'bloqueado' });
    expect(bloqueadas.body.logs.length).toBeGreaterThanOrEqual(1);
    expect(bloqueadas.body.logs.every((l: { status_code: number }) => l.status_code === 429)).toBe(true);

    const rechazadas = await logs({ estado: 'rechazado' });
    const codigos = new Set<number>(rechazadas.body.logs.map((l: { status_code: number }) => l.status_code));
    expect(codigos.has(429)).toBe(false);
    expect([...codigos].every(c => c >= 400 && c < 500)).toBe(true);
    const denegada = rechazadas.body.logs.find((l: { accion: string; datos_nuevos?: { metodo?: string } }) => l.accion === 'ACCESO_DENEGADO' && l.datos_nuevos?.metodo === 'PUT');
    expect(denegada).toBeTruthy();
    expect(denegada.usuario_email).toBe(fx.email.resA1.toLowerCase());
    expect(denegada.datos_nuevos).toMatchObject({ guarda: 'personal', metodo: 'PUT', rol: 'residente' });
    expect(denegada.datos_nuevos.ruta).toMatch(/^\/api\/tickets\/[0-9a-f-]{36}\/cerrar$/);
    expect(denegada.ip_address).toBeTruthy();

    const errores = await logs({ estado: 'error' });
    expect(errores.body.logs.every((l: { status_code: number }) => l.status_code >= 500)).toBe(true);
  });

  it('un resultado inválido es 400', async () => {
    const r = await logs({ estado: 'cualquiera' });
    expect(r.status).toBe(400);
  });

  it('por persona o por correo intentado (los login fallidos no tienen usuario, pero sí el correo)', async () => {
    const intentado = await logs({ buscar: `nadie.${fx.sufijo}` });
    expect(intentado.body.logs.length).toBeGreaterThanOrEqual(1);
    expect(intentado.body.logs.every((l: { accion: string; usuario_nombre: string | null }) => l.accion === 'LOGIN' && l.usuario_nombre === null)).toBe(true);
    expect(intentado.body.total).toBe(intentado.body.logs.length);

    const persona = await logs({ buscar: fx.email.resA1.slice(0, 12), accion: 'TICKET_CREADO' });
    expect(persona.body.logs.length).toBeGreaterThanOrEqual(2);
    // Los comodines de LIKE se escapan: «%» no devuelve todo.
    const comodin = await logs({ buscar: '%' });
    expect(comodin.body.logs.length).toBe(0);
  });

  it('los filtros se combinan (resultado + acción + fechas)', async () => {
    const hoy = new Date(Date.now() - 6 * 3600_000).toISOString().slice(0, 10);
    const r = await logs({ estado: 'bloqueado', accion: 'TICKET_CREADO', desde: hoy, hasta: hoy });
    expect(r.body.logs.length).toBeGreaterThanOrEqual(1);
    expect(r.body.total).toBeGreaterThanOrEqual(1);
    const nada = await logs({ estado: 'bloqueado', accion: 'TICKET_CREADO', desde: '2000-01-01', hasta: '2000-01-02' });
    expect(nada.body.logs).toHaveLength(0);
    // sanity: la tabla tiene filas de este arreglo
    expect((await q(`SELECT count(*)::int AS n FROM audit_logs WHERE accion = 'TICKET_CREADO'`))[0].n).toBeGreaterThanOrEqual(2);
  });
});
