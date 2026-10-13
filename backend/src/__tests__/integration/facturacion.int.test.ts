/**
 * I-25 · Facturación SaaS mensual, cobro manual y avisos de pago vencido (integración) — T11, Sprint 9 continuación
 *
 * Componentes: Express (app.ts) → /api/facturas-saas, /api/empresas/:id/facturas → facturas.controller + services/facturacion + cobros →
 *   Postgres real (facturas_saas, facturas_saas_avisos, saas_contadores). Sin mocks; el correo se captura con un transporte de prueba.
 * Condición: las suscripciones se atrasan por SQL (inicio_en, prueba_hasta, cancelada_en) para tener meses cerrados en el pasado.
 * Resultado esperado:
 *   - una factura por empresa y mes (el job es idempotente), con número correlativo sin huecos, cuota + excedente en centavos, mes parcial por
 *     prueba o cancelación, y solo las visitas autorizadas de los días cobrados;
 *   - no se factura un mes que no terminó; sin suscripción o a Q0 no se genera nada;
 *   - cada admin solo ve las facturas de su empresa (cruce = 404); marcar pagada/anular es del owner, con 409 si el estado no lo permite;
 *   - el cobro es manual (referencia obligatoria en transferencia/depósito) y Visanet falla de forma controlada (503, factura intacta);
 *   - las vencidas se marcan por fecha de Guatemala; el aviso de pago vencido sale una sola vez y solo pasada la gracia; NUNCA se suspende
 *     la empresa ni se cambia su suscripción.
 */
import request from 'supertest';
import { randomUUID } from 'crypto';
import app from '../../app';
import { q, uno, cerrarPool } from '../helpers/db';
import { sembrar, Fixtures } from '../helpers/seed';
import { login, bearer, PASSWORD } from '../helpers/auth';
import { _usarTransporte, type Mensaje } from '../../services/email';
import { sumarDias, fechaEnGuatemala } from '../../services/facturacion';

let fx: Fixtures;
const token: Record<string, string> = {};
const uid = () => randomUUID().slice(0, 8);
const as = (k: string) => bearer(token[k]);
const enviados: Mensaje[] = [];
const previoCobro = process.env.COBRO_PROVEEDOR;

beforeAll(async () => {
  fx = await sembrar();
  for (const k of ['owner', 'adminEmpA', 'adminEmpB', 'adminSucA1']) token[k] = (await login(app, fx.email[k])).token!;
  _usarTransporte({ nombre: 'captura', enviar: async m => { enviados.push(m); } });
});
afterAll(async () => {
  _usarTransporte(null);
  if (previoCobro === undefined) delete process.env.COBRO_PROVEEDOR; else process.env.COBRO_PROVEEDOR = previoCobro;
  await cerrarPool();
});

