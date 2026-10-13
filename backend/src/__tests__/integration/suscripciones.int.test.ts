/**
 * I-24 · Planes, suscripciones y medición de uso (integración) — T10, Sprint 9 continuación
 *
 * Componentes: Express (app.ts) → /api/planes, /api/empresas/:id/{suscripcion,uso}, /api/sucursales, /api/licencias →
 *   planes.controller + services/suscripciones → Postgres real. Sin mocks.
 * Condición: los planes sembrados por la migración son SUPUESTOS a confirmar (docs/saas_nucleo.md); estos tests no dependen de sus precios
 *   (crean sus propios planes) salvo para comprobar que existen y están marcados como supuestos.
 * Resultado esperado:
 *   - la migración es idempotente: correrla otra vez no duplica ni pisa los precios editados;
 *   - el catálogo lo edita solo el owner; el dinero solo entra en centavos enteros;
 *   - la suscripción de cada empresa empieza en prueba, cambia de plan/estado dejando histórico, y cada admin solo ve la suya (404 al cruzar);
 *   - el uso cuenta visitas por MES CALENDARIO de America/Guatemala (30-sep 23:59:59 es septiembre, 1-oct 00:00:00 es octubre, aunque en UTC
 *     ya sea otro día), sin contar rechazados ni duplicados por id_cliente, y no mezcla empresas;
 *   - los límites de sucursales y garitas del plan se hacen cumplir (403 LIMITE_PLAN), también con altas simultáneas.
 */
import request from 'supertest';
import { randomUUID } from 'crypto';
import app from '../../app';
import { q, uno, cerrarPool } from '../helpers/db';
import { sembrar, Fixtures } from '../helpers/seed';
import { login, bearer } from '../helpers/auth';
import { runMigrations } from '../../db/migrate';

let fx: Fixtures;
const token: Record<string, string> = {};
const uid = () => randomUUID().slice(0, 8);
const as = (k: string) => bearer(token[k]);

/** La auditoría se escribe al terminar la respuesta, sin esperar: se consulta hasta que aparezca (máx. 3 s). */
const auditada = async (accion: string, usuarioId: string) => {
  const limite = Date.now() + 3000;
  for (;;) {
    const f = await q(`SELECT status_code FROM audit_logs WHERE accion = $1 AND usuario_id = $2`, [accion, usuarioId]);
    if (f.length || Date.now() > limite) return f.length > 0;
    await new Promise(r => setTimeout(r, 50));
  }
};

beforeAll(async () => {
  fx = await sembrar();
  for (const k of ['owner', 'adminEmpA', 'adminEmpB', 'adminSucA1', 'agenteA1']) token[k] = (await login(app, fx.email[k])).token!;
});
afterAll(cerrarPool);

const empresaNueva = async () =>
  (await uno<{ id: string }>(`INSERT INTO empresas (nombre) VALUES ($1) RETURNING id`, [`SUS Empresa ${uid()}`]))!.id;
const sucursalNueva = async (empresaId: string) =>
  (await uno<{ id: string }>(`INSERT INTO sucursales (empresa_id, nombre) VALUES ($1, $2) RETURNING id`, [empresaId, `SUS Sucursal ${uid()}`]))!.id;
const planNuevo = async (extra: Record<string, unknown> = {}) => {
  const r = await request(app).post('/api/planes').set(as('owner')).send({
    codigo: `sus-${uid()}`, nombre: 'Plan de prueba', precio_mensual_centavos: 10000, visitas_incluidas: 2, precio_visita_extra_centavos: 75, ...extra,
  });
  expect(r.status).toBe(201);
  return r.body as { id: string; codigo: string };
};
const asignar = (empresaId: string, planId: string, extra: object = {}) =>
  request(app).put(`/api/empresas/${empresaId}/suscripcion`).set(as('owner')).send({ plan_id: planId, ...extra });

