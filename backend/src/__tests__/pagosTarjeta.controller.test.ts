/**
 * ── Por qué se prioriza esta lógica para testing ─────────────────────────────
 * pagarConTarjeta() es la pasarela simulada del sprint 7 y toca dinero: al
 * aprobar deja el saldo del residente en 0 y liquida los cargos de reserva. Dos
 * cosas tienen que quedar blindadas antes de que entre Visanet:
 *   1. un cobro rechazado NO puede tocar el saldo ni guardarse como pago, y
 *   2. del instrumento sólo pueden persistirse los últimos 4 dígitos.
 * Si alguna se rompe, el residente aparece al día sin haber pagado o el número
 * completo de la tarjeta termina en la base.
 */
jest.mock('../db/pool', () => ({
  __esModule: true,
  default: { query: jest.fn(), connect: jest.fn() },
}));

import pool from '../db/pool';
import { pagarConTarjeta, simularAutorizacionTarjeta, getEstadoTarjeta } from '../controllers/pagos.controller';
import type { Request, Response } from 'express';

const mockPool = pool as unknown as { connect: jest.Mock };

function makeRes() {
  const res: Partial<Response> = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res as Response;
}

function makeClient(estadoEsperado: 'aprobado' | 'rechazado') {
  return {
    query: jest.fn((sql: string, _params?: unknown[]) => {
      if (sql.includes('FROM residentes WHERE usuario_id')) {
        return Promise.resolve({ rows: [{ id: 'res-1', sucursal_id: 'suc-1' }] });
      }
      if (sql.includes('INSERT INTO pagos')) {
        return Promise.resolve({ rows: [{ id: 'pago-1', estado: estadoEsperado, es_simulado: true }] });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    }),
    release: jest.fn(),
  };
}

const reqCon = (body: Record<string, unknown>) =>
  ({ body, user: { id: 'usr-1' } } as unknown as Request);

describe('simularAutorizacionTarjeta — regla mock determinística', () => {
  it('rechaza las tarjetas cuyo número termina en 1', () => {
    expect(simularAutorizacionTarjeta('0001')).toBe('rechazado');
    expect(simularAutorizacionTarjeta('4321')).toBe('rechazado');
  });

  it('aprueba cualquier otra terminación', () => {
    expect(simularAutorizacionTarjeta('1111'.slice(0, 3) + '2')).toBe('aprobado');
    expect(simularAutorizacionTarjeta('4444')).toBe('aprobado');
  });
});

describe('pagarConTarjeta', () => {
  // La pasarela simulada sólo se habilita de forma explícita (ver el controller).
  const previo = process.env.PAGOS_TARJETA_SIMULADA;
  beforeAll(() => { process.env.PAGOS_TARJETA_SIMULADA = 'true'; });
  afterAll(() => {
    if (previo === undefined) delete process.env.PAGOS_TARJETA_SIMULADA;
    else process.env.PAGOS_TARJETA_SIMULADA = previo;
  });

  it('aprobado: registra el pago simulado y deja el saldo en 0', async () => {
    const client = makeClient('aprobado');
    mockPool.connect.mockResolvedValue(client);
    const res = makeRes();

    await pagarConTarjeta(reqCon({ monto: 850, ultimos4: '4444', titular: 'JUAN PEREZ' }), res);

    const sqls = client.query.mock.calls.map(c => c[0] as string);
    expect(sqls).toContain('BEGIN');
    expect(sqls).toContain('COMMIT');
    expect(sqls.some(s => s.includes('UPDATE residentes'))).toBe(true);
    expect(res.status).toHaveBeenCalledWith(201);

    const insert = client.query.mock.calls.find(c => String(c[0]).includes('INSERT INTO pagos'))!;
    expect(String(insert[0])).toContain("'tarjeta'");
    expect(String(insert[0])).toContain('es_simulado');
    expect(insert[1]).toContain('aprobado');
  });

  it('rechazado: responde 402, NO guarda ningún pago y NO toca el saldo del residente', async () => {
    const client = makeClient('rechazado');
    mockPool.connect.mockResolvedValue(client);
    const res = makeRes();

    await pagarConTarjeta(reqCon({ monto: 850, ultimos4: '0001', titular: 'JUAN PEREZ' }), res);

    const sqls = client.query.mock.calls.map(c => c[0] as string);
    // Un intento rechazado no es un pago: no ensucia el historial ni los reportes de ingresos.
    // (Queda en la auditoría de la ruta con el código 402.)
    expect(sqls.some(s => s.includes('INSERT INTO pagos'))).toBe(false);
    expect(sqls).not.toContain('BEGIN');
    expect(sqls.some(s => s.includes('UPDATE residentes'))).toBe(false);
    expect(sqls.some(s => s.includes("metodo = 'reserva'"))).toBe(false);
    expect(res.status).toHaveBeenCalledWith(402);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ estado: 'rechazado', error: expect.stringMatching(/rechazado/i) }));
    expect(client.release).toHaveBeenCalled();
  });

  it('sólo persiste los últimos 4 dígitos del instrumento', async () => {
    const client = makeClient('aprobado');
    mockPool.connect.mockResolvedValue(client);

    await pagarConTarjeta(reqCon({ monto: 100, ultimos4: '4444', titular: 'JUAN PEREZ' }), makeRes());

    const insert = client.query.mock.calls.find(c => String(c[0]).includes('INSERT INTO pagos'))!;
    const params = JSON.stringify(insert[1]);
    expect(params).toContain('4444');
    expect(params).not.toContain('4111111111111111');
  });

  it('valida el monto y el formato de ultimos4 antes de tocar la base', async () => {
    const res1 = makeRes();
    await pagarConTarjeta(reqCon({ monto: 0, ultimos4: '4444' }), res1);
    expect(res1.status).toHaveBeenCalledWith(400);

    const res2 = makeRes();
    await pagarConTarjeta(reqCon({ monto: 100, ultimos4: '44' }), res2);
    expect(res2.status).toHaveBeenCalledWith(400);

    const res3 = makeRes();
    await pagarConTarjeta(reqCon({ monto: 100 }), res3);
    expect(res3.status).toHaveBeenCalledWith(400);

    expect(mockPool.connect).not.toHaveBeenCalled();
  });

  it('404 si el usuario logueado no es residente de ninguna sucursal', async () => {
    const client = {
      query: jest.fn((_sql: string, _params?: unknown[]) => Promise.resolve({ rows: [], rowCount: 0 })),
      release: jest.fn(),
    };
    mockPool.connect.mockResolvedValue(client);
    const res = makeRes();

    await pagarConTarjeta(reqCon({ monto: 100, ultimos4: '4444' }), res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(client.query.mock.calls.map(c => c[0] as string)).not.toContain('BEGIN');
    expect(client.release).toHaveBeenCalled();
  });
});