const empresaNueva = async () => (await uno<{ id: string }>(`INSERT INTO empresas (nombre) VALUES ($1) RETURNING id`, [`FAC Empresa ${uid()}`]))!.id;
const sucursalNueva = async (e: string) => (await uno<{ id: string }>(`INSERT INTO sucursales (empresa_id, nombre) VALUES ($1, $2) RETURNING id`, [e, `FAC Sucursal ${uid()}`]))!.id;
const adminDe = async (e: string) => {
  const email = `fac.${uid()}@inttest.local`;
  await q(`INSERT INTO usuarios (nombre, email, password_hash, rol, empresa_id, activo) VALUES ('FAC admin', $1, crypt($2, gen_salt('bf', 4)), 'admin_empresa', $3, TRUE)`, [email, PASSWORD, e]);
  return email;
};
const planNuevo = async (extra: Record<string, unknown> = {}) => {
  const r = await request(app).post('/api/planes').set(as('owner')).send({
    codigo: `fac-${uid()}`, nombre: 'Plan FAC', precio_mensual_centavos: 10000, visitas_incluidas: 2, precio_visita_extra_centavos: 75, ...extra,
  });
  expect(r.status).toBe(201);
  return r.body as { id: string; codigo: string };
};
/** Empresa con plan, y su suscripción atrasada para que existan meses cerrados. */
const empresaConPlan = async (planExtra: Record<string, unknown> = {}, fechas: { inicio?: string; prueba?: string | null; cancelada?: string | null } = {}) => {
  const e = await empresaNueva();
  const plan = await planNuevo(planExtra);
  const r = await request(app).put(`/api/empresas/${e}/suscripcion`).set(as('owner')).send({ plan_id: plan.id, estado: 'activa' });
  expect(r.status).toBe(200);
  await q(`UPDATE suscripciones SET inicio_en = $2::timestamptz, prueba_hasta = $3::timestamptz, cancelada_en = $4::timestamptz WHERE empresa_id = $1`,
    [e, fechas.inicio ?? '2022-01-01T12:00:00Z', fechas.prueba ?? null, fechas.cancelada ?? null]);
  return { e, plan, s: await sucursalNueva(e) };
};
const visitante = async () => (await uno<{ id: string }>(`INSERT INTO visitantes (nombre, numero_dpi) VALUES ('FAC visitante', $1) RETURNING id`, [`FAC-${randomUUID()}`.slice(0, 20)]))!.id;
const visita = async (s: string, cuando: string, opts: { autorizado?: boolean; idCliente?: string } = {}) =>
  q(`INSERT INTO registros_acceso (sucursal_id, visitante_id, residente_id, agente_id, tipo, timestamp_entrada, autorizado, id_cliente)
     VALUES ($1, $2, $3, $4, 'entrada', $5::timestamptz, $6, $7) ON CONFLICT DO NOTHING`,
  [s, await visitante(), fx.residentes.A1, fx.usuarios.agenteA1, cuando, opts.autorizado ?? true, opts.idCliente ?? null]);
const generar = (mes?: string) => request(app).post('/api/facturas-saas/generar').set(as('owner')).send(mes ? { mes } : {});
const facturaDe = async (e: string, periodo: string) => uno(`SELECT *, numero::int AS numero_i, cuota_centavos::int AS cuota, total_centavos::int AS total, excedente_centavos::int AS exc FROM facturas_saas WHERE empresa_id = $1 AND periodo = $2`, [e, periodo]);
const hoy = () => fechaEnGuatemala(new Date());