/** Inserta una visita directo en la base (la ruta real exige el flujo de garita completo; aquí se prueba la medición). */
const visitante = async () => (await uno<{ id: string }>(`INSERT INTO visitantes (nombre, numero_dpi) VALUES ('SUS visitante', $1) RETURNING id`, [`SUS-${randomUUID()}`.slice(0, 20)]))!.id;
const visita = async (sucursalId: string, cuando: string, opts: { autorizado?: boolean; idCliente?: string } = {}) => {
  const v = await visitante();
  return q(
    `INSERT INTO registros_acceso (sucursal_id, visitante_id, residente_id, agente_id, tipo, timestamp_entrada, autorizado, id_cliente)
     VALUES ($1, $2, $3, $4, 'entrada', $5::timestamptz, $6, $7) ON CONFLICT DO NOTHING`,
    [sucursalId, v, fx.residentes.A1, fx.usuarios.agenteA1, cuando, opts.autorizado ?? true, opts.idCliente ?? null],
  );
};
const uso = (k: string, empresaId: string, mes?: string) =>
  request(app).get(`/api/empresas/${empresaId}/uso${mes ? `?mes=${mes}` : ''}`).set(as(k));

describe('I-24 migración y catálogo', () => {
  it('siembra tres planes marcados como supuestos y la migración es idempotente', async () => {
    const sembrados = `codigo IN ('basico', 'estandar', 'profesional')`;                 // otras pruebas crean planes propios
    const antes = await q(`SELECT codigo, supuesto, precio_mensual_centavos::text AS p FROM planes WHERE ${sembrados} ORDER BY orden`);
    expect(antes.map(p => p.codigo)).toEqual(['basico', 'estandar', 'profesional']);
    expect(antes.every(p => p.supuesto === true)).toBe(true);

    // El owner "confirma" un precio; volver a migrar no debe pisarlo ni duplicar filas.
    await q(`UPDATE planes SET precio_mensual_centavos = 31337 WHERE codigo = 'basico'`);
    await runMigrations();
    await runMigrations();
    const despues = await q(`SELECT codigo, precio_mensual_centavos::text AS p FROM planes WHERE ${sembrados} ORDER BY orden`);
    expect(despues).toHaveLength(3);
    expect(despues[0].p).toBe('31337');
    await q(`UPDATE planes SET precio_mensual_centavos = $1 WHERE codigo = 'basico'`, [antes[0].p]);
  });

  it('el catálogo lo ve un admin de empresa, pero solo el owner lo edita', async () => {
    const ver = await request(app).get('/api/planes').set(as('adminEmpA'));
    expect(ver.status).toBe(200);
    expect(ver.body.length).toBeGreaterThanOrEqual(3);
    expect(typeof ver.body[0].precio_mensual_centavos).toBe('number');

    const body = { codigo: `x-${uid()}`, nombre: 'N', precio_mensual_centavos: 100, visitas_incluidas: 1, precio_visita_extra_centavos: 1 };
    expect((await request(app).post('/api/planes').set(as('adminEmpA')).send(body)).status).toBe(403);
    expect((await request(app).get('/api/planes').set(as('adminSucA1'))).status).toBe(403);
    expect((await request(app).get('/api/planes').set(as('agenteA1'))).status).toBe(403);
    expect((await request(app).put(`/api/planes/${randomUUID()}`).set(as('adminEmpA')).send({ nombre: 'x' })).status).toBe(403);
  });

  it('valida el plan: dinero solo en centavos enteros, código único, límites razonables', async () => {
    const base = { codigo: `v-${uid()}`, nombre: 'V', precio_mensual_centavos: 100, visitas_incluidas: 1, precio_visita_extra_centavos: 1 };
    const post = (b: object) => request(app).post('/api/planes').set(as('owner')).send(b);
    expect((await post({ ...base, precio_mensual_centavos: 99.5 })).status).toBe(400);          // decimales: nunca float
    expect((await post({ ...base, precio_mensual_centavos: '100' })).status).toBe(400);         // texto
    expect((await post({ ...base, precio_visita_extra_centavos: -1 })).status).toBe(400);
    expect((await post({ ...base, max_sucursales: 0 })).status).toBe(400);
    expect((await post({ ...base, codigo: 'Con Espacios' })).status).toBe(400);
    expect((await post({ ...base, dias_prueba: 400 })).status).toBe(400);
    const ok = await post(base);
    expect(ok.status).toBe(201);
    expect(ok.body).toMatchObject({ precio_mensual_centavos: 100, max_sucursales: null, supuesto: true, moneda: 'GTQ' });
    expect((await post(base)).status).toBe(409);                                                // código repetido

    const ed = await request(app).put(`/api/planes/${ok.body.id}`).set(as('owner')).send({ precio_mensual_centavos: 12345, max_garitas: 4 });
    expect(ed.body).toMatchObject({ precio_mensual_centavos: 12345, max_garitas: 4 });
    expect((await request(app).put(`/api/planes/${ok.body.id}`).set(as('owner')).send({})).status).toBe(400);
    expect((await request(app).put(`/api/planes/${randomUUID()}`).set(as('owner')).send({ nombre: 'z' })).status).toBe(404);
  });

  it('crear y editar planes queda en la auditoría', async () => {
    const p = await planNuevo();
    expect(await auditada('PLAN_CREADO', fx.usuarios.owner)).toBe(true);
    await request(app).put(`/api/planes/${p.id}`).set(as('owner')).send({ nombre: 'Editado' });
    expect(await auditada('PLAN_ACTUALIZADO', fx.usuarios.owner)).toBe(true);
  });
});