describe('getEstadoTarjeta — qué ve el residente', () => {
  const previo = process.env.PAGOS_TARJETA_SIMULADA;
  afterEach(() => {
    if (previo === undefined) delete process.env.PAGOS_TARJETA_SIMULADA;
    else process.env.PAGOS_TARJETA_SIMULADA = previo;
  });

  it('con la bandera de prueba: disponible y simulada (el portal muestra el aviso de entorno de prueba)', () => {
    process.env.PAGOS_TARJETA_SIMULADA = 'true';
    const res = makeRes();
    getEstadoTarjeta({} as Request, res);
    expect(res.json).toHaveBeenCalledWith({ disponible: true, simulada: true });
  });

  it.each([undefined, 'false', ''])('PAGOS_TARJETA_SIMULADA=%p: no disponible y sin textos de simulación', valor => {
    if (valor === undefined) delete process.env.PAGOS_TARJETA_SIMULADA;
    else process.env.PAGOS_TARJETA_SIMULADA = valor;
    const res = makeRes();
    getEstadoTarjeta({} as Request, res);
    expect(res.json).toHaveBeenCalledWith({ disponible: false, simulada: false });
  });
});

describe('pagarConTarjeta — interruptor de la pasarela simulada', () => {
  const previo = process.env.PAGOS_TARJETA_SIMULADA;
  afterEach(() => {
    if (previo === undefined) delete process.env.PAGOS_TARJETA_SIMULADA;
    else process.env.PAGOS_TARJETA_SIMULADA = previo;
  });

  it.each([undefined, 'false', '1', ''])(
    'PAGOS_TARJETA_SIMULADA=%p → 501 y NO toca la base (nadie liquida su deuda con una tarjeta falsa)',
    async valor => {
      if (valor === undefined) delete process.env.PAGOS_TARJETA_SIMULADA;
      else process.env.PAGOS_TARJETA_SIMULADA = valor;
      mockPool.connect.mockClear();

      const res = makeRes();
      await pagarConTarjeta(reqCon({ monto: 100, ultimos4: '0000' }), res);

      expect(res.status).toHaveBeenCalledWith(501);
      expect(mockPool.connect).not.toHaveBeenCalled();
    },
  );
});