describe('I-25 generación mensual', () => {
  it('mes completo: cuota + excedente en centavos, solo visitas autorizadas y sin duplicados', async () => {
    const { e, s } = await empresaConPlan();                                       // 100,00 · 2 incluidas · 0,75 por extra
    for (let d = 1; d <= 5; d++) await visita(s, `2022-05-0${d} 10:00:00-06`);
    await visita(s, '2022-05-09 10:00:00-06', { autorizado: false });
    const idc = randomUUID();
    await visita(s, '2022-05-10 10:00:00-06', { idCliente: idc });
    await visita(s, '2022-05-10 10:00:05-06', { idCliente: idc });                // reenvío de la cola offline
    await visita(s, '2022-04-30 23:59:59-06');                                    // abril: no cuenta
    await visita(s, '2022-06-01 00:00:00-06');                                    // junio: no cuenta

    const r = await generar('2022-05');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ejecutado: true, periodo: '2022-05', errores: 0 });
    expect(r.body.generadas).toBeGreaterThanOrEqual(1);

    const f = await facturaDe(e, '2022-05');
    expect(f).toMatchObject({ estado: 'pendiente', dias_del_mes: 31, dias_facturados: 31, visitas: 6, visitas_incluidas: 2, excedente_visitas: 4, cuota: 10000, exc: 300, total: 10300, moneda: 'GTQ' });
    expect(f.detalle.lineas).toHaveLength(2);
    expect(f.detalle.lineas[1]).toMatchObject({ cantidad: 4, precio_unitario_centavos: 75, monto_centavos: 300 });

    const api = await request(app).get(`/api/facturas-saas/${f.id}`).set(as('owner'));
    expect(api.body).toMatchObject({ numero_texto: expect.stringMatching(/^SG-\d{6}$/), total_centavos: 10300, estado: 'pendiente', vence_en: sumarDias(hoy(), 10) });
    expect(typeof api.body.total_centavos).toBe('number');
  });

  it('es idempotente: correrlo otra vez no duplica facturas ni gasta números', async () => {
    const { e } = await empresaConPlan();
    await generar('2022-05');
    const antes = await uno(`SELECT valor::int AS v FROM saas_contadores WHERE clave = 'factura_saas'`);
    const otra = await generar('2022-05');
    expect(otra.body.generadas).toBe(0);
    expect(otra.body.existentes).toBeGreaterThanOrEqual(1);
    expect(await q(`SELECT 1 FROM facturas_saas WHERE empresa_id = $1 AND periodo = '2022-05'`, [e])).toHaveLength(1);
    expect((await uno(`SELECT valor::int AS v FROM saas_contadores WHERE clave = 'factura_saas'`))!.v).toBe(antes!.v);
  });

  it('numera de forma correlativa y sin huecos', async () => {
    const contador = async () => (await uno(`SELECT valor::int AS v FROM saas_contadores WHERE clave = 'factura_saas'`))!.v as number;
    await empresaConPlan(); await empresaConPlan(); await empresaConPlan();
    const antes = await contador();
    await generar('2022-06');
    const despues = await contador();
    const nums = (await q(`SELECT numero::int AS n FROM facturas_saas WHERE periodo = '2022-06' ORDER BY numero`)).map(f => f.n);
    expect(nums.length).toBeGreaterThanOrEqual(3);
    expect(nums).toEqual(Array.from({ length: despues - antes }, (_, i) => antes + 1 + i));   // exactamente los números nuevos, seguidos
  });

  it('mes parcial por fin de prueba: cuota y lo incluido por días, y las visitas de la prueba no cuentan', async () => {
    // La prueba termina el 12-jul a las 15:00 de Guatemala: del 12 al 31 son 20 de 31 días.
    const { e, s } = await empresaConPlan({ precio_mensual_centavos: 31000, visitas_incluidas: 10 }, { inicio: '2022-06-28T12:00:00Z', prueba: '2022-07-12T21:00:00Z' });
    await visita(s, '2022-07-05 10:00:00-06');                                     // durante la prueba: gratis
    for (const d of [20, 21, 22]) await visita(s, `2022-07-${d} 10:00:00-06`);
    await generar('2022-07');
    expect(await facturaDe(e, '2022-07')).toMatchObject({ dias_facturados: 20, dias_del_mes: 31, cuota: 20000, visitas: 3, visitas_incluidas: 7, excedente_visitas: 0, total: 20000 });
    expect((await facturaDe(e, '2022-07')).detalle.lineas[0].concepto).toBe('Cuota del plan Plan FAC (20 de 31 días)');
  });

  it('cancelada a mitad de mes: se cobra hasta ese día; cancelada antes, nada', async () => {
    const mitad = await empresaConPlan({ precio_mensual_centavos: 31000 }, { cancelada: '2022-08-10T18:00:00Z' });
    const antes = await empresaConPlan({}, { cancelada: '2022-07-20T18:00:00Z' });
    await generar('2022-08');
    expect(await facturaDe(mitad.e, '2022-08')).toMatchObject({ dias_facturados: 10, cuota: 10000 });
    expect(await facturaDe(antes.e, '2022-08')).toBeUndefined();
  });

  it('no genera para empresas sin suscripción, con plan de Q0 ni con la prueba aún corriendo', async () => {
    const sinPlan = await empresaNueva();
    const gratis = await empresaConPlan({ precio_mensual_centavos: 0, precio_visita_extra_centavos: 0 });
    const enPrueba = await empresaConPlan({}, { inicio: '2022-09-20T12:00:00Z', prueba: '2022-10-04T12:00:00Z' });
    const r = await generar('2022-09');
    expect(r.body.sin_cobro).toBeGreaterThanOrEqual(3);
    for (const e of [sinPlan, gratis.e, enPrueba.e]) expect(await facturaDe(e, '2022-09')).toBeUndefined();
  });

  it('no factura un mes que no terminó, ni uno inválido', async () => {
    const ahora = await uno<{ m: string; f: string }>(`SELECT to_char(NOW() AT TIME ZONE 'America/Guatemala', 'YYYY-MM') AS m, to_char((NOW() AT TIME ZONE 'America/Guatemala') + interval '1 month', 'YYYY-MM') AS f`);
    expect((await generar(ahora!.m)).status).toBe(422);
    expect((await generar(ahora!.f)).status).toBe(422);
    for (const malo of ['2022-13', 'mayo', '22-05']) expect((await generar(malo)).status).toBe(400);
  });

  it('sin mes factura el mes anterior de Guatemala', async () => {
    const r = await generar();
    expect(r.status).toBe(200);
    const anterior = await uno<{ m: string }>(`SELECT to_char((NOW() AT TIME ZONE 'America/Guatemala') - interval '1 month', 'YYYY-MM') AS m`);
    expect(r.body.periodo).toBe(anterior!.m);
  });
});

