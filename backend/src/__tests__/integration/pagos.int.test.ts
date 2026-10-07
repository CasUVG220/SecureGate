/**
 * I-6 · Pagos con tarjeta, historial y reportes de ingresos (integración) — SCRUM-112 / H05
 *
 * Componentes: Express (app.ts) → /api/pagos, /api/reportes, /api/residentes →
 *   pagos/reportes/residentes controllers → Postgres real (pagos, residentes, audit_logs). Sin mocks.
 * Condición: la pasarela simulada se enciende SOLO dentro de este archivo (PAGOS_TARJETA_SIMULADA);
 *   los residentes sembrados A1/B1 reciben un saldo pendiente.
 * Resultado esperado:
 *   - una tarjeta aprobada se guarda y liquida el saldo; una RECHAZADA responde 402, no deja
 *     ninguna fila en `pagos`, no toca el saldo y SÍ queda en la auditoría con su código;
 *   - los comprobantes de transferencia rechazados por el administrador no cuentan en el reporte
 *     CSV de ingresos (salvo que se pidan) ni en los «recientes» del residente;
 *   - cada administrador solo ve los pagos de su alcance;
 *   - /pagos/tarjeta/estado dice si hay pasarela y si es simulada (con la bandera apagada: ni lo uno ni lo otro).
 */
import request from 'supertest';
import app from '../../app';
import { q, uno, cerrarPool } from '../helpers/db';
import { sembrar, Fixtures } from '../helpers/seed';
import { login, bearer } from '../helpers/auth';
import { esperarAuditoriaDe } from '../helpers/audit';

let fx: Fixtures;
const previo = process.env.PAGOS_TARJETA_SIMULADA;

beforeAll(async () => {
  process.env.PAGOS_TARJETA_SIMULADA = 'true';
  fx = await sembrar();
});
afterAll(async () => {
  if (previo === undefined) delete process.env.PAGOS_TARJETA_SIMULADA; else process.env.PAGOS_TARJETA_SIMULADA = previo;
  await cerrarPool();
});

const conSaldo = (residenteId: string, saldo = 850) =>
  q(`UPDATE residentes SET saldo_pendiente = $2, estado_pago = 'mora' WHERE id = $1`, [residenteId, saldo]);
const filas = (residenteId: string) => q('SELECT * FROM pagos WHERE residente_id = $1 ORDER BY fecha_pago', [residenteId]);
const tarjeta = (token: string | undefined, body: object) =>
  request(app).post('/api/pagos/tarjeta').set(bearer(token)).send(body);
const hoyMasMenos = () => {
  const d = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
  return { desde: d(-1), hasta: d(1) };
};