describe('I-24 suscripción por empresa', () => {
  it('nace en prueba con los días del plan, cambia de plan/estado y deja histórico', async () => {
    const e = await empresaNueva();
    const p1 = await planNuevo({ dias_prueba: 10 });
    const p2 = await planNuevo();

    const alta = await asignar(e, p1.id, { motivo: 'Alta de prueba' });
    expect(alta.status).toBe(200);
    expect(alta.body.suscripcion).toMatchObject({ estado: 'prueba', ciclo: 'mensual', plan: { codigo: p1.codigo } });
    const dias = (new Date(alta.body.suscripcion.prueba_hasta).getTime() - Date.now()) / 86_400_000;
    expect(dias).toBeGreaterThan(9.9); expect(dias).toBeLessThan(10.1);

    expect((await asignar(e, p2.id, { estado: 'activa', motivo: 'Pagó' })).body.suscripcion).toMatchObject({ estado: 'activa', plan: { codigo: p2.codigo } });
    // Repetir lo mismo no inventa un cambio.
    await asignar(e, p2.id, { estado: 'activa' });
    expect((await request(app).put(`/api/empresas/${e}/suscripcion`).set(as('owner')).send({ estado: 'cancelada', motivo: 'Se fue' })).body.suscripcion)
      .toMatchObject({ estado: 'cancelada' });

    const h = await request(app).get(`/api/empresas/${e}/suscripcion/historial`).set(as('owner'));
    expect(h.status).toBe(200);
    expect(h.body).toHaveLength(3);                                                              // alta, plan+estado, cancelación
    expect(h.body.map((f: any) => f.estado_nuevo)).toEqual(['cancelada', 'activa', 'prueba']);   // más reciente primero
    expect(h.body[1]).toMatchObject({ plan_anterior: p1.codigo, plan_nuevo: p2.codigo, estado_anterior: 'prueba', motivo: 'Pagó' });
    expect(h.body[2]).toMatchObject({ plan_anterior: null, plan_nuevo: p1.codigo });
    expect(await auditada('SUSCRIPCION_ACTUALIZADA', fx.usuarios.owner)).toBe(true);
  });

  it('rechaza estados y planes inválidos, y sin suscripción exige plan', async () => {
    const e = await empresaNueva();
    const put = (b: object) => request(app).put(`/api/empresas/${e}/suscripcion`).set(as('owner')).send(b);
    expect((await put({ estado: 'gratis' })).status).toBe(400);
    expect((await put({ estado: 'activa' })).status).toBe(400);                                  // no hay suscripción ni plan
    expect((await put({})).status).toBe(400);
    expect((await put({ plan_id: 'no-uuid' })).status).toBe(400);
    expect((await put({ plan_id: randomUUID() })).status).toBe(404);
    expect((await put({ plan_codigo: 'no-existe' })).status).toBe(404);
    const inactivo = await planNuevo();
    await request(app).put(`/api/planes/${inactivo.id}`).set(as('owner')).send({ activo: false });
    expect((await put({ plan_id: inactivo.id })).status).toBe(404);                              // un plan retirado no se asigna
    expect((await request(app).put(`/api/empresas/${randomUUID()}/suscripcion`).set(as('owner')).send({ plan_codigo: 'basico' })).status).toBe(404);
  });

  it('aislamiento: el admin de empresa solo ve la suya y no puede cambiarla', async () => {
    const pA = await planNuevo(); const pB = await planNuevo();
    await asignar(fx.empresas.A, pA.id);
    await asignar(fx.empresas.B, pB.id);

    const propia = await request(app).get(`/api/empresas/${fx.empresas.A}/suscripcion`).set(as('adminEmpA'));
    expect(propia.status).toBe(200);
    expect(propia.body.suscripcion.plan.codigo).toBe(pA.codigo);

    for (const ruta of ['suscripcion', 'suscripcion/historial', 'uso']) {
      const cruce = await request(app).get(`/api/empresas/${fx.empresas.B}/${ruta}`).set(as('adminEmpA'));
      expect(cruce.status).toBe(404);                                                            // igual que "no existe": no confirma la otra empresa
      expect(JSON.stringify(cruce.body)).not.toContain(pB.codigo);
    }
    expect((await request(app).put(`/api/empresas/${fx.empresas.A}/suscripcion`).set(as('adminEmpA')).send({ plan_id: pB.id })).status).toBe(403);
    expect((await request(app).get(`/api/empresas/${fx.empresas.A}/suscripcion`).set(as('adminSucA1'))).status).toBe(403);
    expect((await request(app).get('/api/planes/uso').set(as('adminEmpA'))).status).toBe(403);
    // Para no afectar otras pruebas del archivo, A y B vuelven a no tener límites del plan de prueba.
    await q(`DELETE FROM suscripcion_historial WHERE empresa_id = ANY($1::uuid[])`, [[fx.empresas.A, fx.empresas.B]]);
    await q(`DELETE FROM suscripciones WHERE empresa_id = ANY($1::uuid[])`, [[fx.empresas.A, fx.empresas.B]]);
  });

  it('borrar definitivamente una empresa con suscripción también borra su suscripción e histórico', async () => {
    const e = await empresaNueva();
    const p = await planNuevo();
    await asignar(e, p.id);
    const r = await request(app).post(`/api/empresas/${e}/eliminar-definitivo`).set(as('owner')).send({ password: 'Prueba#2026a' });
    expect(r.status).toBe(200);
    expect(r.body.eliminado).toMatchObject({ suscripciones: 1, suscripcion_historial: 1 });
    expect(await q(`SELECT 1 FROM suscripciones WHERE empresa_id = $1`, [e])).toHaveLength(0);
  });
});

