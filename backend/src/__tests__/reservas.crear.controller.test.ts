/**
 * ── Por qué se prioriza esta lógica para testing ─────────────────────────────
 * crearReserva() es el handler más delicado del módulo: decide quién se queda
 * con un horario cuando dos residentes lo piden a la vez, y genera un cargo
 * real contra el saldo del residente. Dos fallos serían caros y silenciosos:
 *
 *   1. Si el lock del área se toma después (o no se toma), dos INSERT
 *      concurrentes se cuelan — un SELECT ... FOR UPDATE sobre reservas_areas
 *      NO bloquea la inserción de una fila que todavía no existe (fantasma).
 *   2. Si el buffer se expandiera sobre los dos intervalos en vez de uno, se
 *      exigiría el doble de separación y se rechazarían reservas válidas.
 *
 * Se testea el SQL emitido y su ORDEN, no sólo la respuesta HTTP, porque el
 * orden de los locks *es* la garantía de corrección.
 */
jest.mock('../db/pool', () => ({
  __esModule: true,
  default: { query: jest.fn(), connect: jest.fn() },
}));

import pool from '../db/pool';
import { crearReserva } from '../controllers/reservas.controller';
import type { Request, Response } from 'express';

const mockPool = pool as unknown as { connect: jest.Mock; query: jest.Mock };

function makeRes() {
  const res: Partial<Response> = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  res.send = jest.fn().mockReturnValue(res);
  return res as Response;
}

const AREA_BASE = {
  id: 'area-1',
  sucursal_id: 'suc-1',
  nombre: 'Salón Social',
  tarifa_tipo: 'gratis',
  tarifa_monto: '0.00',
  requiere_aprobacion: null,
  activa: true,
};

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

interface Overrides {
  area?: Partial<typeof AREA_BASE> | null;
  config?: Partial<typeof CONFIG_BASE> | null;
  solape?: unknown[];
  activas?: number;
  insertError?: Error;
}

function makeClient(over: Overrides = {}) {
  const query = jest.fn((sql: string) => {
    if (sql.includes('FROM residentes') && sql.includes('FOR NO KEY UPDATE')) {
      return Promise.resolve({ rows: [{ id: 'res-1' }] });
    }
    if (sql.includes('FROM areas_comunes') && sql.includes('FOR UPDATE')) {
      return Promise.resolve({
        rows: over.area === null ? [] : [{ ...AREA_BASE, ...over.area }],
      });
    }
    if (sql.includes('FROM configuracion_reservas')) {
      return Promise.resolve({
        rows: over.config === null ? [] : [{ ...CONFIG_BASE, ...over.config }],
      });
    }
    if (sql.includes('COUNT(*)::int AS activas')) {
      return Promise.resolve({ rows: [{ activas: over.activas ?? 0 }] });
    }
    if (sql.includes('FROM reservas_areas r') && sql.includes('r.area_id = $1')) {
      return Promise.resolve({ rows: over.solape ?? [] });
    }
    if (sql.includes('INSERT INTO pagos')) {
      return Promise.resolve({ rows: [{ id: 'pago-1' }], rowCount: 1 });
    }
    if (sql.includes('INSERT INTO reservas_areas')) {
      if (over.insertError) return Promise.reject(over.insertError);
      return Promise.resolve({
        rows: [{ id: 'rsv-1', estado: 'confirmada' }],
        rowCount: 1,
      });
    }
    return Promise.resolve({ rows: [], rowCount: 0 });
  });
  return { query, release: jest.fn() };
}

/** El controlador resuelve el residente con el pool antes de abrir transacción. */
function stubResidente(sucursal_id = 'suc-1') {
  mockPool.query.mockResolvedValue({ rows: [{ id: 'res-1', sucursal_id }] });
}

const makeReq = (body: Record<string, unknown> = {}) =>
  ({
    body: {
      area_id: 'area-1',
      fecha: '2026-09-10',
      hora_inicio: '14:00',
      hora_fin: '16:00',
      ...body,
    },
    user: { id: 'u-1', rol: 'residente', sucursal_id: 'suc-1', empresa_id: null },
  }) as unknown as Request;

const sqlsDe = (c: { query: jest.Mock }) => c.query.mock.calls.map(x => x[0] as string);
const llamadaCon = (c: { query: jest.Mock }, needle: string) =>
  c.query.mock.calls.find(x => (x[0] as string).includes(needle));

