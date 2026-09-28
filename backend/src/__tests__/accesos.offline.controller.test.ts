/**
 * ── Por qué se prioriza esta lógica para testing ─────────────────────────────
 * Los registros que llegan desde la garita offline traen su propio reloj
 * (`registrado_en`). PRODUCT.md es explícito: ese reloj no es fuente de verdad
 * y el servidor sella `recibido_en` aparte — nunca se fusionan. Si alguien
 * "simplifica" y guarda uno solo, una garita con reloj adelantado puede crear
 * accesos en el futuro o una cola sincronizada 3 días después haría parecer
 * que la visita ocurrió hoy. La idempotencia por `id_cliente` es lo que evita
 * duplicados cuando la cola reintenta tras perder una respuesta.
 */
jest.mock('../db/pool', () => ({
  __esModule: true,
  default: { query: jest.fn(), connect: jest.fn() },
}));

import pool from '../db/pool';
import { registrarAcceso, resolverRegistradoEn } from '../controllers/accesos.controller';
import type { Request, Response } from 'express';

const mockPool = pool as unknown as { connect: jest.Mock; query: jest.Mock };

function makeRes() {
  const res: Partial<Response> = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res as Response;
}

/** Cliente transaccional mínimo para el camino feliz sin QR ni mora. */
function makeClient() {
  const query = jest.fn(async (sql: string) => {
    if (sql.startsWith('BEGIN') || sql.startsWith('COMMIT') || sql.startsWith('ROLLBACK')) return { rows: [] };
    if (sql.includes('FROM residentes WHERE id')) return { rows: [{ id: 'res-1', estado_pago: 'al_dia', sucursal_id: 'suc-1' }] };
    if (sql.includes('FROM usuarios')) return { rows: [{ id: 'ag-1' }] };
    if (sql.includes('SELECT id FROM visitantes')) return { rows: [{ id: 'vis-1' }] };
    if (sql.includes('SELECT * FROM visitantes')) return { rows: [{ id: 'vis-1', nombre: 'Juan' }] };
    if (sql.includes('INSERT INTO registros_acceso')) return { rows: [{ id: 'reg-1' }] };
    return { rows: [] };
  });
  return { query, release: jest.fn() };
}

const BODY = {
  nombre_visitante: 'Juan Pérez', numero_dpi: '1234567890101', residente_id: 'res-1', agente_id: 'ag-1',
};
const USER = { id: 'ag-1', rol: 'agente', sucursal_id: 'suc-1', empresa_id: 'emp-1' };
const ID_CLIENTE = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';

const insertCall = (client: { query: jest.Mock }) =>
  client.query.mock.calls.find(c => (c[0] as string).includes('INSERT INTO registros_acceso'))!;

describe('resolverRegistradoEn', () => {
  const ahora = new Date('2026-09-19T12:00:00Z');

  it('undefined cuando no viene (registro web): la BD usa NOW()', () => {
    expect(resolverRegistradoEn(undefined, ahora)).toBeUndefined();
    expect(resolverRegistradoEn('', ahora)).toBeUndefined();
  });

  it('null (→ 400) si no es fecha o es más antiguo que la ventana de 30 días', () => {
    expect(resolverRegistradoEn('ayer', ahora)).toBeNull();
    expect(resolverRegistradoEn('2026-08-01T00:00:00Z', ahora)).toBeNull();
  });

  it('conserva el valor tal cual dentro de la ventana, aunque esté en el futuro (se acota en SQL, no aquí)', () => {
    expect(resolverRegistradoEn('2026-09-17T08:30:00Z', ahora)).toEqual(new Date('2026-09-17T08:30:00Z'));
    expect(resolverRegistradoEn('2026-09-19T13:00:00Z', ahora)).toEqual(new Date('2026-09-19T13:00:00Z'));
  });
});

