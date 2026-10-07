/**
 * I-20 · Las horas llegan bien: sin el desfase de 6 h de las columnas TIMESTAMP — SCRUM-124 / S-17 (SCRUM-177)
 *
 * Componentes: Express (app.ts) → controladores → Postgres real. El backend corre con TZ=America/Guatemala (UTC−6) y Postgres en
 *   UTC: con columnas TIMESTAMP sin zona, `pg` leía la hora de reloj de lo que escribe NOW() como si fuera hora local de Node y
 *   cada fecha llegaba 6 h corrida; y un `Date` de Node se guardaba en hora de Guatemala mientras SQL lo leía como UTC.
 * Condición: cada caso hace una acción real por HTTP y compara el INSTANTE que devuelve la API (o lo que ve SQL) con el momento
 *   en que ocurrió, en tiempo absoluto. Se verifica primero que el entorno sea el que reproduce el bug (si no, pasaría en vacío).
 * Resultado esperado: todas las diferencias caben en un margen de segundos/minutos, nunca en horas.
 *   - bitácora: la hora de una fila de auditoría es la de ahora;
 *   - `refresh_tokens` dura 7 días EXACTOS (no 6 d 18 h), al iniciar sesión y al renovar;
 *   - un bloqueo temporal de la lista negra dura lo pedido; el bloqueo de un QR por DPI dura 15 min (no 6 h 15 min);
 *   - una invitación vence a las 72 h; la entrada de un visitante queda con la hora real.
 */
import request from 'supertest';
import { randomUUID } from 'crypto';
import app from '../../app';
import { q, uno, cerrarPool } from '../helpers/db';
import { sembrar, Fixtures } from '../helpers/seed';
import { login, bearer } from '../helpers/auth';
import { INVITACION_TTL_HORAS } from '../../controllers/invitaciones.controller';

let fx: Fixtures;
let owner: string;
let adminEmp: string;
let agente: string;
let adminSuc: string;
let licA1: string;

const MIN = 60_000;
const HORA = 60 * MIN;
const DIA = 24 * HORA;

/** |valor − esperado| en milisegundos. */
const desvio = (iso: string | Date, esperado: number): number => Math.abs(new Date(iso).getTime() - esperado);

beforeAll(async () => {
  // Sin esto la prueba podría pasar en vacío: el desfase solo existe con Node en UTC−6 y Postgres en UTC.
  expect(new Date().getTimezoneOffset()).toBe(360);
  expect((await uno<{ tz: string }>(`SELECT current_setting('TimeZone') AS tz`))!.tz).toMatch(/UTC/);

  fx = await sembrar();
  owner = (await login(app, fx.email.owner)).token!;
  adminEmp = (await login(app, fx.email.adminEmpA)).token!;
  adminSuc = (await login(app, fx.email.adminSucA1)).token!;
  agente = (await login(app, fx.email.agenteA1)).token!;
  const l = fx.licencias.A1;
  const act = await request(app).post('/api/licencias/activar').send({ codigo: l.codigo, fingerprint: l.fingerprint, nombre_dispositivo: 'INT-pc' });
  expect(act.status).toBe(200);
  licA1 = act.body.token_licencia;
});
afterAll(cerrarPool);

describe('I-20 bitácora y sesiones', () => {
  it('la hora de una fila de auditoría es la de ahora (antes llegaba 6 h adelantada)', async () => {
    const antes = Date.now();
    await login(app, fx.email.agenteA1);
    await new Promise(res => setTimeout(res, 300));                             // la fila se escribe al terminar la respuesta
    const r = await request(app).get('/api/audit-logs').query({ accion: 'LOGIN', limit: 1 }).set(bearer(owner));
    expect(r.status).toBe(200);
    expect(r.body.logs.length).toBe(1);
    expect(desvio(r.body.logs[0].created_at, antes)).toBeLessThan(2 * MIN);
  });

  it('el token de refresco dura 7 días EXACTOS al iniciar sesión y al renovar (antes 6 d 18 h)', async () => {
    const s = await login(app, fx.email.resA1);
    const dias = async (cookie: string) => {
      const hash = (await import('crypto')).createHash('sha256').update(cookie.split('=')[1]).digest('hex');
      // La resta la hace Postgres sobre la columna: así se ve lo que ve el SQL (`expires_at > NOW()` en el refresh).
      return Number((await uno<{ d: string }>(`SELECT EXTRACT(EPOCH FROM (expires_at - NOW())) / 86400 AS d FROM refresh_tokens WHERE token_hash = $1`, [hash]))!.d);
    };
    expect(await dias(s.cookie!)).toBeGreaterThan(6.999);
    expect(await dias(s.cookie!)).toBeLessThanOrEqual(7.0001);

    const r = await request(app).post('/api/auth/refresh').set('Cookie', s.cookie!).send({});
    const nueva = ([] as string[]).concat(r.headers['set-cookie']).find(c => c.startsWith('refresh_token='))!.split(';')[0];
    expect(await dias(nueva)).toBeGreaterThan(6.999);
    expect(await dias(nueva)).toBeLessThanOrEqual(7.0001);

    // Y Node lo lee igual que SQL: el instante guardado es ahora + 7 días.
    const hash = (await import('crypto')).createHash('sha256').update(nueva.split('=')[1]).digest('hex');
    const fila = await uno<{ expires_at: Date }>('SELECT expires_at FROM refresh_tokens WHERE token_hash = $1', [hash]);
    expect(desvio(fila!.expires_at, Date.now() + 7 * DIA)).toBeLessThan(2 * MIN);
  });
});