describe('crearReserva — concurrencia y orden de locks', () => {
  it('bloquea residente y área ANTES de verificar solape, y el solape antes de insertar', async () => {
    stubResidente();
    const client = makeClient();
    mockPool.connect.mockResolvedValue(client);

    await crearReserva(makeReq(), makeRes());

    const sqls = sqlsDe(client);
    const iBegin = sqls.indexOf('BEGIN');
    const iLockRes = sqls.findIndex(s => s.includes('FOR NO KEY UPDATE'));
    const iLockArea = sqls.findIndex(
      s => s.includes('FROM areas_comunes') && s.includes('FOR UPDATE')
    );
    const iSolape = sqls.findIndex(s => s.includes('FROM reservas_areas r') && s.includes('r.area_id = $1'));
    const iInsert = sqls.findIndex(s => s.includes('INSERT INTO reservas_areas'));

    expect(iBegin).toBe(0);
    expect(iLockRes).toBeGreaterThan(iBegin);
    // Orden fijo residente → área: evita ciclos de deadlock
    expect(iLockRes).toBeLessThan(iLockArea);
    // El lock del área es lo que hace correcta la verificación de solape
    expect(iLockArea).toBeLessThan(iSolape);
    expect(iSolape).toBeLessThan(iInsert);
    expect(sqls).toContain('COMMIT');
  });

  it('bloquea residentes con FOR NO KEY UPDATE (no FOR UPDATE) para no frenar pagos y accesos', async () => {
    stubResidente();
    const client = makeClient();
    mockPool.connect.mockResolvedValue(client);

    await crearReserva(makeReq(), makeRes());

    const lockRes = sqlsDe(client).find(s => s.includes('FROM residentes') && s.includes('FOR'));
    expect(lockRes).toContain('FOR NO KEY UPDATE');
  });

  it('devuelve 409 con el mensaje del spec y NO inserta nada si el horario se solapa', async () => {
    stubResidente();
    const client = makeClient({ solape: [{ id: 'rsv-0', hora_inicio: '15:00', hora_fin: '17:00' }] });
    mockPool.connect.mockResolvedValue(client);
    const res = makeRes();

    await crearReserva(makeReq(), res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'Este horario ya fue reservado, por favor elige otro' })
    );

    const sqls = sqlsDe(client);
    expect(sqls.some(s => s.includes('INSERT INTO reservas_areas'))).toBe(false);
    expect(sqls.some(s => s.includes('INSERT INTO pagos'))).toBe(false);
    expect(sqls).toContain('ROLLBACK');
    expect(sqls).not.toContain('COMMIT');
    expect(client.release).toHaveBeenCalled();
  });

  it('traduce la violación del EXCLUDE (23P01) a 409 y revierte', async () => {
    stubResidente();
    const err = Object.assign(new Error('conflicting key value'), { code: '23P01' });
    const client = makeClient({ insertError: err });
    mockPool.connect.mockResolvedValue(client);
    const res = makeRes();

    await crearReserva(makeReq(), res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Este horario ya fue reservado, por favor elige otro',
    });
    expect(sqlsDe(client)).toContain('ROLLBACK');
  });
});

describe('crearReserva — buffer de mantenimiento', () => {
  it('aplica el buffer UNA sola vez (no exige el doble de separación)', async () => {
    stubResidente();
    const client = makeClient({ config: { buffer_minutos_entre_reservas: 30 } });
    mockPool.connect.mockResolvedValue(client);

    await crearReserva(makeReq(), makeRes());

    const [sql, params] = llamadaCon(client, 'r.area_id = $1')!;
    // Un make_interval por cada lado del candidato: cuatro significaría que se
    // expandieron ambos intervalos y se estaría exigiendo 2×buffer.
    expect(((sql as string).match(/make_interval/g) ?? []).length).toBe(2);
    // El buffer se ata una sola vez como parámetro
    expect((params as unknown[]).filter(p => p === 30)).toHaveLength(1);
  });

  it('opera sobre timestamps (fecha + hora), nunca sobre TIME —que envuelve en medianoche', async () => {
    stubResidente();
    const client = makeClient({ config: { buffer_minutos_entre_reservas: 60 } });
    mockPool.connect.mockResolvedValue(client);

    await crearReserva(makeReq(), makeRes());

    const [sql] = llamadaCon(client, 'r.area_id = $1')!;
    expect(sql as string).toContain('r.fecha + r.hora_inicio');
    expect(sql as string).toContain('r.fecha + r.hora_fin');
    // Sin aritmética directa sobre TIME: 23:30 + 60min daría 00:30
    expect(sql as string).not.toMatch(/hora_inicio\s*[+-]\s*make_interval/);
    // Busca también en el día anterior/siguiente por si el buffer cruza medianoche
    expect(sql as string).toContain("::date - 1");
    expect(sql as string).toContain("::date + 1");
  });
});