describe('I-6 pago con tarjeta', () => {
  it('aprobada: se guarda, liquida el saldo y deja la auditoría', async () => {
    await conSaldo(fx.residentes.A1);
    const res = await login(app, fx.email.resA1);
    const r = await tarjeta(res.token, { monto: 850, ultimos4: '4444', titular: 'ANA LOPEZ' });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ metodo: 'tarjeta', estado: 'aprobado', es_simulado: true, tarjeta_ultimos4: '4444' });

    const [pago] = await filas(fx.residentes.A1);
    expect(pago).toMatchObject({ estado: 'aprobado', tarjeta_ultimos4: '4444', sucursal_id: fx.sucursales.A1 });
    expect(JSON.stringify(pago)).not.toMatch(/4111111111111111/);
    const residente = await uno('SELECT estado_pago, saldo_pendiente FROM residentes WHERE id = $1', [fx.residentes.A1]);
    expect(residente).toMatchObject({ estado_pago: 'al_dia' });
    expect(Number(residente.saldo_pendiente)).toBe(0);

    const [a] = await esperarAuditoriaDe('PAGO_TARJETA_SIMULADO', fx.usuarios.resA1);
    expect(a).toMatchObject({ status_code: 201, usuario_id: fx.usuarios.resA1 });
  });

  it('rechazada: 402, NO se guarda ningún pago, NO toca el saldo y queda en la auditoría', async () => {
    await conSaldo(fx.residentes.B1, 400);
    const res = await login(app, fx.email.resB1);
    const antes = (await filas(fx.residentes.B1)).length;

    const r = await tarjeta(res.token, { monto: 400, ultimos4: '0001', titular: 'BETO RUIZ' });
    expect(r.status).toBe(402);
    expect(r.body).toMatchObject({ estado: 'rechazado' });
    expect(r.body.error).toMatch(/rechazado/i);

    expect(await filas(fx.residentes.B1)).toHaveLength(antes);            // ni siquiera una fila 'rechazado'
    const residente = await uno('SELECT estado_pago, saldo_pendiente FROM residentes WHERE id = $1', [fx.residentes.B1]);
    expect(residente.estado_pago).toBe('mora');
    expect(Number(residente.saldo_pendiente)).toBe(400);

    const auditoria = await esperarAuditoriaDe('PAGO_TARJETA_SIMULADO', fx.usuarios.resB1);
    expect(auditoria[0]).toMatchObject({ status_code: 402, usuario_id: fx.usuarios.resB1 });
    expect(auditoria[0].ip_address).toBeTruthy();
  });

  it('varios intentos rechazados seguidos no acumulan filas', async () => {
    const res = await login(app, fx.email.resB1);
    const antes = (await filas(fx.residentes.B1)).length;
    for (let i = 0; i < 3; i++) {
      expect((await tarjeta(res.token, { monto: 10, ultimos4: '9991' })).status).toBe(402);
    }
    expect(await filas(fx.residentes.B1)).toHaveLength(antes);
  });

  it('con la pasarela apagada: 501 y no se escribe nada (nadie liquida con una tarjeta falsa)', async () => {
    delete process.env.PAGOS_TARJETA_SIMULADA;
    try {
      await conSaldo(fx.residentes.A2, 100);
      const res = await login(app, fx.email.resA2);
      const r = await tarjeta(res.token, { monto: 100, ultimos4: '4444' });
      expect(r.status).toBe(501);
      expect(await filas(fx.residentes.A2)).toHaveLength(0);
      expect(Number((await uno('SELECT saldo_pendiente FROM residentes WHERE id = $1', [fx.residentes.A2])).saldo_pendiente)).toBe(100);
    } finally {
      process.env.PAGOS_TARJETA_SIMULADA = 'true';
    }
  });
});

describe('I-6 GET /pagos/tarjeta/estado', () => {
  it('con la bandera de prueba: disponible y simulada; apagada: ni lo uno ni lo otro', async () => {
    const res = await login(app, fx.email.resA1);
    const encendida = await request(app).get('/api/pagos/tarjeta/estado').set(bearer(res.token));
    expect(encendida.status).toBe(200);
    expect(encendida.body).toEqual({ disponible: true, simulada: true });

    delete process.env.PAGOS_TARJETA_SIMULADA;
    try {
      const apagada = await request(app).get('/api/pagos/tarjeta/estado').set(bearer(res.token));
      expect(apagada.body).toEqual({ disponible: false, simulada: false });
    } finally {
      process.env.PAGOS_TARJETA_SIMULADA = 'true';
    }
  });

  it('exige sesión', async () => {
    expect((await request(app).get('/api/pagos/tarjeta/estado')).status).toBe(401);
  });
});