describe('I-24 medición de uso (mes calendario de America/Guatemala)', () => {
  it('la frontera de mes se decide en hora de Guatemala, no en UTC', async () => {
    const e = await empresaNueva(); const s = await sucursalNueva(e);
    // 30-sep 23:59:59 en Guatemala (UTC-6) = 1-oct 05:59:59 UTC → sigue siendo septiembre.
    await visita(s, '2031-09-30 23:59:59-06');
    await visita(s, '2031-10-01 05:59:59+00');
    // 1-oct 00:00:00 Guatemala = 06:00:00 UTC → octubre.
    await visita(s, '2031-10-01 00:00:00-06');
    // 31-ago 23:59:59 Guatemala (= 1-sep 05:59:59 UTC) → agosto; 1-sep 00:00:00 Guatemala → septiembre.
    await visita(s, '2031-08-31 23:59:59-06');
    await visita(s, '2031-09-01 00:00:00-06');

    const mes = async (m: string) => (await uso('owner', e, m)).body.visitas;
    expect(await mes('2031-08')).toBe(1);
    expect(await mes('2031-09')).toBe(3);
    expect(await mes('2031-10')).toBe(1);
    expect(await mes('2031-11')).toBe(0);
  });

  it('no cuenta rechazados y cuenta una sola vez el duplicado idempotente por id_cliente', async () => {
    const e = await empresaNueva(); const s = await sucursalNueva(e);
    await visita(s, '2032-03-10 10:00:00-06');
    await visita(s, '2032-03-11 10:00:00-06', { autorizado: false });
    await visita(s, '2032-03-12 10:00:00-06', { autorizado: false });
    const idc = randomUUID();
    await visita(s, '2032-03-13 10:00:00-06', { idCliente: idc });
    await visita(s, '2032-03-13 10:00:01-06', { idCliente: idc });                              // reenvío de la cola offline: el índice único lo descarta
    expect(await q(`SELECT 1 FROM registros_acceso WHERE sucursal_id = $1`, [s])).toHaveLength(4);
    expect((await uso('owner', e, '2032-03')).body.visitas).toBe(2);
  });

  it('calcula incluidas, excedente y su costo en centavos con el plan de la empresa', async () => {
    const e = await empresaNueva(); const s = await sucursalNueva(e);
    const p = await planNuevo({ visitas_incluidas: 2, precio_visita_extra_centavos: 75 });
    await asignar(e, p.id);
    for (let d = 1; d <= 5; d++) await visita(s, `2033-05-0${d} 09:00:00-06`);
    const r = await uso('owner', e, '2033-05');
    expect(r.body).toEqual({ periodo: '2033-05', visitas: 5, incluidas: 2, excedente: 3, excedente_centavos: 225, plan: p.codigo });
    expect((await uso('owner', e, '2033-06')).body).toMatchObject({ visitas: 0, excedente: 0, excedente_centavos: 0 });
  });

  it('sin mes pide el mes actual de Guatemala y valida el formato', async () => {
    const e = await empresaNueva();
    const r = await uso('owner', e);
    const ahora = await uno<{ m: string }>(`SELECT to_char(NOW() AT TIME ZONE 'America/Guatemala', 'YYYY-MM') AS m`);
    expect(r.body.periodo).toBe(ahora!.m);
    for (const malo of ['2031-13', '2031-00', '31-09', 'septiembre', '2031-9']) expect((await uso('owner', e, malo)).status).toBe(400);
    expect((await request(app).get(`/api/empresas/${e}/uso?mes=2031-01&mes=2031-02`).set(as('owner'))).status).toBe(400);
  });

  it('no mezcla empresas: cada una cuenta solo sus sucursales, y el panel del owner las separa', async () => {
    const e1 = await empresaNueva(); const e2 = await empresaNueva();
    const s1 = await sucursalNueva(e1); const s1b = await sucursalNueva(e1); const s2 = await sucursalNueva(e2);
    await visita(s1, '2034-02-02 08:00:00-06'); await visita(s1b, '2034-02-03 08:00:00-06'); await visita(s2, '2034-02-04 08:00:00-06');
    expect((await uso('owner', e1, '2034-02')).body.visitas).toBe(2);
    expect((await uso('owner', e2, '2034-02')).body.visitas).toBe(1);
    const todas = await request(app).get('/api/planes/uso?mes=2034-02').set(as('owner'));
    expect(todas.status).toBe(200);
    const porId = Object.fromEntries(todas.body.empresas.map((f: any) => [f.empresa_id, f.visitas]));
    expect(porId[e1]).toBe(2); expect(porId[e2]).toBe(1);
    // Un admin de empresa ve su propio consumo y nunca el de otra.
    expect((await uso('adminEmpA', fx.empresas.A, '2034-02')).status).toBe(200);
    expect((await uso('adminEmpA', e1, '2034-02')).status).toBe(404);
  });

  it('el plan de consultas usa el índice parcial (sin recorrer toda la tabla)', async () => {
    const plan = await q(`EXPLAIN SELECT COUNT(*) FROM registros_acceso WHERE sucursal_id = $1 AND autorizado = TRUE
                          AND timestamp_entrada >= '2031-09-01' AND timestamp_entrada < '2031-10-01'`.replace('$1', `'${randomUUID()}'`));
    const texto = plan.map(f => f['QUERY PLAN']).join('\n');
    expect(texto).toMatch(/idx_registros_acceso_sucursal_entrada|Index|Bitmap|Result/);
    const idx = await uno(`SELECT 1 FROM pg_indexes WHERE indexname = 'idx_registros_acceso_sucursal_entrada'`);
    expect(idx).toBeTruthy();
  });
});