describe('crearReserva — cálculo del cargo', () => {
  it('tarifa por_hora: cobra horas × tarifa y crea el cargo en pagos', async () => {
    stubResidente();
    const client = makeClient({ area: { tarifa_tipo: 'por_hora', tarifa_monto: '25.00' } });
    mockPool.connect.mockResolvedValue(client);

    await crearReserva(makeReq({ hora_inicio: '10:00', hora_fin: '13:00' }), makeRes());

    const [sql, params] = llamadaCon(client, 'INSERT INTO pagos')!;
    expect(sql as string).toContain("'reserva'");
    expect(sql as string).toContain("'pendiente'");
    // 3 horas × Q25 = Q75
    expect(params as unknown[]).toContain(75);
    expect(
      (params as unknown[]).some(v => String(v).startsWith('Reserva: Salón Social - 2026-09-10'))
    ).toBe(true);

    // El cargo suma al saldo del residente
    expect(sqlsDe(client).some(s => s.includes('saldo_pendiente = saldo_pendiente +'))).toBe(true);
  });

  it('tarifa unica: cobra el monto plano sin importar la duración', async () => {
    stubResidente();
    const client = makeClient({ area: { tarifa_tipo: 'unica', tarifa_monto: '100.00' } });
    mockPool.connect.mockResolvedValue(client);

    await crearReserva(makeReq({ hora_inicio: '08:00', hora_fin: '20:00' }), makeRes());

    const [, params] = llamadaCon(client, 'INSERT INTO pagos')!;
    expect(params as unknown[]).toContain(100);
  });

  it('tarifa gratis: NO crea fila en pagos y deja cargo_id en NULL', async () => {
    stubResidente();
    const client = makeClient({ area: { tarifa_tipo: 'gratis', tarifa_monto: '0.00' } });
    mockPool.connect.mockResolvedValue(client);

    await crearReserva(makeReq(), makeRes());

    const sqls = sqlsDe(client);
    // pagos tiene CHECK (monto > 0): una reserva gratis no genera cargo
    expect(sqls.some(s => s.includes('INSERT INTO pagos'))).toBe(false);
    expect(sqls.some(s => s.includes('saldo_pendiente = saldo_pendiente +'))).toBe(false);

    const [, params] = llamadaCon(client, 'INSERT INTO reservas_areas')!;
    expect(params as unknown[]).toContain(null);
  });
});

describe('crearReserva — aprobación', () => {
  it('el override del área (true) gana sobre la config global (false)', async () => {
    stubResidente();
    const client = makeClient({
      area: { requiere_aprobacion: true },
      config: { requiere_aprobacion_admin: false },
    });
    mockPool.connect.mockResolvedValue(client);

    await crearReserva(makeReq(), makeRes());

    const [, params] = llamadaCon(client, 'INSERT INTO reservas_areas')!;
    expect(params as unknown[]).toContain('pendiente_aprobacion');
  });

  it('el override del área (false) gana sobre la config global (true)', async () => {
    stubResidente();
    const client = makeClient({
      area: { requiere_aprobacion: false },
      config: { requiere_aprobacion_admin: true },
    });
    mockPool.connect.mockResolvedValue(client);

    await crearReserva(makeReq(), makeRes());

    const [, params] = llamadaCon(client, 'INSERT INTO reservas_areas')!;
    expect(params as unknown[]).toContain('confirmada');
  });

  it('requiere_aprobacion NULL hereda el valor global de la sucursal', async () => {
    stubResidente();
    const client = makeClient({
      area: { requiere_aprobacion: null },
      config: { requiere_aprobacion_admin: true },
    });
    mockPool.connect.mockResolvedValue(client);

    await crearReserva(makeReq(), makeRes());

    const [, params] = llamadaCon(client, 'INSERT INTO reservas_areas')!;
    expect(params as unknown[]).toContain('pendiente_aprobacion');
  });

  it('sin fila de configuración usa los defaults (auto-confirmada)', async () => {
    stubResidente();
    const client = makeClient({ config: null, area: { requiere_aprobacion: null } });
    mockPool.connect.mockResolvedValue(client);

    await crearReserva(makeReq(), makeRes());

    const [, params] = llamadaCon(client, 'INSERT INTO reservas_areas')!;
    expect(params as unknown[]).toContain('confirmada');
  });
});