describe('I-25 aislamiento y permisos', () => {
  it('cada admin ve solo las facturas de su empresa; el cruce es 404', async () => {
    for (const e of [fx.empresas.A, fx.empresas.B]) {
      const plan = await planNuevo();
      await request(app).put(`/api/empresas/${e}/suscripcion`).set(as('owner')).send({ plan_id: plan.id, estado: 'activa' });
      await q(`UPDATE suscripciones SET inicio_en = '2022-01-01', prueba_hasta = NULL WHERE empresa_id = $1`, [e]);
    }
    await generar('2022-10');
    const fA = await facturaDe(fx.empresas.A, '2022-10');
    const fB = await facturaDe(fx.empresas.B, '2022-10');
    expect(fA && fB).toBeTruthy();

    const propias = await request(app).get(`/api/empresas/${fx.empresas.A}/facturas`).set(as('adminEmpA'));
    expect(propias.status).toBe(200);
    expect(propias.body.every((f: any) => f.empresa_id === fx.empresas.A)).toBe(true);
    expect(propias.body.map((f: any) => f.id)).toContain(fA.id);
    expect(propias.body.map((f: any) => f.id)).not.toContain(fB.id);

    expect((await request(app).get(`/api/empresas/${fx.empresas.B}/facturas`).set(as('adminEmpA'))).status).toBe(404);
    expect((await request(app).get(`/api/facturas-saas/${fB.id}`).set(as('adminEmpA'))).status).toBe(404);
    expect((await request(app).get(`/api/facturas-saas/${fA.id}`).set(as('adminEmpA'))).status).toBe(200);
    expect((await request(app).get(`/api/facturas-saas/${fA.id}`).set(as('adminEmpB'))).status).toBe(404);

    // Lo que cambia dinero o corre el job es solo del owner.
    expect((await request(app).get('/api/facturas-saas').set(as('adminEmpA'))).status).toBe(403);
    expect((await request(app).post('/api/facturas-saas/generar').set(as('adminEmpA')).send({})).status).toBe(403);
    expect((await request(app).post('/api/facturas-saas/revisar-vencidas').set(as('adminEmpA')).send({})).status).toBe(403);
    expect((await request(app).post(`/api/facturas-saas/${fA.id}/pagar`).set(as('adminEmpA')).send({ metodo: 'efectivo' })).status).toBe(403);
    expect((await request(app).post(`/api/facturas-saas/${fA.id}/anular`).set(as('adminEmpA')).send({ motivo: 'no' })).status).toBe(403);
    expect((await request(app).get(`/api/facturas-saas/${fA.id}`).set(as('adminSucA1'))).status).toBe(403);
    expect((await facturaDe(fx.empresas.A, '2022-10')).estado).toBe('pendiente');

    const lista = await request(app).get('/api/facturas-saas?periodo=2022-10').set(as('owner'));
    expect(lista.status).toBe(200);
    expect(lista.body.map((f: any) => f.id)).toEqual(expect.arrayContaining([fA.id, fB.id]));
    expect((await request(app).get('/api/facturas-saas?estado=rara').set(as('owner'))).status).toBe(400);
    expect((await request(app).get('/api/facturas-saas?empresa_id=no').set(as('owner'))).status).toBe(400);
    expect((await request(app).get('/api/facturas-saas?periodo=2022-99').set(as('owner'))).status).toBe(400);
    await q(`DELETE FROM suscripcion_historial WHERE empresa_id = ANY($1::uuid[])`, [[fx.empresas.A, fx.empresas.B]]);
    await q(`DELETE FROM suscripciones WHERE empresa_id = ANY($1::uuid[])`, [[fx.empresas.A, fx.empresas.B]]);
  });

  it('borrar una empresa definitivamente borra también sus facturas y avisos', async () => {
    const { e } = await empresaConPlan();
    await adminDe(e);
    await generar('2022-11');
    const f = await facturaDe(e, '2022-11');
    expect(f).toBeTruthy();
    const r = await request(app).post(`/api/empresas/${e}/eliminar-definitivo`).set(as('owner')).send({ password: PASSWORD });
    expect(r.status).toBe(200);
    expect(r.body.eliminado).toMatchObject({ facturas_saas: 1, facturas_saas_avisos: 1 });
    expect(await q(`SELECT 1 FROM facturas_saas WHERE id = $1`, [f.id])).toHaveLength(0);
  });
});

