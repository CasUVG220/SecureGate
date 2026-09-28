/**
 * GET /api/reportes/estadisticas — agregados de la pantalla de Análisis.
 *
 * Se verifica lo que la pantalla da por hecho: que el periodo anterior tiene la
 * misma longitud, que las series llegan sin huecos, que los cargos de reserva
 * no inflan lo recaudado y que TODAS las consultas llevan el filtro de alcance
 * (las estadísticas de una sucursal no pueden mezclar datos de otra).
 */
jest.mock('../db/pool', () => ({
  __esModule: true,
  default: { query: jest.fn(), connect: jest.fn() },
}));

import pool from '../db/pool';
import { getEstadisticas, MAX_DIAS } from '../controllers/estadisticas.controller';
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

const req = (user: object, query: Record<string, string>) =>
  ({ user, query, params: {}, body: {} }) as unknown as Request;

/** Filas simuladas por consulta, identificadas por un fragmento único de su SQL. */
const RESPUESTAS: Array<[string, Array<Record<string, unknown>>]> = [
  ['duracion_mediana_min', [{
    total: 42, total_anterior: 30, visitantes_unicos: 35, con_vehiculo: 12,
    sin_salida: 3, no_autorizados: 1, duracion_mediana_min: 37.6,
  }]],
  ['TO_CHAR(DATE(ra.timestamp_entrada)', [
    { periodo: 'anterior', fecha: '2026-08-25', total: 6 },  // día 1 de 7
    { periodo: 'actual',   fecha: '2026-09-01', total: 5 },
    { periodo: 'actual',   fecha: '2026-09-03', total: 2 },
  ]],
  ['ISODOW', [
    { dia: 1, hora: 8, total: 4 },   // lunes 08:00
    { dia: 7, hora: 19, total: 9 },  // domingo 19:00
  ]],
  ['res.numero_casa', [{ numero_casa: 'A-12', total: 7 }, { numero_casa: 'B-03', total: 4 }]],
  ['p.estado, p.metodo', [
    { periodo: 'actual',   estado: 'aprobado',  metodo: 'efectivo',      cantidad: 2, monto: '150.10' },
    { periodo: 'actual',   estado: 'aprobado',  metodo: 'transferencia', cantidad: 3, monto: '600.205' },
    { periodo: 'actual',   estado: 'pendiente', metodo: 'transferencia', cantidad: 1, monto: '200.00' },
    { periodo: 'actual',   estado: 'rechazado', metodo: 'transferencia', cantidad: 1, monto: '80.00' },
    { periodo: 'anterior', estado: 'aprobado',  metodo: 'efectivo',      cantidad: 4, monto: '500.00' },
    { periodo: 'anterior', estado: 'pendiente', metodo: 'efectivo',      cantidad: 9, monto: '999.00' },
  ]],
  ['TO_CHAR(DATE(p.fecha_pago)', [
    { periodo: 'anterior', fecha: '2026-08-31', monto: '120.5' },  // día 7 de 7
    { periodo: 'actual',   fecha: '2026-09-02', monto: '750.305' },
  ]],
  ['FROM residentes r', [{ residentes: 20, al_dia: 14, pendiente: 2, mora: 4, saldo_pendiente: '1234.5' }]],
  ['FROM tickets t', [
    { estado: 'abierto', tipo: 'mantenimiento', total: 2 },
    { estado: 'cerrado', tipo: 'mantenimiento', total: 1 },
    { estado: 'en_proceso', tipo: 'queja', total: 1 },
  ]],
  ['FROM reservas_areas rs', [
    { area: 'Piscina', estado: 'confirmada', total: 3, monto: '0' },
    { area: 'Salón',   estado: 'completada', total: 2, monto: '300.00' },
    { area: 'Salón',   estado: 'cancelada',  total: 5, monto: '750.00' },
  ]],
];

const simularBase = () => {
  mockPool.query.mockImplementation(async (sql: string) => {
    const hit = RESPUESTAS.find(([frag]) => sql.includes(frag));
    return { rows: hit ? hit[1] : [] };
  });
};

const cuerpo = (res: Response) => (res.json as jest.Mock).mock.calls[0][0];

beforeEach(() => {
  mockPool.query.mockReset();
  simularBase();
});

