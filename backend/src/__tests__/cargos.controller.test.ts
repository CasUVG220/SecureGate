/**
 * ── Por qué se prioriza esta lógica para testing ─────────────────────────────
 * aplicarCargo() mueve dinero: suma el monto al saldo del residente. La
 * protección contra doble cobro (si aplicado === true, responder 409 sin
 * volver a sumar) es lógica de negocio crítica; un fallo cobraría dos veces al
 * residente. No es un CRUD trivial, por eso se prioriza sobre otros endpoints.
 */
jest.mock('../db/pool', () => ({
  __esModule: true,
  default: { query: jest.fn(), connect: jest.fn() },
}));

import pool from '../db/pool';
import { aplicarCargo } from '../controllers/cargos.controller';
import type { Request, Response } from 'express';

const mockPool = pool as unknown as { connect: jest.Mock };

function makeRes() {
  const res: Partial<Response> = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  res.send = jest.fn().mockReturnValue(res);
  return res as Response;
}

describe('aplicarCargo — prevención de doble cobro', () => {
  it('retorna 409 y NO vuelve a aplicar un cargo ya aplicado (aplicado=true)', async () => {
    const client = {
      query: jest.fn((sql: string, _params?: unknown[]) => {
        if (sql.includes('FROM cargos_automaticos ca')) {
          // El cargo ya fue aplicado previamente
          return Promise.resolve({ rows: [{ residente_id: 'r1', monto: '50.00', aplicado: true }] });
        }
        return Promise.resolve({ rows: [], rowCount: 0 }); // BEGIN / ROLLBACK
      }),
      release: jest.fn(),
    };
    mockPool.connect.mockResolvedValue(client);

    const req = {
      params: { id: 'cargo-1' },
      user: { id: 'u-1', rol: 'admin_sucursal', sucursal_id: 'suc-1', empresa_id: null },
    } as unknown as Request;
    const res = makeRes();

    await aplicarCargo(req, res);

    // Responde conflicto
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({ error: 'El cargo ya fue aplicado' });

    // No se ejecutó ningún UPDATE (ni al cargo ni al saldo del residente)
    const sqls = client.query.mock.calls.map(c => c[0] as string);
    expect(sqls.some(s => s.includes('UPDATE cargos_automaticos SET aplicado'))).toBe(false);
    expect(sqls.some(s => s.includes('UPDATE residentes'))).toBe(false);

    // La consulta del cargo se limita al alcance del usuario y bloquea la fila
    const cargoSql = sqls.find(s => s.includes('FROM cargos_automaticos ca'))!;
    expect(cargoSql).toContain('FOR UPDATE OF ca');
    expect(cargoSql).toContain('sucursales _os');
    const cargoParams = client.query.mock.calls.find(c => String(c[0]).includes('FROM cargos_automaticos ca'))![1];
    expect(cargoParams).toEqual(['cargo-1', 'admin_sucursal', null, 'suc-1']);

    // Se abrió transacción, se revirtió y se liberó el cliente
    expect(sqls).toContain('BEGIN');
    expect(sqls).toContain('ROLLBACK');
    expect(client.release).toHaveBeenCalled();
  });
});