describe('crearReserva — límite de reservas activas', () => {
  it('devuelve 409 sin insertar cuando el residente alcanzó el máximo', async () => {
    stubResidente();
    const client = makeClient({
      config: { max_reservas_activas_por_residente: 2 },
      activas: 2,
    });
    mockPool.connect.mockResolvedValue(client);
    const res = makeRes();

    await crearReserva(makeReq(), res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ max_reservas_activas: 2 })
    );
    const sqls = sqlsDe(client);
    expect(sqls.some(s => s.includes('INSERT INTO reservas_areas'))).toBe(false);
    expect(sqls).toContain('ROLLBACK');
  });

  it('permite reservar cuando todavía hay cupo', async () => {
    stubResidente();
    const client = makeClient({
      config: { max_reservas_activas_por_residente: 3 },
      activas: 1,
    });
    mockPool.connect.mockResolvedValue(client);
    const res = makeRes();

    await crearReserva(makeReq(), res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(sqlsDe(client)).toContain('COMMIT');
  });

  it('sin límite configurado (NULL) ni siquiera ejecuta el conteo', async () => {
    stubResidente();
    const client = makeClient({ config: { max_reservas_activas_por_residente: null } });
    mockPool.connect.mockResolvedValue(client);

    await crearReserva(makeReq(), makeRes());

    expect(sqlsDe(client).some(s => s.includes('COUNT(*)::int AS activas'))).toBe(false);
  });

  it('cuenta sólo reservas futuras y en hora local (AT TIME ZONE)', async () => {
    stubResidente();
    const client = makeClient({ config: { max_reservas_activas_por_residente: 5 } });
    mockPool.connect.mockResolvedValue(client);

    await crearReserva(makeReq(), makeRes());

    const [sql] = llamadaCon(client, 'COUNT(*)::int AS activas')!;
    expect(sql as string).toContain('AT TIME ZONE');
    expect(sql as string).toContain("r.estado IN ('pendiente_aprobacion','confirmada')");
  });
});

describe('crearReserva — validación y notificación', () => {
  it('rechaza hora_fin <= hora_inicio sin abrir transacción', async () => {
    stubResidente();
    mockPool.connect.mockClear();
    const res = makeRes();

    await crearReserva(makeReq({ hora_inicio: '16:00', hora_fin: '14:00' }), res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockPool.connect).not.toHaveBeenCalled();
  });

  it('rechaza formatos de fecha inválidos sin tocar la base', async () => {
    stubResidente();
    mockPool.connect.mockClear();
    const res = makeRes();

    await crearReserva(makeReq({ fecha: '10-09-2026' }), res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockPool.connect).not.toHaveBeenCalled();
  });

  it('notifica al residente dentro de la misma transacción', async () => {
    stubResidente();
    const client = makeClient();
    mockPool.connect.mockResolvedValue(client);

    await crearReserva(makeReq(), makeRes());

    const sqls = sqlsDe(client);
    const iNotif = sqls.findIndex(s => s.includes('INSERT INTO anuncios'));
    expect(iNotif).toBeGreaterThan(-1);
    // Antes del COMMIT: la notificación es atómica con la reserva
    expect(iNotif).toBeLessThan(sqls.indexOf('COMMIT'));

    const [, params] = llamadaCon(client, 'INSERT INTO anuncios')!;
    expect(params as unknown[]).toContain('res-1');
  });

  it('rechaza con 409 si el área está inactiva', async () => {
    stubResidente();
    const client = makeClient({ area: { activa: false } });
    mockPool.connect.mockResolvedValue(client);
    const res = makeRes();

    await crearReserva(makeReq(), res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(sqlsDe(client)).toContain('ROLLBACK');
  });

  it('rechaza con 403 si el área es de otra sucursal', async () => {
    stubResidente('suc-otra');
    const client = makeClient();
    mockPool.connect.mockResolvedValue(client);
    const res = makeRes();

    await crearReserva(makeReq(), res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(sqlsDe(client)).toContain('ROLLBACK');
  });
});