describe('registrarAcceso — registrado_en vs recibido_en', () => {
  beforeEach(() => {
    mockPool.query.mockResolvedValue({ rows: [] }); // checkPreautorizacion + otros
  });

  it('registro web (sin licencia): registrado_en NULL, origen=web, recibido_en=NOW() en el propio INSERT', async () => {
    const client = makeClient();
    mockPool.connect.mockResolvedValue(client);
    const res = makeRes();
    await registrarAcceso({ body: BODY, user: USER } as unknown as Request, res);

    const [sql, params] = insertCall(client);
    expect(sql).toContain('recibido_en');
    expect(sql).toMatch(/NOW\(\)/);
    expect(params[7]).toBeNull();           // registrado_en
    expect(params[8]).toBe(false);          // capturado_manualmente
    expect(params[9]).toBe('web');          // origen
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('registro desktop: guarda registrado_en del cliente en su propia columna y sella recibido_en con NOW()', async () => {
    const client = makeClient();
    mockPool.connect.mockResolvedValue(client);
    const res = makeRes();
    const registradoEn = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(); // hace 3h, offline
    await registrarAcceso({
      body: { ...BODY, registrado_en: registradoEn, capturado_manualmente: true, id_cliente: ID_CLIENTE },
      user: USER,
      licencia: { id: 'lic-1', sucursal_id: 'suc-1', empresa_id: 'emp-1' },
    } as unknown as Request, res);

    const [sql, params] = insertCall(client);
    // registrado_en viaja como parámetro (reloj del cliente), recibido_en es NOW() literal del servidor:
    // dos columnas, dos fuentes, nunca el mismo valor.
    expect(params[7]).toEqual(new Date(registradoEn));
    expect(sql).toContain('registrado_en, recibido_en');
    expect(sql).toMatch(/\$8::timestamptz, NOW\(\)/);
    // timestamp_entrada nunca en el futuro respecto al servidor
    expect(sql).toContain('LEAST(COALESCE($8::timestamptz, NOW()), NOW())');
    expect(params[8]).toBe(true);           // capturado_manualmente
    expect(params[9]).toBe('desktop');      // origen viene de la licencia, no del body
    expect(params[10]).toBe(ID_CLIENTE);
    expect(params[11]).toBe('lic-1');
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('rechaza (400) un registrado_en inválido antes de abrir transacción', async () => {
    const res = makeRes();
    await registrarAcceso({ body: { ...BODY, registrado_en: 'no-es-fecha' }, user: USER } as unknown as Request, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockPool.connect).not.toHaveBeenCalled();
  });

  it('idempotencia: un id_cliente ya recibido devuelve 200 con el registro previo, sin insertar', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [{ id: 'reg-previo', id_cliente: ID_CLIENTE }] });
    const res = makeRes();
    await registrarAcceso({ body: { ...BODY, id_cliente: ID_CLIENTE }, user: USER } as unknown as Request, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ registro: { id: 'reg-previo', id_cliente: ID_CLIENTE }, duplicado: true });
    expect(mockPool.connect).not.toHaveBeenCalled();
  });

  it('rechaza (400) un id_cliente que no es UUID', async () => {
    const res = makeRes();
    await registrarAcceso({ body: { ...BODY, id_cliente: '123' }, user: USER } as unknown as Request, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('carrera de reintentos: unique_violation sobre id_cliente se responde como duplicado (200), no 500', async () => {
    const client = makeClient();
    client.query.mockImplementation(async (sql: string) => {
      if (sql.includes('INSERT INTO registros_acceso')) {
        throw Object.assign(new Error('duplicate key'), { code: '23505' });
      }
      if (sql.includes('FROM residentes WHERE id')) return { rows: [{ id: 'res-1', estado_pago: 'al_dia', sucursal_id: 'suc-1' }] };
      if (sql.includes('FROM usuarios')) return { rows: [{ id: 'ag-1' }] };
      if (sql.includes('SELECT id FROM visitantes')) return { rows: [{ id: 'vis-1' }] };
      if (sql.includes('SELECT * FROM visitantes')) return { rows: [{ id: 'vis-1' }] };
      return { rows: [] };
    });
    mockPool.connect.mockResolvedValue(client);
    mockPool.query
      .mockResolvedValueOnce({ rows: [] })                                   // idempotencia: aún no existe
      .mockResolvedValueOnce({ rows: [] })                                   // checkPreautorizacion
      .mockResolvedValueOnce({ rows: [] })                                   // checkBlacklist sucursal
      .mockResolvedValueOnce({ rows: [] })                                   // checkBlacklist residente
      .mockResolvedValueOnce({ rows: [{ id: 'reg-ganador', id_cliente: ID_CLIENTE }] }); // relectura tras 23505
    const res = makeRes();
    await registrarAcceso({ body: { ...BODY, id_cliente: ID_CLIENTE }, user: USER } as unknown as Request, res);

    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ registro: { id: 'reg-ganador', id_cliente: ID_CLIENTE }, duplicado: true });
  });
});