describe('validación del periodo', () => {
  it.each([
    ['sin parámetros', {}],
    ['formato inválido', { desde: '01/09/2026', hasta: '2026-09-30' }],
    ['fecha inexistente', { desde: '2026-02-30', hasta: '2026-03-10' }],
    ['intento de inyección', { desde: "2026-01-01'; --", hasta: '2026-09-30' }],
    ['desde posterior a hasta', { desde: '2026-09-30', hasta: '2026-09-01' }],
    ['rango mayor al máximo', { desde: '2025-01-01', hasta: '2026-09-30' }],
  ])('%s → 400 sin consultar la base', async (_n, query) => {
    const res = makeRes();
    await getEstadisticas(req(ADM_SUC, query as Record<string, string>), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockPool.query).not.toHaveBeenCalled();
  });

  it(`acepta exactamente ${MAX_DIAS} días`, async () => {
    const res = makeRes();
    await getEstadisticas(req(ADM_SUC, { desde: '2025-01-01', hasta: '2026-01-01' }), res);
    expect(res.status).not.toHaveBeenCalled();
    expect(cuerpo(res).periodo.dias).toBe(MAX_DIAS);
  });
});

describe('periodo de comparación', () => {
  it('el periodo anterior tiene la misma longitud y termina el día antes de "desde"', async () => {
    const res = makeRes();
    await getEstadisticas(req(ADM_SUC, { desde: '2026-09-01', hasta: '2026-09-30' }), res);
    expect(cuerpo(res).periodo).toEqual({
      desde: '2026-09-01', hasta: '2026-09-30', dias: 30,
      anterior: { desde: '2026-08-02', hasta: '2026-08-31' },
    });
  });

  it('un solo día se compara con el día anterior', async () => {
    const res = makeRes();
    await getEstadisticas(req(ADM_SUC, { desde: '2026-03-01', hasta: '2026-03-01' }), res);
    expect(cuerpo(res).periodo.anterior).toEqual({ desde: '2026-02-28', hasta: '2026-02-28' });
  });
});

describe('alcance multi-tenant', () => {
  it('admin de sucursal: todas las consultas filtran por SU sucursal', async () => {
    await getEstadisticas(req(ADM_SUC, { desde: '2026-09-01', hasta: '2026-09-30' }), makeRes());
    expect(mockPool.query).toHaveBeenCalledTimes(RESPUESTAS.length);
    for (const [sql, params] of mockPool.query.mock.calls) {
      expect(sql).toMatch(/\b(ra|p|r|t|a)\.sucursal_id = \$1/);
      expect(params[0]).toBe('suc-1');
    }
  });

  it('admin de empresa: todas las consultas filtran por SU empresa', async () => {
    await getEstadisticas(req(ADM_EMP, { desde: '2026-09-01', hasta: '2026-09-30' }), makeRes());
    for (const [sql, params] of mockPool.query.mock.calls) {
      expect(sql).toContain('_ts.empresa_id = $1');
      expect(params[0]).toBe('emp-1');
    }
  });

  it('cada consulta recibe exactamente los parámetros que usa (Postgres rechaza los sobrantes)', async () => {
    for (const user of [OWNER, ADM_EMP, ADM_SUC]) {
      mockPool.query.mockClear();
      await getEstadisticas(req(user, { desde: '2026-09-01', hasta: '2026-09-30' }), makeRes());
      for (const [sql, params] of mockPool.query.mock.calls) {
        const usados = new Set([...(sql as string).matchAll(/\$(\d+)/g)].map(m => Number(m[1])));
        const max = usados.size ? Math.max(...usados) : 0;
        expect(params).toHaveLength(max);
        expect(usados.size).toBe(max);
      }
    }
  });

  it('owner: sin filtro de tenant, las fechas empiezan en $1', async () => {
    await getEstadisticas(req(OWNER, { desde: '2026-09-01', hasta: '2026-09-30' }), makeRes());
    const [sql, params] = mockPool.query.mock.calls.find(([s]) => s.includes('duracion_mediana_min'))!;
    expect(sql).toContain('$1::date');
    expect(params).toEqual(['2026-09-01', '2026-09-30', '2026-08-02']);
  });
});