describe('I-25 cobro manual', () => {
  const nueva = async () => {
    const { e } = await empresaConPlan();
    await generar('2023-01');
    return (await facturaDe(e, '2023-01')).id as string;
  };
  const pagar = (id: string, body: object) => request(app).post(`/api/facturas-saas/${id}/pagar`).set(as('owner')).send(body);

  it('el owner marca la factura pagada con su referencia; no se paga dos veces', async () => {
    const id = await nueva();
    const r = await pagar(id, { metodo: 'transferencia', referencia: ' BAC-998877 ', nota: 'Boleta del 5' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ estado: 'pagada', metodo_pago: 'transferencia', referencia_pago: 'BAC-998877', nota_pago: 'Boleta del 5', proveedor_cobro: 'manual' });
    expect(r.body.pagada_en).toBeTruthy();
    expect((await uno(`SELECT marcada_por FROM facturas_saas WHERE id = $1`, [id]))!.marcada_por).toBe(fx.usuarios.owner);
    expect((await pagar(id, { metodo: 'efectivo' })).status).toBe(409);
  });

  it('valida el cobro: referencia obligatoria en transferencia, método y textos', async () => {
    const id = await nueva();
    expect((await pagar(id, { metodo: 'transferencia' })).status).toBe(400);
    expect((await pagar(id, { metodo: 'deposito', referencia: '  ' })).status).toBe(400);
    expect((await pagar(id, { metodo: 'cripto', referencia: 'x' })).status).toBe(400);
    expect((await pagar(id, {})).status).toBe(400);
    expect((await pagar(id, { metodo: 'efectivo', referencia: 123 })).status).toBe(400);
    expect((await pagar(id, { metodo: 'otro', referencia: 'x'.repeat(101) })).status).toBe(400);
    expect((await facturaDe((await uno(`SELECT empresa_id FROM facturas_saas WHERE id = $1`, [id]))!.empresa_id, '2023-01')).estado).toBe('pendiente');
    expect((await pagar(id, { metodo: 'efectivo' })).status).toBe(200);                    // en efectivo no pide referencia
    expect((await pagar(randomUUID(), { metodo: 'efectivo' })).status).toBe(404);
    expect((await pagar('no-uuid', { metodo: 'efectivo' })).status).toBe(400);
  });

  it('con Visanet como proveedor falla de forma controlada: 503 y la factura sigue intacta', async () => {
    const id = await nueva();
    process.env.COBRO_PROVEEDOR = 'visanet';
    try {
      const r = await pagar(id, { metodo: 'otro' });
      expect(r.status).toBe(503);
      expect(r.body.proveedor).toBe('visanet');
    } finally {
      if (previoCobro === undefined) delete process.env.COBRO_PROVEEDOR; else process.env.COBRO_PROVEEDOR = previoCobro;
    }
    expect((await uno(`SELECT estado, pagada_en FROM facturas_saas WHERE id = $1`, [id]))).toMatchObject({ estado: 'pendiente', pagada_en: null });
  });

  it('anular exige motivo, no aplica a pagadas y la factura del mes no se vuelve a generar', async () => {
    const id = await nueva();
    const anular = (i: string, b: object) => request(app).post(`/api/facturas-saas/${i}/anular`).set(as('owner')).send(b);
    expect((await anular(id, {})).status).toBe(400);
    expect((await anular(id, { motivo: 'ab' })).status).toBe(400);
    const ok = await anular(id, { motivo: 'Se generó por error' });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ estado: 'anulada', anulada_motivo: 'Se generó por error' });
    expect((await anular(id, { motivo: 'otra vez' })).status).toBe(409);
    expect((await pagar(id, { metodo: 'efectivo' })).status).toBe(409);                     // anulada: no se paga
    const antes = (await q(`SELECT 1 FROM facturas_saas WHERE periodo = '2023-01'`)).length;
    await generar('2023-01');
    expect((await q(`SELECT 1 FROM facturas_saas WHERE periodo = '2023-01'`)).length).toBe(antes);

    const pagada = await nueva();
    await pagar(pagada, { metodo: 'efectivo' });
    expect((await anular(pagada, { motivo: 'no se puede' })).status).toBe(409);
    expect((await anular(randomUUID(), { motivo: 'no existe' })).status).toBe(404);
  });
});

