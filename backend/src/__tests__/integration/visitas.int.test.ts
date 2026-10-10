/**
 * I-9 · Avisos de visita (preautorizaciones): fechas, duplicados y «visitante guardado» — SCRUM-114 / H10
 *
 * Componentes: Express (app.ts) → /api/preautorizaciones, /api/accesos, /api/sync/garita →
 *   controllers → Postgres real (preautorizaciones, registros_acceso). Sin mocks.
 * Qué es cada fila: con `fecha_fin` es un aviso de visita (vale para entrar entre las dos fechas); SIN `fecha_fin`
 *   es un «visitante guardado» de la libreta del residente, que NO autoriza nada.
 * Resultado esperado:
 *   - el alta del administrador exige `fecha_fin`, un formato AAAA-MM-DD y un fin no anterior al inicio (400);
 *   - un aviso idéntico (misma persona o vehículo y mismas fechas) se rechaza con 409; dos visitantes distintos en el
 *     mismo carro, o la misma persona en otras fechas, sí se aceptan;
 *   - un visitante guardado no marca la entrada como preautorizada ni viaja en el padrón de la garita; al avisar de su
 *     visita (con fechas) sí;
 *   - el residente solo ve y borra lo suyo.
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

const dia = (desplazarDias: number) => new Date(Date.now() - 6 * 3600_000 + desplazarDias * 86400_000).toISOString().slice(0, 10);
const hoy = () => dia(0);
const manana = () => dia(1);
const dpiUnico = () => `INT-DPI-${randomUUID().slice(0, 8)}`;

const aviso = (token: string | undefined, body: object) =>
  request(app).post('/api/preautorizaciones').set(bearer(token)).send({ residente_id: fx.residentes.A1, nombre_visitante: 'Visita', ...body });
const guardado = (token: string | undefined, body: object) =>
  request(app).post('/api/preautorizaciones/mis').set(bearer(token)).send({ nombre_visitante: 'Visita', ...body });

describe('I-9 alta del administrador: fechas', () => {
  it('exige fecha_fin y deja claro por qué', async () => {
    const admin = await login(app, fx.email.adminSucA1);
    const r = await aviso(admin.token, { numero_dpi: dpiUnico(), fecha_inicio: hoy() });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/fecha_fin es requerida/);
    expect((await aviso(admin.token, { numero_dpi: dpiUnico(), fecha_inicio: hoy(), fecha_fin: '' })).status).toBe(400);
  });

  it('rechaza fechas con formato inválido (incluida una que no existe) y un fin anterior al inicio', async () => {
    const admin = await login(app, fx.email.adminSucA1);
    for (const mala of ['mañana', '2026-13-45', '2026-02-31', '01/02/2026', 20260101]) {
      const r = await aviso(admin.token, { numero_dpi: dpiUnico(), fecha_inicio: mala, fecha_fin: manana() });
      expect([mala, r.status]).toEqual([mala, 400]);
    }
    const mal = await aviso(admin.token, { numero_dpi: dpiUnico(), fecha_inicio: manana(), fecha_fin: hoy() });
    expect(mal.status).toBe(400);
    expect(mal.body.error).toMatch(/no puede ser anterior/);
    const finMalo = await aviso(admin.token, { numero_dpi: dpiUnico(), fecha_inicio: hoy(), fecha_fin: '2026-99-99' });
    expect(finMalo.status).toBe(400);
  });

  it('con fechas coherentes crea el aviso (una sola visita: mismo día en las dos fechas)', async () => {
    const admin = await login(app, fx.email.adminSucA1);
    const r = await aviso(admin.token, { numero_dpi: dpiUnico(), fecha_inicio: hoy(), fecha_fin: hoy() });
    expect(r.status).toBe(201);
    expect(r.body.fecha_fin).toBeTruthy();
  });
});

describe('I-9 duplicados', () => {
  it('el mismo aviso dos veces → 409 con el id del existente; otras fechas o el mismo carro con otro DPI sí se aceptan', async () => {
    const admin = await login(app, fx.email.adminSucA1);
    const dpi = dpiUnico();
    const primero = await aviso(admin.token, { numero_dpi: dpi, placa: 'P-700 AAA', fecha_inicio: hoy(), fecha_fin: manana() });
    expect(primero.status).toBe(201);

    const repetido = await aviso(admin.token, { numero_dpi: dpi, placa: 'p700aaa', fecha_inicio: hoy(), fecha_fin: manana() });
    expect(repetido.status).toBe(409);
    expect(repetido.body.error).toMatch(/ya está avisada/);
    expect(repetido.body.id).toBe(primero.body.id);
    expect((await q('SELECT 1 FROM preautorizaciones WHERE residente_id = $1 AND numero_dpi = $2', [fx.residentes.A1, dpi]))).toHaveLength(1);

    // La misma persona en otras fechas es un aviso nuevo.
    expect((await aviso(admin.token, { numero_dpi: dpi, placa: 'P-700 AAA', fecha_inicio: dia(5), fecha_fin: dia(6) })).status).toBe(201);
    // Otro pasajero (otro DPI) en el mismo carro y fechas: no es duplicado.
    expect((await aviso(admin.token, { numero_dpi: dpiUnico(), placa: 'P-700 AAA', fecha_inicio: hoy(), fecha_fin: manana() })).status).toBe(201);
  });

  it('un aviso solo de placa se reconoce repetido aunque se escriba distinto', async () => {
    const admin = await login(app, fx.email.adminSucA1);
    expect((await aviso(admin.token, { placa: 'P-810 BBB', fecha_inicio: hoy(), fecha_fin: manana() })).status).toBe(201);
    const otra = await aviso(admin.token, { placa: ' p810-bbb ', fecha_inicio: hoy(), fecha_fin: manana() });
    expect(otra.status).toBe(409);
  });

  it('el duplicado se mira dentro del residente: otra casa puede avisar de la misma visita', async () => {
    const admin = await login(app, fx.email.adminSucA1);
    const dpi = dpiUnico();
    expect((await aviso(admin.token, { numero_dpi: dpi, fecha_inicio: hoy(), fecha_fin: manana() })).status).toBe(201);
    const adminA2 = await login(app, fx.email.adminSucA2);
    const otraCasa = await request(app).post('/api/preautorizaciones').set(bearer(adminA2.token)).send({
      residente_id: fx.residentes.A2, nombre_visitante: 'Visita', numero_dpi: dpi, fecha_inicio: hoy(), fecha_fin: manana(),
    });
    expect(otraCasa.status).toBe(201);
  });
});

describe('I-9 visitante guardado (libreta del residente)', () => {
  it('guardar sin fecha_fin funciona, no se repite aunque se guarde otro día y NO autoriza entradas', async () => {
    const res = await login(app, fx.email.resA1);
    const staff = await login(app, fx.email.agenteA1);
    const dpi = dpiUnico();

    const g = await guardado(res.token, { numero_dpi: dpi, fecha_inicio: hoy() });
    expect(g.status).toBe(201);
    expect(g.body.fecha_fin).toBeNull();

    const otroDia = await guardado(res.token, { numero_dpi: dpi, fecha_inicio: dia(-3) });
    expect(otroDia.status).toBe(409);
    expect(otroDia.body.error).toMatch(/ya está guardado/);

    // Guardado ≠ aviso: la garita no lo toma por preautorizado.
    const busca = await request(app).get('/api/preautorizaciones/buscar').query({ dpi }).set(bearer(staff.token));
    expect(busca.status).toBe(404);
    const entrada = await request(app).post('/api/accesos').set(bearer(staff.token))
      .send({ nombre_visitante: 'Visita', numero_dpi: dpi, residente_id: fx.residentes.A1 });
    expect(entrada.status).toBe(201);
    expect(entrada.body.preautorizado).toBe(false);
  });

  it('«avisar para hoy» a partir del guardado crea el aviso con fechas, y repetirlo es 409', async () => {
    const res = await login(app, fx.email.resA1);
    const staff = await login(app, fx.email.agenteA1);
    const dpi = dpiUnico();
    expect((await guardado(res.token, { numero_dpi: dpi, fecha_inicio: hoy() })).status).toBe(201);

    const avisar = () => guardado(res.token, { numero_dpi: dpi, fecha_inicio: hoy(), fecha_fin: manana() });
    const a = await avisar();
    expect(a.status).toBe(201);
    expect((await avisar()).status).toBe(409);

    const busca = await request(app).get('/api/preautorizaciones/buscar').query({ dpi }).set(bearer(staff.token));
    expect(busca.status).toBe(200);
    const entrada = await request(app).post('/api/accesos').set(bearer(staff.token))
      .send({ nombre_visitante: 'Visita', numero_dpi: dpi, residente_id: fx.residentes.A1 });
    expect(entrada.body.preautorizado).toBe(true);
  });

  it('el residente valida sus fechas igual que el administrador y solo ve lo suyo', async () => {
    const res = await login(app, fx.email.resA1);
    const mal = await guardado(res.token, { numero_dpi: dpiUnico(), fecha_inicio: manana(), fecha_fin: hoy() });
    expect(mal.status).toBe(400);
    expect((await guardado(res.token, { numero_dpi: dpiUnico(), fecha_inicio: 'ayer' })).status).toBe(400);

    const propia = await guardado(res.token, { numero_dpi: dpiUnico(), fecha_inicio: hoy(), fecha_fin: manana() });
    expect(propia.status).toBe(201);
    const mias = await request(app).get('/api/preautorizaciones/mis').set(bearer(res.token));
    expect(mias.body.map((p: { id: string }) => p.id)).toContain(propia.body.id);

    const otro = await login(app, fx.email.resA2);
    const lasDeOtro = await request(app).get('/api/preautorizaciones/mis').set(bearer(otro.token));
    expect(lasDeOtro.body.map((p: { id: string }) => p.id)).not.toContain(propia.body.id);
    expect((await request(app).delete(`/api/preautorizaciones/mis/${propia.body.id}`).set(bearer(otro.token))).status).toBe(404);
  });
});

describe('I-9 padrón de la garita', () => {
  it('trae los avisos con fecha de fin y no los visitantes guardados', async () => {
    const act = await request(app).post('/api/licencias/activar')
      .send({ codigo: fx.licencias.A1.codigo, fingerprint: fx.licencias.A1.fingerprint, nombre_dispositivo: 'INT-pc-visitas' });
    expect(act.status).toBe(200);
    const agente = await login(app, fx.email.agenteA1);
    const res = await login(app, fx.email.resA1);
    const admin = await login(app, fx.email.adminSucA1);

    const guardadoId = (await guardado(res.token, { numero_dpi: dpiUnico(), fecha_inicio: hoy() })).body.id;
    const avisoId = (await aviso(admin.token, { numero_dpi: dpiUnico(), fecha_inicio: hoy(), fecha_fin: manana() })).body.id;
    expect(await uno('SELECT 1 AS x FROM preautorizaciones WHERE id = $1', [guardadoId])).toBeTruthy();

    const snap = await request(app).get('/api/sync/garita').set(bearer(agente.token)).set('X-Licencia-Token', act.body.token_licencia);
    expect(snap.status).toBe(200);
    const ids: string[] = snap.body.preautorizaciones.map((p: { id: string }) => p.id);
    expect(ids).toContain(avisoId);
    expect(ids).not.toContain(guardadoId);
  });
});