describe('forma de la respuesta', () => {
  const pedir = async () => {
    const res = makeRes();
    await getEstadisticas(req(ADM_SUC, { desde: '2026-09-01', hasta: '2026-09-07' }), res);
    return cuerpo(res);
  };

  it('accesos: serie diaria sin huecos, matriz 7×24 y mediana redondeada', async () => {
    const { accesos } = await pedir();
    expect(accesos.por_dia).toHaveLength(7);
    expect(accesos.por_dia[0]).toEqual({ fecha: '2026-09-01', total: 5 });
    expect(accesos.por_dia[1]).toEqual({ fecha: '2026-09-02', total: 0 });
    expect(accesos.por_dia[2]).toEqual({ fecha: '2026-09-03', total: 2 });
    // La serie anterior queda alineada por posición y no se mezcla con la actual.
    expect(accesos.por_dia_anterior).toEqual([6, 0, 0, 0, 0, 0, 0]);
    expect(accesos.por_franja).toHaveLength(7);
    expect(accesos.por_franja.every((f: number[]) => f.length === 24)).toBe(true);
    expect(accesos.por_franja[0][8]).toBe(4);   // lunes
    expect(accesos.por_franja[6][19]).toBe(9);  // domingo
    expect(accesos.duracion_mediana_min).toBe(38);
    expect(accesos.total).toBe(42);
    expect(accesos.total_anterior).toBe(30);
    expect(accesos.top_casas[0]).toEqual({ numero_casa: 'A-12', total: 7 });
  });

  it('pagos: el periodo anterior sólo alimenta la comparación y los montos van a centavos', async () => {
    const { pagos } = await pedir();
    expect(pagos.recaudado).toBe(750.31);
    expect(pagos.recaudado_anterior).toBe(500);
    expect(pagos.por_estado).toEqual({
      aprobado:  { cantidad: 5, monto: 750.31 },
      pendiente: { cantidad: 1, monto: 200 },
      rechazado: { cantidad: 1, monto: 80 },
    });
    // Sólo lo aprobado cuenta por método, ordenado por monto.
    expect(pagos.por_metodo).toEqual([
      { metodo: 'transferencia', cantidad: 3, monto: 600.21 },
      { metodo: 'efectivo',      cantidad: 2, monto: 150.1 },
    ]);
    expect(pagos.por_dia).toHaveLength(7);
    expect(pagos.por_dia[1]).toEqual({ fecha: '2026-09-02', monto: 750.31 });
    expect(pagos.por_dia_anterior).toEqual([0, 0, 0, 0, 0, 0, 120.5]);
  });

  it('pagos: los cargos de reserva no cuentan como dinero recibido', async () => {
    await pedir();
    const sqlPagos = mockPool.query.mock.calls
      .map(([s]) => s as string)
      .filter(s => s.includes('FROM pagos p'));
    expect(sqlPagos).toHaveLength(2);
    for (const s of sqlPagos) expect(s).toContain("p.metodo <> 'reserva'");
  });

  it('cartera, solicitudes y reservas', async () => {
    const { cartera, solicitudes, reservas } = await pedir();
    expect(cartera).toEqual({ residentes: 20, al_dia: 14, pendiente: 2, mora: 4, saldo_pendiente: 1234.5 });
    expect(solicitudes.total).toBe(4);
    expect(solicitudes.por_estado).toEqual({ abierto: 2, en_proceso: 1, cerrado: 1 });
    expect(solicitudes.por_tipo[0]).toEqual({ tipo: 'mantenimiento', total: 3 });
    expect(reservas.total).toBe(10);
    expect(reservas.por_estado.cancelada).toBe(5);
    // Las canceladas no suman al ranking de áreas ni a los cargos.
    expect(reservas.top_areas).toEqual([{ area: 'Piscina', total: 3 }, { area: 'Salón', total: 2 }]);
    expect(reservas.cargos).toBe(300);
  });

  it('sin datos: todo en cero, sin nulos que rompan la pantalla (salvo la mediana)', async () => {
    mockPool.query.mockReset();
    mockPool.query.mockResolvedValue({ rows: [] });
    const body = await pedir();
    expect(body.accesos.total).toBe(0);
    expect(body.accesos.duracion_mediana_min).toBeNull();
    expect(body.accesos.por_dia.every((d: { total: number }) => d.total === 0)).toBe(true);
    expect(body.pagos.recaudado).toBe(0);
    expect(body.cartera.residentes).toBe(0);
    expect(body.reservas.top_areas).toEqual([]);
  });
});

it('un error de base responde 500 sin filtrar el detalle', async () => {
  mockPool.query.mockReset();
  mockPool.query.mockRejectedValue(Object.assign(new Error('relation "pagos" does not exist'), { code: '42P01' }));
  const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
  const res = makeRes();
  await getEstadisticas(req(ADM_SUC, { desde: '2026-09-01', hasta: '2026-09-30' }), res);
  expect(res.status).toHaveBeenCalledWith(500);
  expect(JSON.stringify((res.json as jest.Mock).mock.calls[0][0])).not.toContain('relation');
  spy.mockRestore();
});
