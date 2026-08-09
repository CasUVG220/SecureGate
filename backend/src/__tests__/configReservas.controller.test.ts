/**
 * ── Por qué se prioriza esta lógica para testing ─────────────────────────────
 * Dos detalles de esta configuración se rompen en silencio:
 *
 *   1. getConfigReservas debe devolver los defaults SIN crear la fila. Si la
 *      materializara, "todavía no configurado" pasaría a ser indistinguible de
 *      "configurado con los valores por defecto".
 *   2. max_reservas_activas_por_residente y buffer_motivo son tri-estado: NULL
 *      significa "sin límite" / "sin motivo". El idioma COALESCE($n, col) que
 *      usa todo el proyecto NUNCA puede escribir NULL, así que sin el centinela
 *      booleano el admin no podría volver a quitar un límite ya puesto.
 */
jest.mock('../db/pool', () => ({
  __esModule: true,
  default: { query: jest.fn(), connect: jest.fn() },
}));

import pool from '../db/pool';
import {
  getConfigReservas,
  updateConfigReservas,
} from '../controllers/configReservas.controller';
import type { Request, Response } from 'express';

const mockPool = pool as unknown as { query: jest.Mock };

function makeRes() {
  const res: Partial<Response> = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  res.send = jest.fn().mockReturnValue(res);
  return res as Response;
}

const makeReq = (body: Record<string, unknown> = {}) =>
  ({
    body,
    query: {},
    params: {},
    user: { id: 'u-1', rol: 'admin_sucursal', sucursal_id: 'suc-1', empresa_id: null },
  }) as unknown as Request;

const sqls = () => mockPool.query.mock.calls.map(c => c[0] as string);

describe('getConfigReservas', () => {
  it('devuelve los defaults sin insertar fila cuando la sucursal no tiene configuración', async () => {
    mockPool.query.mockResolvedValue({ rows: [] });
    const res = makeRes();

    await getConfigReservas(makeReq(), res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        sucursal_id: 'suc-1',
        permite_cancelacion: true,
        horas_limite_cancelacion_completa: 48,
        horas_limite_cancelacion_parcial: 24,
        porcentaje_reembolso_parcial: 50,
        max_reservas_activas_por_residente: null,
        requiere_aprobacion_admin: false,
        buffer_minutos_entre_reservas: 0,
        es_default: true,
      })
    );
    // Nada de escribir: la fila nace cuando el admin guarda
    expect(sqls().some(s => s.includes('INSERT'))).toBe(false);
  });

  it('devuelve la fila guardada marcada como no-default', async () => {
    mockPool.query.mockResolvedValue({
      rows: [
        {
          sucursal_id: 'suc-1',
          permite_cancelacion: false,
          horas_limite_cancelacion_completa: 72,
          horas_limite_cancelacion_parcial: 36,
          porcentaje_reembolso_parcial: '25.00',
          max_reservas_activas_por_residente: 2,
          requiere_aprobacion_admin: true,
          buffer_minutos_entre_reservas: 45,
          buffer_motivo: 'Limpieza',
        },
      ],
    });
    const res = makeRes();

    await getConfigReservas(makeReq(), res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        es_default: false,
        horas_limite_cancelacion_completa: 72,
        // NUMERIC llega como string desde pg y se normaliza a número
        porcentaje_reembolso_parcial: 25,
        max_reservas_activas_por_residente: 2,
        buffer_motivo: 'Limpieza',
      })
    );
  });
});

describe('updateConfigReservas', () => {
  it('permite volver a "sin límite" (NULL), que COALESCE nunca podría escribir', async () => {
    mockPool.query.mockResolvedValue({ rows: [{ sucursal_id: 'suc-1' }] });

    await updateConfigReservas(
      makeReq({ max_reservas_activas_por_residente: null }),
      makeRes()
    );

    const upsert = mockPool.query.mock.calls.find(c =>
      (c[0] as string).includes('INSERT INTO configuracion_reservas')
    )!;
    expect(upsert[0] as string).toContain('CASE WHEN $10::boolean');
    const params = upsert[1] as unknown[];
    expect(params[5]).toBeNull(); // el valor
    expect(params[9]).toBe(true); // el centinela: "la clave vino en el body"
  });

  it('no pisa el límite existente cuando la clave no viene en el body', async () => {
    mockPool.query.mockResolvedValue({ rows: [{ sucursal_id: 'suc-1' }] });

    await updateConfigReservas(makeReq({ buffer_minutos_entre_reservas: 15 }), makeRes());

    const upsert = mockPool.query.mock.calls.find(c =>
      (c[0] as string).includes('INSERT INTO configuracion_reservas')
    )!;
    expect((upsert[1] as unknown[])[9]).toBe(false);
  });

  it('rechaza que el límite completo sea menor al parcial antes de tocar la base', async () => {
    const res = makeRes();

    await updateConfigReservas(
      makeReq({
        horas_limite_cancelacion_completa: 12,
        horas_limite_cancelacion_parcial: 48,
      }),
      res
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(sqls().some(s => s.includes('INSERT INTO configuracion_reservas'))).toBe(false);
  });

  it('rechaza un porcentaje de reembolso fuera de 0–100', async () => {
    const res = makeRes();

    await updateConfigReservas(makeReq({ porcentaje_reembolso_parcial: 150 }), res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(sqls().some(s => s.includes('INSERT INTO configuracion_reservas'))).toBe(false);
  });

  it('rechaza un límite de reservas que no sea un entero positivo', async () => {
    const res = makeRes();

    await updateConfigReservas(makeReq({ max_reservas_activas_por_residente: 0 }), res);

    expect(res.status).toHaveBeenCalledWith(400);
  });
});