describe('I-25 vencimientos y avisos', () => {
  const revisar = () => request(app).post('/api/facturas-saas/revisar-vencidas').set(as('owner')).send({});
  const para = (correo: string) => enviados.filter(m => m.to === correo);

  it('marca vencidas solo las pendientes cuya fecha de Guatemala ya pasó', async () => {
    const mk = async (mes: string) => { const { e } = await empresaConPlan(); await generar(mes); return (await facturaDe(e, mes)).id as string; };
    const ayer = await mk('2023-02'); const hoyMismo = await mk('2023-03'); const futura = await mk('2023-04'); const pagada = await mk('2023-05');
    await q(`UPDATE facturas_saas SET vence_en = $2::date WHERE id = $1`, [ayer, sumarDias(hoy(), -1)]);
    await q(`UPDATE facturas_saas SET vence_en = $2::date WHERE id = $1`, [hoyMismo, hoy()]);
    await q(`UPDATE facturas_saas SET vence_en = $2::date WHERE id = $1`, [futura, sumarDias(hoy(), 3)]);
    await q(`UPDATE facturas_saas SET vence_en = $2::date, estado = 'pagada', pagada_en = NOW() WHERE id = $1`, [pagada, sumarDias(hoy(), -30)]);
    const r = await revisar();
    expect(r.status).toBe(200);
    expect(r.body.vencidas).toBeGreaterThanOrEqual(1);
    const estado = async (id: string) => (await uno(`SELECT estado FROM facturas_saas WHERE id = $1`, [id]))!.estado;
    expect(await estado(ayer)).toBe('vencida');
    expect(await estado(hoyMismo)).toBe('pendiente');          // vence hoy: todavía puede pagar hoy
    expect(await estado(futura)).toBe('pendiente');
    expect(await estado(pagada)).toBe('pagada');
  });

  it('aviso de factura emitida: una sola vez por factura, a los admins activos; sin destinatario no se marca como enviado', async () => {
    const { e } = await empresaConPlan();
    await generar('2023-06');                                                // sin admin: nadie a quien avisar
    const f = await facturaDe(e, '2023-06');
    expect(await q(`SELECT 1 FROM facturas_saas_avisos WHERE factura_id = $1`, [f.id])).toHaveLength(0);

    const admin = await adminDe(e);
    const inactivo = await adminDe(e); await q(`UPDATE usuarios SET activo = FALSE WHERE email = $1`, [inactivo]);
    await revisar();
    expect(para(admin)).toHaveLength(1);
    expect(para(inactivo)).toHaveLength(0);
    expect(para(admin)[0].subject).toMatch(/^Factura SG-\d{6} de SecureGate \(2023-06\)$/);
    expect(para(admin)[0].text).toMatch(/Q100\.00/);
    expect(para(admin)[0].text).not.toMatch(/\$\{|undefined|NaN/);
    await revisar(); await generar('2023-06');
    expect(para(admin)).toHaveLength(1);                                     // no se repite
    expect(await q(`SELECT 1 FROM facturas_saas_avisos WHERE factura_id = $1 AND tipo = 'emitida'`, [f.id])).toHaveLength(1);
  });

  it('aviso de pago vencido: solo pasada la gracia y una sola vez; la empresa NO se suspende ni cambia su suscripción', async () => {
    const { e } = await empresaConPlan();
    const admin = await adminDe(e);
    await generar('2023-07');
    const f = await facturaDe(e, '2023-07');
    await revisar();                                                          // emitida
    const vencidas = () => para(admin).filter(m => m.subject.startsWith('Pago vencido'));

    await q(`UPDATE facturas_saas SET vence_en = $2::date WHERE id = $1`, [f.id, sumarDias(hoy(), -3)]);
    await revisar();                                                          // vencida hace 3 días: dentro de la gracia (5)
    expect((await uno(`SELECT estado FROM facturas_saas WHERE id = $1`, [f.id]))!.estado).toBe('vencida');
    expect(vencidas()).toHaveLength(0);

    await q(`UPDATE facturas_saas SET vence_en = $2::date WHERE id = $1`, [f.id, sumarDias(hoy(), -6)]);
    await revisar();
    expect(vencidas()).toHaveLength(1);
    expect(vencidas()[0].text).toMatch(/Tu servicio sigue funcionando/);
    await revisar(); await revisar();
    expect(vencidas()).toHaveLength(1);                                       // una sola vez

    expect(await uno(`SELECT suspendida FROM empresas WHERE id = $1`, [e])).toMatchObject({ suspendida: false });
    expect(await uno(`SELECT estado FROM suscripciones WHERE empresa_id = $1`, [e])).toMatchObject({ estado: 'activa' });
    // Aún puede operar: crear una sucursal sigue funcionando.
    expect((await request(app).post('/api/sucursales').set(as('owner')).send({ empresa_id: e, nombre: `Sigue ${uid()}` })).status).toBe(201);
  });

  it('pagar una factura vencida deja de avisar', async () => {
    const { e } = await empresaConPlan();
    const admin = await adminDe(e);
    await generar('2023-08');
    const f = await facturaDe(e, '2023-08');
    await q(`UPDATE facturas_saas SET vence_en = $2::date WHERE id = $1`, [f.id, sumarDias(hoy(), -20)]);
    await request(app).post(`/api/facturas-saas/${f.id}/pagar`).set(as('owner')).send({ metodo: 'efectivo' });
    await revisar();
    expect(para(admin).filter(m => m.subject.startsWith('Pago vencido'))).toHaveLength(0);
  });
});

describe('I-25 salir de la prueba', () => {
  it('activar una suscripción en prueba da la prueba por terminada hoy', async () => {
    const e = await empresaNueva();
    const plan = await planNuevo({ dias_prueba: 30 });
    await request(app).put(`/api/empresas/${e}/suscripcion`).set(as('owner')).send({ plan_id: plan.id });
    const antes = (await uno(`SELECT prueba_hasta FROM suscripciones WHERE empresa_id = $1`, [e]))!.prueba_hasta as Date;
    expect(antes.getTime()).toBeGreaterThan(Date.now() + 29 * 86_400_000);
    await request(app).put(`/api/empresas/${e}/suscripcion`).set(as('owner')).send({ estado: 'activa' });
    const despues = (await uno(`SELECT prueba_hasta FROM suscripciones WHERE empresa_id = $1`, [e]))!.prueba_hasta as Date;
    expect(despues.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
  });
});
