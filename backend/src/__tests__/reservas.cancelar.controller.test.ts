/**
 * ── Por qué se prioriza esta lógica para testing ─────────────────────────────
 * cancelarReserva() decide cuánto dinero se le devuelve al residente según lo
 * cerca que esté la fecha. Tres cosas pueden salir mal en silencio:
 *
 *   1. Un reembolso del 100 % NO puede escribirse como monto = 0: la tabla
 *      pagos tiene CHECK (monto > 0) y el UPDATE reventaría en producción.
 *      Hay que anular la fila entera.
 *   2. Los tramos se deciden con las horas restantes; si se calcularan contra
 *      NOW() en UTC en vez de la hora local, el desfase de 6 h de Guatemala
 *      movería reservas de un tramo a otro y devolvería mal el dinero.
 *   3. Restar del saldo sin GREATEST(..., 0) viola el CHECK (saldo >= 0).
 */
jest.mock('../db/pool', () => ({
  __esModule: true,
  default: { query: jest.fn(), connect: jest.fn() },
}));

import pool from '../db/pool';
import { cancelarReserva } from '../controllers/reservas.controller';
import type { Request, Response } from 'express';

const mockPool = pool as unknown as { connect: jest.Mock; query: jest.Mock };

function makeRes() {
  const res: Partial<Response> = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  res.send = jest.fn().mockReturnValue(res);
  return res as Response;
}

const CONFIG_BASE = {
  sucursal_id: 'suc-1',
  permite_cancelacion: true,
  horas_limite_cancelacion_completa: 48,
  horas_limite_cancelacion_parcial: 24,
  porcentaje_reembolso_parcial: '50.00',
  max_reservas_activas_por_residente: null,
  requiere_aprobacion_admin: false,
  buffer_minutos_entre_reservas: 0,
  buffer_motivo: null,
};

const RESERVA_BASE = {
  id: 'rsv-1',
  estado: 'confirmada',
  cargo_id: 'pago-1',
  monto_cargo: '80.00',
  residente_id: 'res-1',
  fecha: '2026-09-10',
  hora_inicio: '14:00:00',
  hora_fin: '16:00:00',
  sucursal_id: 'suc-1',
  area_nombre: 'Salón Social',
};

interface Overrides {
  reserva?: Partial<typeof RESERVA_BASE> | null;
  config?: Partial<typeof CONFIG_BASE>;
  /** rowCount del UPDATE pagos: 0 simula un cargo ya cobrado/aprobado. */
  cargoRowCount?: number;
  /** Id del residente logueado; distinto de 'res-1' simula a un tercero. */
  residenteActual?: string;
}

function makeClient(horasRestantes: number, over: Overrides = {}) {
  const query = jest.fn((sql: string) => {
    // La autorización resuelve el residente sobre el MISMO client de la
    // transacción, no sobre el pool.
    if (sql.includes('FROM residentes WHERE usuario_id')) {
      return Promise.resolve({
        rows: [{ id: over.residenteActual ?? 'res-1', sucursal_id: 'suc-1' }],
      });
    }
    if (sql.includes('FOR UPDATE OF r')) {
      return Promise.resolve({
        rows:
          over.reserva === null
            ? []
            : [{ ...RESERVA_BASE, ...over.reserva, horas_restantes: horasRestantes }],
      });
    }
    if (sql.includes('FROM configuracion_reservas')) {
      return Promise.resolve({ rows: [{ ...CONFIG_BASE, ...over.config }] });
    }
    if (sql.includes('UPDATE pagos')) {
      return Promise.resolve({ rows: [{ id: 'pago-1' }], rowCount: over.cargoRowCount ?? 1 });
    }
    if (sql.includes('UPDATE reservas_areas')) {
      return Promise.resolve({ rows: [{ id: 'rsv-1', estado: 'cancelada' }], rowCount: 1 });
    }
    return Promise.resolve({ rows: [], rowCount: 0 });
  });
  return { query, release: jest.fn() };
}

/** Respaldo a nivel de pool; la autorización real ocurre sobre el client. */
function stubResidenteDueño(id = 'res-1') {
  mockPool.query.mockResolvedValue({ rows: [{ id, sucursal_id: 'suc-1' }] });
}

const makeReq = () =>
  ({
    params: { id: 'rsv-1' },
    body: { motivo: 'Cambio de planes' },
    user: { id: 'u-1', rol: 'residente', sucursal_id: 'suc-1', empresa_id: null },
  }) as unknown as Request;