describe('I-24 límites del plan', () => {
  it('sucursales: el plan manda; al llegar al tope responde 403 LIMITE_PLAN, y sin suscripción no hay tope', async () => {
    const e = await empresaNueva();
    const p = await planNuevo({ max_sucursales: 2 });
    await asignar(e, p.id);
    const crear = () => request(app).post('/api/sucursales').set(as('owner')).send({ empresa_id: e, nombre: `SUS ${uid()}` });
    expect((await crear()).status).toBe(201);
    expect((await crear()).status).toBe(201);
    const tercera = await crear();
    expect(tercera.status).toBe(403);
    expect(tercera.body).toMatchObject({ codigo: 'LIMITE_PLAN', limite: 2, usados: 2 });
    expect(tercera.body.error).toMatch(/hasta 2 sucursales/);
    expect(await q(`SELECT 1 FROM sucursales WHERE empresa_id = $1`, [e])).toHaveLength(2);

    // Subir de plan abre cupo.
    const grande = await planNuevo({ max_sucursales: null });
    await asignar(e, grande.id);
    expect((await crear()).status).toBe(201);

    const libre = await empresaNueva();                                                          // sin suscripción: sin límites (empresas anteriores a los planes)
    for (let i = 0; i < 3; i++) {
      expect((await request(app).post('/api/sucursales').set(as('owner')).send({ empresa_id: libre, nombre: `L ${i} ${uid()}` })).status).toBe(201);
    }
  });

  it('sucursales: altas simultáneas no se pasan del límite', async () => {
    const e = await empresaNueva();
    await asignar(e, (await planNuevo({ max_sucursales: 3 })).id);
    const rs = await Promise.all(Array.from({ length: 8 }, (_, i) =>
      request(app).post('/api/sucursales').set(as('owner')).send({ empresa_id: e, nombre: `Conc ${i} ${uid()}` })));
    expect(rs.filter(r => r.status === 201)).toHaveLength(3);
    expect(rs.filter(r => r.status === 403 && r.body.codigo === 'LIMITE_PLAN')).toHaveLength(5);
    expect(await q(`SELECT 1 FROM sucursales WHERE empresa_id = $1`, [e])).toHaveLength(3);
  });

  it('un admin de empresa topado por su plan recibe el mismo 403, sin tocar otra empresa', async () => {
    const e = await empresaNueva();
    await asignar(e, (await planNuevo({ max_sucursales: 1 })).id);
    await sucursalNueva(e);
    const otro = await request(app).post('/api/sucursales').set(as('adminEmpA')).send({ empresa_id: e, nombre: 'cruce' });
    expect(otro.status).toBe(403);
    expect(otro.body.codigo).toBeUndefined();                                                    // 403 por alcance, no por plan
  });

  it('garitas: el tope cuenta licencias no revocadas y revocar libera el cupo; también bajo concurrencia', async () => {
    const e = await empresaNueva(); const s = await sucursalNueva(e);
    await asignar(e, (await planNuevo({ max_garitas: 2 })).id);
    const emitir = () => request(app).post('/api/licencias').set(as('owner')).send({ sucursal_id: s, etiqueta: 'SUS' });
    const a = await emitir(); expect(a.status).toBe(201);
    expect((await emitir()).status).toBe(201);
    const tercera = await emitir();
    expect(tercera.status).toBe(403);
    expect(tercera.body).toMatchObject({ codigo: 'LIMITE_PLAN', limite: 2, usados: 2 });
    expect(tercera.body.error).toMatch(/garitas/);

    expect((await request(app).patch(`/api/licencias/${a.body.id}/revocar`).set(as('owner'))).status).toBe(200);
    expect((await emitir()).status).toBe(201);                                                   // la revocada libera un cupo

    const e2 = await empresaNueva(); const s2 = await sucursalNueva(e2);
    await asignar(e2, (await planNuevo({ max_garitas: 2 })).id);
    const rs = await Promise.all(Array.from({ length: 6 }, () => request(app).post('/api/licencias').set(as('owner')).send({ sucursal_id: s2 })));
    expect(rs.filter(r => r.status === 201)).toHaveLength(2);
    expect(await q(`SELECT 1 FROM licencias_dispositivo WHERE sucursal_id = $1`, [s2])).toHaveLength(2);
  });
});