describe('I-20 lista negra, QR e invitaciones', () => {
  it('un bloqueo temporal de la lista negra dura lo pedido (2 días) y la API devuelve ese instante', async () => {
    const r = await request(app).post('/api/blacklist').set(bearer(adminSuc))
      .send({ placa: `Z${Math.floor(100 + Math.random() * 899)}HRS`, razon: 'prueba de horas', duracion: 'temporal_dias', dias: 2 });
    expect(r.status).toBe(201);
    expect(desvio(r.body.fecha_fin, Date.now() + 2 * DIA)).toBeLessThan(2 * MIN);
    // SQL lo ve igual: el bloqueo sigue vigente dentro de 47 h y ya no dentro de 49 h.
    const dias = Number((await uno<{ d: string }>(`SELECT EXTRACT(EPOCH FROM (fecha_fin - NOW())) / 86400 AS d FROM visitante_blacklist WHERE id = $1`, [r.body.id]))!.d);
    expect(dias).toBeGreaterThan(1.99);
    expect(dias).toBeLessThan(2.01);
  });

  it('el bloqueo de una invitación QR por DPI equivocado dura 15 minutos (antes 6 h 15 min)', async () => {
    const inv = (await uno<{ id: string }>(
      `INSERT INTO invitaciones_qr (sucursal_id, residente_id, tipo, nombre_visitante, numero_dpi, fecha_inicio, fecha_fin, usos_maximos)
       VALUES ($1, $2, 'individual', 'Visita', '2999000000009', CURRENT_DATE - 1, CURRENT_DATE + 3, 5) RETURNING id`,
      [fx.sucursales.A1, fx.residentes.A1]))!.id;
    for (let i = 0; i < 5; i++) {                                               // el tope por omisión es 5 fallos
      const r = await request(app).post('/api/accesos').set(bearer(agente)).set('X-Licencia-Token', licA1).send({
        nombre_visitante: 'Otra persona', numero_dpi: `INT-OTRO-${i}-${randomUUID().slice(0, 6)}`, residente_id: fx.residentes.A1,
        invitacion_qr_id: inv, id_cliente: randomUUID(), registrado_en: new Date().toISOString(),
      });
      expect(r.status).toBe(409);
    }
    const snap = await request(app).get('/api/sync/garita').set(bearer(agente)).set('X-Licencia-Token', licA1);
    const fila = snap.body.invitaciones_qr.find((x: { id: string }) => x.id === inv);
    expect(fila.bloqueado_hasta).toBeTruthy();
    expect(desvio(fila.bloqueado_hasta, Date.now() + 15 * MIN)).toBeLessThan(2 * MIN);
  });

  it(`una invitación vence a las ${INVITACION_TTL_HORAS} h y la API devuelve ese instante`, async () => {
    const r = await request(app).post('/api/invitaciones').set(bearer(adminEmp))
      .send({ email: `horas.${fx.sufijo}@inttest.local`, rol_invitado: 'admin_sucursal', sucursal_id: fx.sucursales.A2 });
    expect(r.status).toBe(201);
    expect(desvio(r.body.expira_en, Date.now() + INVITACION_TTL_HORAS * HORA)).toBeLessThan(2 * MIN);
    expect(desvio(r.body.created_at, Date.now())).toBeLessThan(2 * MIN);
  });
});

describe('I-20 garita', () => {
  it('la entrada de un visitante queda con la hora real (registrada y recibida)', async () => {
    const antes = Date.now();
    const r = await request(app).post('/api/accesos').set(bearer(agente)).send({
      nombre_visitante: 'Visita horas', numero_dpi: `INT-H-${randomUUID().slice(0, 8)}`, residente_id: fx.residentes.A1,
    });
    expect(r.status).toBe(201);
    expect(desvio(r.body.registro.timestamp_entrada, antes)).toBeLessThan(2 * MIN);
    expect(desvio(r.body.registro.recibido_en, antes)).toBeLessThan(2 * MIN);

    const activos = await request(app).get('/api/accesos/activos').set(bearer(agente));
    const fila = activos.body.find((a: { registro_id?: string; id?: string }) => (a.registro_id ?? a.id) === r.body.registro.id);
    expect(fila).toBeDefined();
    expect(desvio(fila.timestamp_entrada ?? fila.entrada, antes)).toBeLessThan(2 * MIN);
  });

  it('una columna de fecha y hora de cualquier tabla nunca queda 6 h corrida: la hora de creación de un registro es ahora', async () => {
    const filas = await q<{ d: string }>(
      `SELECT EXTRACT(EPOCH FROM (NOW() - created_at)) AS d FROM empresas WHERE id = $1`, [fx.empresas.A]);
    expect(Math.abs(Number(filas[0].d))).toBeLessThan(10 * MIN / 1000);        // la empresa se sembró hace segundos
    const jsDate = (await uno<{ created_at: Date }>('SELECT created_at FROM empresas WHERE id = $1', [fx.empresas.A]))!.created_at;
    expect(desvio(jsDate, Date.now())).toBeLessThan(10 * MIN);                  // y Node la lee con el mismo instante
  });
});