const sqlsDe = (c: { query: jest.Mock }) => c.query.mock.calls.map(x => x[0] as string);
const llamadaCon = (c: { query: jest.Mock }, needle: string) =>
  c.query.mock.calls.find(x => (x[0] as string).includes(needle));

describe('cancelarReserva — tramos de reembolso', () => {
  it('con 72 h de antelación (>= 48) anula el cargo en vez de ponerlo en 0', async () => {
    stubResidenteDueño();
    const client = makeClient(72);
    mockPool.connect.mockResolvedValue(client);
    const res = makeRes();

    await cancelarReserva(makeReq(), res);

    const [sqlPago] = llamadaCon(client, 'UPDATE pagos')!;
    expect(sqlPago as string).toContain("estado = 'anulado'");
    // monto = 0 violaría pagos_monto_check: CHECK (monto > 0)
    expect(sqlPago as string).not.toMatch(/monto\s*=\s*0/);

    const [, paramsReserva] = llamadaCon(client, 'UPDATE reservas_areas')!;
    expect(paramsReserva as unknown[]).toContain(100);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ reembolso_aplicado: 100, cargo_anulado: true })
    );
    expect(sqlsDe(client)).toContain('COMMIT');
  });

  it('con 30 h (entre parcial y completa) reduce el cargo al porcentaje configurado', async () => {
    stubResidenteDueño();
    const client = makeClient(30);
    mockPool.connect.mockResolvedValue(client);
    const res = makeRes();

    await cancelarReserva(makeReq(), res);

    const [sqlPago, paramsPago] = llamadaCon(client, 'UPDATE pagos')!;
    expect(sqlPago as string).toContain('SET monto =');
    // Q80 con 50 % de reembolso → quedan Q40 por pagar
    expect(paramsPago as unknown[]).toContain(40);

    const [, paramsReserva] = llamadaCon(client, 'UPDATE reservas_areas')!;
    expect(paramsReserva as unknown[]).toContain(50);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ reembolso_aplicado: 50, monto_reembolsado: 40 })
    );
  });

  it('con 3 h (por debajo del límite parcial) no toca el cargo', async () => {
    stubResidenteDueño();
    const client = makeClient(3);
    mockPool.connect.mockResolvedValue(client);
    const res = makeRes();

    await cancelarReserva(makeReq(), res);

    expect(sqlsDe(client).some(s => s.includes('UPDATE pagos'))).toBe(false);

    const [, paramsReserva] = llamadaCon(client, 'UPDATE reservas_areas')!;
    expect(paramsReserva as unknown[]).toContain(0);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ reembolso_aplicado: 0, monto_reembolsado: 0 })
    );
  });

  it('una reserva ya iniciada (horas negativas) cae en el tramo sin reembolso', async () => {
    stubResidenteDueño();
    const client = makeClient(-5);
    mockPool.connect.mockResolvedValue(client);
    const res = makeRes();

    await cancelarReserva(makeReq(), res);

    expect(sqlsDe(client).some(s => s.includes('UPDATE pagos'))).toBe(false);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ reembolso_aplicado: 0 }));
  });

  it('un reembolso parcial que redondea a 0 anula la fila en vez de romper el CHECK', async () => {
    stubResidenteDueño();
    // 100 % de reembolso parcial ⇒ monto restante 0 ⇒ debe anular, no actualizar
    const client = makeClient(30, { config: { porcentaje_reembolso_parcial: '100.00' } });
    mockPool.connect.mockResolvedValue(client);
    const res = makeRes();

    await cancelarReserva(makeReq(), res);

    const [sqlPago] = llamadaCon(client, 'UPDATE pagos')!;
    expect(sqlPago as string).toContain("estado = 'anulado'");
    expect(sqlPago as string).not.toMatch(/monto\s*=\s*0/);
  });
});