describe('I-6 comprobantes rechazados fuera de los ingresos y del historial reciente', () => {
  let rechazadoId: string;
  let aprobadoId: string;

  beforeAll(async () => {
    const residente = await login(app, fx.email.resA1);
    const adminSuc = await login(app, fx.email.adminSucA1);
    const nuevaTransferencia = async (referencia: string, monto: number) => {
      const r = await request(app).post('/api/pagos/transferencia').set(bearer(residente.token))
        .send({ monto, referencia, banco: 'Banco Industrial', fecha_transferencia: new Date().toISOString().slice(0, 10) });
      expect(r.status).toBe(201);
      return r.body.id as string;
    };
    rechazadoId = await nuevaTransferencia(`TRF-RECH-${fx.sufijo}`, 321);
    aprobadoId = await nuevaTransferencia(`TRF-OK-${fx.sufijo}`, 654);
    expect((await request(app).put(`/api/pagos/${rechazadoId}/rechazar`).set(bearer(adminSuc.token)).send({ comentario_rechazo: 'Referencia ilegible' })).status).toBe(200);
    expect((await request(app).put(`/api/pagos/${aprobadoId}/aprobar`).set(bearer(adminSuc.token))).status).toBe(200);
  });

  const csv = async (quien: string, qs = '') => {
    const s = await login(app, fx.email[quien]);
    const r = await request(app).get(`/api/reportes/pagos?desde=${hoyMasMenos().desde}&hasta=${hoyMasMenos().hasta}${qs}`).set(bearer(s.token));
    expect(r.status).toBe(200);
    return r.text.split('\n').slice(1).filter(Boolean);
  };

  it('el reporte CSV de pagos no incluye los rechazados, pero sí los aprobados', async () => {
    const lineas = await csv('adminSucA1');
    const estados = lineas.map(l => l.split(',')[4]);
    expect(estados).not.toContain('rechazado');
    expect(lineas.some(l => l.includes('654'))).toBe(true);                 // el aprobado de 654
    expect(lineas.some(l => l.includes('321'))).toBe(false);                // el rechazado de 321 no cuenta
  });

  it('se pueden pedir expresamente con ?incluir_rechazados=1', async () => {
    const lineas = await csv('adminSucA1', '&incluir_rechazados=1');
    expect(lineas.some(l => l.includes('321') && l.includes('rechazado'))).toBe(true);
  });

  it('la estadística de ingresos («recaudado») tampoco suma lo rechazado', async () => {
    const s = await login(app, fx.email.adminSucA1);
    const d = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
    const r = await request(app).get(`/api/reportes/estadisticas?desde=${d(-1)}&hasta=${d(1)}`).set(bearer(s.token));
    expect(r.status).toBe(200);
    expect(r.body.pagos.por_estado.rechazado.monto).toBe(321);               // se informa aparte
    // recaudado = solo lo aprobado: la tarjeta de 850 + la transferencia de 654
    expect(r.body.pagos.recaudado).toBe(850 + 654);
  });

  it('los pagos «recientes» del residente y del detalle de residente excluyen lo rechazado; /pagos/mis conserva el motivo', async () => {
    const residente = await login(app, fx.email.resA1);
    const me = await request(app).get('/api/residentes/me').set(bearer(residente.token));
    expect(me.status).toBe(200);
    expect(me.body.pagos_recientes.map((p: any) => p.estado)).not.toContain('rechazado');

    const admin = await login(app, fx.email.adminSucA1);
    const detalle = await request(app).get(`/api/residentes/${fx.residentes.A1}/pago`).set(bearer(admin.token));
    expect(detalle.status).toBe(200);
    expect(JSON.stringify(detalle.body)).not.toContain('"rechazado"');

    // El historial completo del residente sigue trayendo el rechazo con su motivo: la pantalla decide cómo mostrarlo.
    const mis = await request(app).get('/api/pagos/mis').set(bearer(residente.token));
    const rechazado = mis.body.find((p: any) => p.id === rechazadoId);
    expect(rechazado).toMatchObject({ estado: 'rechazado', comentario_rechazo: 'Referencia ilegible' });
  });

  it('aislamiento: cada administrador solo ve los pagos de su alcance', async () => {
    const idsPagos = async (quien: string) =>
      ((await request(app).get('/api/pagos').set(bearer((await login(app, fx.email[quien])).token))).body as any[]).map(p => p.id);

    expect(await idsPagos('adminSucA1')).toEqual(expect.arrayContaining([rechazadoId, aprobadoId]));
    expect(await idsPagos('adminEmpA')).toEqual(expect.arrayContaining([rechazadoId, aprobadoId]));
    expect(await idsPagos('owner')).toEqual(expect.arrayContaining([rechazadoId, aprobadoId]));
    for (const ajeno of ['adminSucA2', 'adminSucB1', 'adminEmpB']) {
      const ids = await idsPagos(ajeno);
      expect([ajeno, ids.includes(rechazadoId), ids.includes(aprobadoId)]).toEqual([ajeno, false, false]);
    }
    // …ni en el CSV de ingresos
    expect((await csv('adminSucB1', '&incluir_rechazados=1')).some(l => l.includes('654') || l.includes('321'))).toBe(false);
  });
});
