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
 *   - /pagos/tarjeta/estado dice si hay pasarela y si es simulada (con la bandera apagada: ni lo uno ni lo otro);
 *   - T1 (modelo de saldo): un pago RESTA su monto del saldo, en los tres métodos (efectivo, transferencia
 *     aprobada y tarjeta): parcial deja el resto, exacto deja 0 y «al día», mayor al saldo es 422 sin dejar
 *     rastro; dos pagos simultáneos nunca dejan el saldo negativo.
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
    await conSaldo(fx.residentes.A1, 2000);                                  // T1: un comprobante no puede pasar del saldo
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

// ─── T1 · un pago resta su monto del saldo ────────────────────────────────────────────────────
describe('I-6 T1 modelo de saldo: parcial, exacto y mayor al saldo en los tres métodos', () => {
  const saldoDe = async (id: string) => Number((await uno('SELECT saldo_pendiente FROM residentes WHERE id = $1', [id])).saldo_pendiente);
  const estadoDe = async (id: string) => (await uno('SELECT estado_pago FROM residentes WHERE id = $1', [id])).estado_pago as string;
  const efectivo = async (monto: number, residente = fx.residentes.A1, quien = 'adminSucA1') =>
    request(app).post('/api/pagos').set(bearer((await login(app, fx.email[quien])).token)).send({ residente_id: residente, monto });
  const comprobante = async (monto: number, quien = 'resA1') =>
    request(app).post('/api/pagos/transferencia').set(bearer((await login(app, fx.email[quien])).token))
      .send({ monto, referencia: `T1-${Math.random().toString(36).slice(2, 8)}`, banco: 'Banrural', fecha_transferencia: '2026-10-01' });
  const aprobar = async (id: string, quien = 'adminSucA1') =>
    request(app).put(`/api/pagos/${id}/aprobar`).set(bearer((await login(app, fx.email[quien])).token));
  const tarjetaA1 = async (monto: number, ultimos4 = '4444') => tarjeta((await login(app, fx.email.resA1)).token, { monto, ultimos4, titular: 'ANA LOPEZ' });
  const pagosDe = async (id: string) => (await filas(id)).length;

  describe('efectivo (POST /api/pagos)', () => {
    it('parcial: el saldo baja por el monto y sigue en mora', async () => {
      await conSaldo(fx.residentes.A1, 1000);
      const r = await efectivo(400);
      expect(r.status).toBe(201);
      expect(await saldoDe(fx.residentes.A1)).toBe(600);
      expect(await estadoDe(fx.residentes.A1)).toBe('mora');
      expect((await uno('SELECT fecha_ultimo_pago FROM residentes WHERE id = $1', [fx.residentes.A1])).fecha_ultimo_pago).toBeTruthy();
    });
    it('exacto: el saldo queda en 0 y el residente al día', async () => {
      const r = await efectivo(600);
      expect(r.status).toBe(201);
      expect(await saldoDe(fx.residentes.A1)).toBe(0);
      expect(await estadoDe(fx.residentes.A1)).toBe('al_dia');
    });
    it('mayor al saldo: 422 con mensaje claro, sin pago nuevo y sin tocar el saldo', async () => {
      await conSaldo(fx.residentes.A1, 300);
      const antes = await pagosDe(fx.residentes.A1);
      const r = await efectivo(300.01);
      expect(r.status).toBe(422);
      expect(r.body).toMatchObject({ codigo: 'EXCEDE_SALDO', saldo_pendiente: '300.00' });
      expect(r.body.error).toMatch(/supera el saldo pendiente \(Q300\.00\)/);
      expect(await pagosDe(fx.residentes.A1)).toBe(antes);
      expect(await saldoDe(fx.residentes.A1)).toBe(300);
      expect(await estadoDe(fx.residentes.A1)).toBe('mora');
      // el rechazo queda en la auditoría con su código
      const aud = await esperarAuditoriaDe('PAGO_EFECTIVO', fx.usuarios.adminSucA1);
      expect(aud.some((a: { status_code: number }) => a.status_code === 422)).toBe(true);
    });
    it('sin saldo pendiente cualquier monto es 422', async () => {
      await q(`UPDATE residentes SET saldo_pendiente = 0, estado_pago = 'al_dia' WHERE id = $1`, [fx.residentes.A1]);
      const r = await efectivo(1);
      expect(r.status).toBe(422);
      expect(r.body.error).toMatch(/no tiene saldo pendiente/);
    });
    it('el monto debe tener a lo más dos decimales', async () => {
      await conSaldo(fx.residentes.A1, 100);
      expect((await efectivo(10.005)).status).toBe(400);
      expect(await saldoDe(fx.residentes.A1)).toBe(100);
    });
    it('centavos exactos: 3 pagos de Q33.33 y uno de Q0.01 saldan Q100.00 sin residuos de punto flotante', async () => {
      await conSaldo(fx.residentes.A1, 100);
      for (const m of [33.33, 33.33, 33.33]) expect((await efectivo(m)).status).toBe(201);
      expect(await saldoDe(fx.residentes.A1)).toBe(0.01);
      expect((await efectivo(0.01)).status).toBe(201);
      expect(await saldoDe(fx.residentes.A1)).toBe(0);
      expect(await estadoDe(fx.residentes.A1)).toBe('al_dia');
    });
  });

  describe('transferencia (comprobante + aprobación)', () => {
    it('parcial: aprobar resta solo el monto del comprobante', async () => {
      await conSaldo(fx.residentes.A1, 1000);
      const c = await comprobante(250);
      expect(c.status).toBe(201);
      expect(await saldoDe(fx.residentes.A1)).toBe(1000);                    // pendiente: no mueve el saldo
      expect((await aprobar(c.body.id)).status).toBe(200);
      expect(await saldoDe(fx.residentes.A1)).toBe(750);
      expect(await estadoDe(fx.residentes.A1)).toBe('mora');
    });
    it('exacto: aprobar deja 0 y al día', async () => {
      const c = await comprobante(750);
      expect((await aprobar(c.body.id)).status).toBe(200);
      expect(await saldoDe(fx.residentes.A1)).toBe(0);
      expect(await estadoDe(fx.residentes.A1)).toBe('al_dia');
    });
    it('mayor al saldo: el comprobante se rechaza de entrada con 422 y no se guarda', async () => {
      await conSaldo(fx.residentes.A1, 100);
      const antes = await pagosDe(fx.residentes.A1);
      const c = await comprobante(100.5);
      expect(c.status).toBe(422);
      expect(c.body).toMatchObject({ codigo: 'EXCEDE_SALDO', saldo_pendiente: '100.00' });
      expect(await pagosDe(fx.residentes.A1)).toBe(antes);
    });
    it('si el saldo bajó desde que se subió el comprobante, aprobarlo es 422 y el pago sigue pendiente', async () => {
      await conSaldo(fx.residentes.A1, 500);
      const c = await comprobante(400);
      expect(c.status).toBe(201);
      expect((await efectivo(300)).status).toBe(201);                         // otro pago: quedan 200
      const r = await aprobar(c.body.id);
      expect(r.status).toBe(422);
      expect(r.body.saldo_pendiente).toBe('200.00');
      expect((await uno('SELECT estado FROM pagos WHERE id = $1', [c.body.id])).estado).toBe('pendiente');
      expect(await saldoDe(fx.residentes.A1)).toBe(200);
    });
  });

  describe('tarjeta (simulada)', () => {
    it('parcial: el saldo baja por el monto', async () => {
      await conSaldo(fx.residentes.A1, 900);
      const r = await tarjetaA1(350);
      expect(r.status).toBe(201);
      expect(await saldoDe(fx.residentes.A1)).toBe(550);
      expect(await estadoDe(fx.residentes.A1)).toBe('mora');
    });
    it('exacto: deja 0 y al día', async () => {
      expect((await tarjetaA1(550)).status).toBe(201);
      expect(await saldoDe(fx.residentes.A1)).toBe(0);
      expect(await estadoDe(fx.residentes.A1)).toBe('al_dia');
    });
    it('mayor al saldo: 422, no se guarda el pago, ni siquiera con una tarjeta que se rechazaría (no llega a autorizar)', async () => {
      await conSaldo(fx.residentes.A1, 200);
      const antes = await pagosDe(fx.residentes.A1);
      for (const ultimos4 of ['4444', '0001']) {
        const r = await tarjetaA1(200.01, ultimos4);
        expect(r.status).toBe(422);
        expect(r.body.codigo).toBe('EXCEDE_SALDO');
      }
      expect(await pagosDe(fx.residentes.A1)).toBe(antes);
      expect(await saldoDe(fx.residentes.A1)).toBe(200);
    });
  });

  describe('cargos de reserva', () => {
    it('siguen pendientes mientras haya saldo y se saldan cuando el saldo llega a 0', async () => {
      await q('DELETE FROM pagos WHERE residente_id = $1', [fx.residentes.A1]);
      await conSaldo(fx.residentes.A1, 500);
      await q(
        `INSERT INTO pagos (sucursal_id, residente_id, monto, metodo, estado, concepto, registrado_por)
         VALUES ($1, $2, 200, 'reserva', 'pendiente', 'Reserva: Salón - 2026-11-01', $3)`,
        [fx.sucursales.A1, fx.residentes.A1, fx.usuarios.adminSucA1],
      );
      expect((await efectivo(300)).status).toBe(201);
      expect((await uno(`SELECT estado FROM pagos WHERE residente_id = $1 AND metodo = 'reserva'`, [fx.residentes.A1])).estado).toBe('pendiente');
      expect((await efectivo(200)).status).toBe(201);
      expect(await saldoDe(fx.residentes.A1)).toBe(0);
      expect((await uno(`SELECT estado FROM pagos WHERE residente_id = $1 AND metodo = 'reserva'`, [fx.residentes.A1])).estado).toBe('aprobado');
    });
  });

  describe('concurrencia: fila del residente bloqueada', () => {
    it('cinco pagos en efectivo simultáneos de Q60 con saldo Q100: uno entra, cuatro son 422, el saldo es Q40 (nunca negativo)', async () => {
      await conSaldo(fx.residentes.A1, 100);
      await q('DELETE FROM pagos WHERE residente_id = $1', [fx.residentes.A1]);
      const token = (await login(app, fx.email.adminSucA1)).token;
      const respuestas = await Promise.all(Array.from({ length: 5 }, () =>
        request(app).post('/api/pagos').set(bearer(token)).send({ residente_id: fx.residentes.A1, monto: 60 })));
      const codigos = respuestas.map(r => r.status).sort();
      expect(codigos).toEqual([201, 422, 422, 422, 422]);
      expect(await saldoDe(fx.residentes.A1)).toBe(40);
      expect(await pagosDe(fx.residentes.A1)).toBe(1);                       // el ingreso registrado es solo el que entró
    });
    it('dos aprobaciones simultáneas de comprobantes de Q60 con saldo Q100: una aprueba, la otra 422', async () => {
      await conSaldo(fx.residentes.A1, 100);
      await q('DELETE FROM pagos WHERE residente_id = $1', [fx.residentes.A1]);
      const a = await comprobante(60);
      const b = await comprobante(60);
      const token = (await login(app, fx.email.adminSucA1)).token;
      const rs = await Promise.all([a.body.id, b.body.id].map((id: string) =>
        request(app).put(`/api/pagos/${id}/aprobar`).set(bearer(token))));
      expect(rs.map(r => r.status).sort()).toEqual([200, 422]);
      expect(await saldoDe(fx.residentes.A1)).toBe(40);
    });
    it('tarjeta y efectivo a la vez sobre el mismo saldo: solo cabe uno', async () => {
      await conSaldo(fx.residentes.A1, 100);
      await q('DELETE FROM pagos WHERE residente_id = $1', [fx.residentes.A1]);
      const rs = await Promise.all([tarjetaA1(70), efectivo(70)]);
      expect(rs.map(r => r.status).sort()).toEqual([201, 422]);
      expect(await saldoDe(fx.residentes.A1)).toBe(30);
    });
  });

  describe('reportes y estadísticas coherentes con el saldo', () => {
    it('lo recaudado es la suma de lo aprobado y la cartera pendiente es el saldo que queda', async () => {
      await q('DELETE FROM pagos WHERE residente_id = $1', [fx.residentes.A1]);
      await conSaldo(fx.residentes.A1, 1000);
      expect((await efectivo(400)).status).toBe(201);
      expect((await tarjetaA1(100)).status).toBe(201);
      expect((await efectivo(9999)).status).toBe(422);                       // no infla el ingreso
      const d = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
      const s = await login(app, fx.email.adminSucA1);
      const r = await request(app).get(`/api/reportes/estadisticas?desde=${d(-1)}&hasta=${d(1)}`).set(bearer(s.token));
      expect(r.status).toBe(200);
      const aprobadoA1 = Number((await uno(`SELECT COALESCE(SUM(monto),0) AS t FROM pagos WHERE residente_id = $1 AND estado = 'aprobado'`, [fx.residentes.A1])).t);
      expect(aprobadoA1).toBe(500);
      expect(await saldoDe(fx.residentes.A1)).toBe(500);                     // 1000 - 400 - 100
      expect(r.body.pagos.recaudado).toBeGreaterThanOrEqual(500);
    });
  });
});