describe('cancelarReserva — saldo y cargos ya cobrados', () => {
  it('descuenta del saldo con GREATEST(..., 0) para respetar el CHECK de la columna', async () => {
    stubResidenteDueño();
    const client = makeClient(72);
    mockPool.connect.mockResolvedValue(client);

    await cancelarReserva(makeReq(), makeRes());

    const [sqlSaldo] = llamadaCon(client, 'UPDATE residentes')!;
    expect(sqlSaldo as string).toContain('GREATEST(saldo_pendiente - $1, 0)');
  });

  it('si el cargo ya estaba cobrado, no lo muta y marca gestión manual', async () => {
    stubResidenteDueño();
    const client = makeClient(72, { cargoRowCount: 0 });
    mockPool.connect.mockResolvedValue(client);
    const res = makeRes();

    await cancelarReserva(makeReq(), res);

    // No se descuenta del saldo un dinero que ya entró
    expect(sqlsDe(client).some(s => s.includes('UPDATE residentes'))).toBe(false);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ reembolso_pendiente_gestion: true, cargo_anulado: false })
    );
    // La reserva igualmente queda cancelada
    expect(sqlsDe(client).some(s => s.includes('UPDATE reservas_areas'))).toBe(true);
  });

  it('una reserva gratis (sin cargo) se cancela sin tocar pagos', async () => {
    stubResidenteDueño();
    const client = makeClient(72, { reserva: { cargo_id: null, monto_cargo: '0.00' } });
    mockPool.connect.mockResolvedValue(client);
    const res = makeRes();

    await cancelarReserva(makeReq(), res);

    expect(sqlsDe(client).some(s => s.includes('UPDATE pagos'))).toBe(false);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ reembolso_aplicado: 100 }));
  });
});

describe('cancelarReserva — reglas y permisos', () => {
  it('rechaza con 409 si el residencial tiene la cancelación deshabilitada', async () => {
    stubResidenteDueño();
    const client = makeClient(72, { config: { permite_cancelacion: false } });
    mockPool.connect.mockResolvedValue(client);
    const res = makeRes();

    await cancelarReserva(makeReq(), res);

    expect(res.status).toHaveBeenCalledWith(409);
    const sqls = sqlsDe(client);
    expect(sqls.some(s => s.includes('UPDATE reservas_areas'))).toBe(false);
    expect(sqls.some(s => s.includes('UPDATE pagos'))).toBe(false);
    expect(sqls).toContain('ROLLBACK');
    expect(sqls).not.toContain('COMMIT');
  });

  it('no vuelve a cancelar una reserva ya cancelada (409)', async () => {
    stubResidenteDueño();
    const client = makeClient(72, { reserva: { estado: 'cancelada' } });
    mockPool.connect.mockResolvedValue(client);
    const res = makeRes();

    await cancelarReserva(makeReq(), res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(sqlsDe(client).some(s => s.includes('UPDATE reservas_areas'))).toBe(false);
    expect(sqlsDe(client)).toContain('ROLLBACK');
  });

  it('impide a un residente cancelar la reserva de otro (403)', async () => {
    stubResidenteDueño('res-ajeno');
    const client = makeClient(72, { residenteActual: 'res-ajeno' });
    mockPool.connect.mockResolvedValue(client);
    const res = makeRes();

    await cancelarReserva(makeReq(), res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(sqlsDe(client)).toContain('ROLLBACK');
  });

  it('devuelve 404 si la reserva no existe', async () => {
    stubResidenteDueño();
    const client = makeClient(72, { reserva: null });
    mockPool.connect.mockResolvedValue(client);
    const res = makeRes();

    await cancelarReserva(makeReq(), res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(sqlsDe(client)).toContain('ROLLBACK');
  });

  it('calcula las horas restantes en SQL y en hora local, no contra NOW() en UTC', async () => {
    stubResidenteDueño();
    const client = makeClient(72);
    mockPool.connect.mockResolvedValue(client);

    await cancelarReserva(makeReq(), makeRes());

    const [sql] = llamadaCon(client, 'FOR UPDATE OF r')!;
    expect(sql as string).toContain('AT TIME ZONE');
    expect(sql as string).toContain('EXTRACT(EPOCH FROM');
    expect(sql as string).toContain('/ 3600');
    // Compone fecha + hora a timestamp para comparar
    expect(sql as string).toContain('r.fecha + r.hora_inicio');
  });

  it('notifica al residente antes del COMMIT', async () => {
    stubResidenteDueño();
    const client = makeClient(72);
    mockPool.connect.mockResolvedValue(client);

    await cancelarReserva(makeReq(), makeRes());

    const sqls = sqlsDe(client);
    const iNotif = sqls.findIndex(s => s.includes('INSERT INTO anuncios'));
    expect(iNotif).toBeGreaterThan(-1);
    expect(iNotif).toBeLessThan(sqls.indexOf('COMMIT'));
  });
});
