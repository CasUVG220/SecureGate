/**
 * GET /api/dashboard — resumen operativo del día.
 *
 * Lo que la pantalla da por hecho: una serie de 24 horas sin huecos, la
 * referencia de ayer a la misma hora y que TODAS las consultas lleven el filtro
 * de alcance del rol.
 */
jest.mock('../db/pool', () => ({
  __esModule: true,
  default: { query: jest.fn(), connect: jest.fn() },
}));

import pool from '../db/pool';
import { getDashboard } from '../controllers/dashboard.controller';
import type { Request, Response } from 'express';

const mockPool = pool as unknown as { query: jest.Mock };

const OWNER   = { id: 'u-owner', rol: 'owner',          sucursal_id: null,    empresa_id: null };
const ADM_EMP = { id: 'u-ae',    rol: 'admin_empresa',  sucursal_id: null,    empresa_id: 'emp-1' };
const ADM_SUC = { id: 'u-as',    rol: 'admin_sucursal', sucursal_id: 'suc-1', empresa_id: 'emp-1' };

const makeRes = () => {
  const res: Partial<Response> = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res as Response;
};

const RESPUESTAS: Array<[string, Array<Record<string, unknown>>]> = [
  ['EXTRACT(HOUR', [{ hora: 8, total: 3 }, { hora: 18, total: 7 }]],
  ['CURRENT_DATE - 1', [{ total: 9 }]],
  ['timestamp_salida IS NULL', [{ total: 2 }]],
  ['estado_pago', [{ total: 4, registrados: 120 }]],
  ["estado = 'pendiente'", [{ total: 6 }]],
  ["estado = 'pendiente_aprobacion'", [{ total: 5 }]],
  ['LIMIT 10', [{ id: 'a1', nombre_visitante: 'Luis', numero_casa: 'A-12', timestamp_entrada: '2026-09-24T10:00:00', timestamp_salida: null }]],
  ['COUNT(*)::int AS total', [{ total: 10 }]],
];

beforeEach(() => {
  mockPool.query.mockReset();
  mockPool.query.mockImplementation(async (sql: string) => ({
    rows: RESPUESTAS.find(([frag]) => sql.includes(frag))?.[1] ?? [],
  }));
});

const pedir = async (user: object) => {
  const res = makeRes();
  await getDashboard({ user } as unknown as Request, res);
  return (res.json as jest.Mock).mock.calls[0]?.[0];
};

it('devuelve la serie de hoy por hora (24 posiciones) y la referencia de ayer', async () => {
  const body = await pedir(ADM_SUC);
  expect(body.accesos_hoy).toBe(10);
  expect(body.accesos_por_hora).toHaveLength(24);
  expect(body.accesos_por_hora[8]).toBe(3);
  expect(body.accesos_por_hora[18]).toBe(7);
  expect(body.accesos_por_hora.reduce((a: number, b: number) => a + b, 0)).toBe(10);
  expect(body.accesos_ayer_misma_hora).toBe(9);
  expect(body.dentro_ahora).toBe(2);
});

it('trae el total de residentes del alcance para decidir si el panel muestra los primeros pasos', async () => {
  const body = await pedir(ADM_SUC);
  expect(body.residentes_mora).toBe(4);
  expect(body.total_residentes).toBe(120);
  const sql = mockPool.query.mock.calls.map(([s]) => s as string).find(s => s.includes('estado_pago'))!;
  expect(sql).toMatch(/COUNT\(\*\) FILTER \(WHERE r\.estado_pago = 'mora'\)/);
  expect(sql).toContain('r.sucursal_id  = $1');
});

it('"dentro ahora" se cuenta en la base (últimas 24 h), no con la lista de recientes', async () => {
  await pedir(ADM_SUC);
  const sql = mockPool.query.mock.calls.map(([s]) => s as string).find(s => s.includes('timestamp_salida IS NULL'))!;
  expect(sql).toContain("INTERVAL '24 hours'");
  expect(sql).not.toContain('LIMIT');
});

it('la referencia de ayer se corta a la hora actual, no al día completo', async () => {
  await pedir(ADM_SUC);
  const sql = mockPool.query.mock.calls.map(([s]) => s as string).find(s => s.includes('CURRENT_DATE - 1'))!;
  expect(sql).toContain('<= LOCALTIME');
});

it.each([
  ['admin de sucursal', ADM_SUC, /ra\.sucursal_id = \$1|r\.sucursal_id  = \$1|p\.sucursal_id  = \$1|a\.sucursal_id  = \$1/, 'suc-1'],
  ['admin de empresa', ADM_EMP, /_s\.empresa_id = \$1/, 'emp-1'],
])('%s: las ocho consultas filtran por su alcance', async (_n, user, filtro, param) => {
  await pedir(user);
  expect(mockPool.query).toHaveBeenCalledTimes(8);
  for (const [sql, params] of mockPool.query.mock.calls) {
    expect(sql).toMatch(filtro);
    expect(params).toEqual([param]);
  }
});

it('reservas por aprobar: cuenta las pendientes de aprobación dentro del alcance del rol', async () => {
  const body = await pedir(ADM_SUC);
  expect(body.reservas_pendientes).toBe(5);
  const sql = mockPool.query.mock.calls.map(([s]) => s as string).find(s => s.includes("'pendiente_aprobacion'"))!;
  expect(sql).toContain('areas_comunes');
  expect(sql).toMatch(/a\.sucursal_id\s+= \$1/);
  mockPool.query.mockClear();
  await pedir(ADM_EMP);
  const sqlEmp = mockPool.query.mock.calls.map(([s]) => s as string).find(s => s.includes("'pendiente_aprobacion'"))!;
  expect(sqlEmp).toMatch(/_s\.empresa_id = \$1/);
});

it('owner: sin parámetros de tenant', async () => {
  await pedir(OWNER);
  for (const [sql, params] of mockPool.query.mock.calls) {
    expect(sql).not.toContain('$1');
    expect(params).toEqual([]);
  }
});
