/**
 * ── Por qué se prioriza esta lógica para testing ─────────────────────────────
 * revisarEstadosMora() es lógica de negocio crítica: decide automáticamente el
 * estado de pago de los residentes (al_dia → pendiente → mora) según la
 * antigüedad de la deuda. Un error aquí cobra mora a quien no debe o deja pasar
 * a un moroso, con impacto financiero y de acceso. No es un CRUD trivial.
 *
 * La clasificación por antigüedad vive en SQL (UPDATE ... WHERE con INTERVAL),
 * así que con pool.query mockeado verificamos dos cosas:
 *   1) que la función enrute correctamente las filas afectadas (rowCount) a
 *      { movidos_a_mora, movidos_a_pendiente }, y
 *   2) que emita las consultas con los umbrales correctos (>30 días / 15–30
 *      días) dentro de una transacción (BEGIN/COMMIT).
 */
jest.mock('../db/pool', () => ({
  __esModule: true,
  default: { query: jest.fn(), connect: jest.fn() },
}));

import pool from '../db/pool';
import { revisarEstadosMora } from '../jobs/mora.job';

const mockPool = pool as unknown as { connect: jest.Mock; query: jest.Mock };

// Cliente de transacción cuyo query() responde según el SQL recibido.
// moraRows / pendienteRows simulan cuántos residentes cayó cada UPDATE.
function makeClient(moraRows: number, pendienteRows: number) {
  const query = jest.fn((sql: string) => {
    if (sql.includes("estado_pago = 'pendiente'")) {
      return Promise.resolve({ rowCount: pendienteRows, rows: [] });
    }
    if (sql.includes("estado_pago = 'mora'")) {
      return Promise.resolve({ rowCount: moraRows, rows: [] });
    }
    return Promise.resolve({ rowCount: 0, rows: [] }); // BEGIN / COMMIT / ROLLBACK
  });
  return { query, release: jest.fn() };
}

describe('revisarEstadosMora', () => {
  it('mueve a "mora" al residente con deuda y sin pago hace 35 días (>30d o NULL)', async () => {
    const client = makeClient(1, 0);
    mockPool.connect.mockResolvedValue(client);

    const res = await revisarEstadosMora();

    expect(res).toEqual({ movidos_a_mora: 1, movidos_a_pendiente: 0 });

    // La consulta de mora usa el umbral de 30 días o fecha_ultimo_pago NULL
    const moraSql = client.query.mock.calls.map(c => c[0] as string)
      .find(s => s.includes("estado_pago = 'mora'"))!;
    expect(moraSql).toContain("INTERVAL '30 days'");
    expect(moraSql).toContain('fecha_ultimo_pago IS NULL');

    // Se ejecutó dentro de una transacción y confirmó
    const sqls = client.query.mock.calls.map(c => c[0] as string);
    expect(sqls[0]).toBe('BEGIN');
    expect(sqls).toContain('COMMIT');
    expect(sqls).not.toContain('ROLLBACK');
    expect(client.release).toHaveBeenCalled();
  });

  it('mueve a "pendiente" al residente con deuda de 20 días (15–30d y aún al_dia)', async () => {
    const client = makeClient(0, 1);
    mockPool.connect.mockResolvedValue(client);

    const res = await revisarEstadosMora();

    expect(res).toEqual({ movidos_a_mora: 0, movidos_a_pendiente: 1 });

    // La consulta de pendiente delimita la ventana 15–30 días sobre al_dia
    const pendSql = client.query.mock.calls.map(c => c[0] as string)
      .find(s => s.includes("estado_pago = 'pendiente'"))!;
    expect(pendSql).toContain("INTERVAL '15 days'");
    expect(pendSql).toContain("INTERVAL '30 days'");
    expect(pendSql).toContain("estado_pago = 'al_dia'");
  });

  it('deja "al_dia" al residente con pago reciente (ningún UPDATE afecta filas)', async () => {
    const client = makeClient(0, 0);
    mockPool.connect.mockResolvedValue(client);

    const res = await revisarEstadosMora();

    expect(res).toEqual({ movidos_a_mora: 0, movidos_a_pendiente: 0 });
    const sqls = client.query.mock.calls.map(c => c[0] as string);
    expect(sqls).toContain('COMMIT');
    expect(sqls).not.toContain('ROLLBACK');
  });

  it('hace ROLLBACK y propaga el error si un UPDATE falla', async () => {
    const failing = {
      query: jest.fn((sql: string) => {
        if (sql.includes("estado_pago = 'mora'")) return Promise.reject(new Error('db down'));
        return Promise.resolve({ rowCount: 0, rows: [] });
      }),
      release: jest.fn(),
    };
    mockPool.connect.mockResolvedValue(failing);

    await expect(revisarEstadosMora()).rejects.toThrow('db down');
    expect(failing.query).toHaveBeenCalledWith('ROLLBACK');
    expect(failing.release).toHaveBeenCalled();
  });
});
