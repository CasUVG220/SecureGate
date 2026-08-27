/**
 * ── Por qué se prioriza esta lógica para testing ─────────────────────────────
 * registrarAcceso() es el punto donde una invitación QR se vuelve autoritativa
 * (verificarInvitacion es sólo advisory). Tres cosas son fáciles de romper en
 * silencio aquí: (1) el bloqueo por intentos fallidos debe sobrevivir al
 * ROLLBACK de la transacción — si se escribiera con `client.query` en vez de
 * `pool.query`, el contador se perdería junto con el resto del rollback y el
 * bloqueo nunca se activaría; (2) la regla de placa obligatoria debe leer la
 * config de la sucursal correcta; (3) un acceso exitoso debe resetear el
 * contador de intentos fallidos, o un residente legítimo quedaría bloqueado
 * por errores viejos ya corregidos.
 */
jest.mock('../db/pool', () => ({
  __esModule: true,
  default: { query: jest.fn(), connect: jest.fn() },
}));

import pool from '../db/pool';
import { registrarAcceso } from '../controllers/accesos.controller';
import type { Request, Response } from 'express';

const mockPool = pool as unknown as { connect: jest.Mock; query: jest.Mock };

function makeRes() {
  const res: Partial<Response> = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res as Response;
}

const INV_BASE = {
  id: 'inv-1',
  sucursal_id: 'suc-1',
  tipo: 'individual',
  numero_dpi: '1111111111111',
  placa: null as string | null,
  activo: true,
  usos_maximos: 1,
  usos_actuales: 0,
  intentos_fallidos_dpi: 0,
  bloqueado_hasta: null as string | null,
  ya_vigente: true,
  no_vencida: true,
};

const CONFIG_QR_BASE = {
  sucursal_id: 'suc-1',
  dpi_obligatorio_individual: true,
  requiere_placa: false,
  autorizacion_automatica: false,
  max_intentos_fallidos: 3,
  bloqueo_minutos: 15,
};

interface Overrides {
  inv?: Partial<typeof INV_BASE> | null;
  configQr?: Partial<typeof CONFIG_QR_BASE>;
}

function makeClient(over: Overrides = {}) {
  const query = jest.fn((sql: string) => {
    if (sql.includes('FROM residentes WHERE id')) {
      return Promise.resolve({ rows: [{ id: 'res-1', estado_pago: 'al_dia', sucursal_id: 'suc-1' }] });
    }
    if (sql.includes('FROM usuarios') && sql.includes("rol IN")) {
      return Promise.resolve({ rows: [{ id: 'agente-1' }] });
    }
    if (sql.includes('FROM visitantes WHERE numero_dpi')) {
      return Promise.resolve({ rows: [] });
    }
    if (sql.includes('INSERT INTO visitantes')) {
      return Promise.resolve({ rows: [{ id: 'vis-1', nombre: 'Juan', numero_dpi: '1111111111111' }] });
    }
    if (sql.includes('FROM invitaciones_qr WHERE id') && sql.includes('FOR UPDATE')) {
      return Promise.resolve({ rows: over.inv === null ? [] : [{ ...INV_BASE, ...over.inv }] });
    }
    if (sql.includes('FROM configuracion_qr')) {
      return Promise.resolve({ rows: [{ ...CONFIG_QR_BASE, ...over.configQr }] });
    }
    if (sql.includes('UPDATE invitaciones_qr') && sql.includes('usos_actuales = usos_actuales + 1')) {
      return Promise.resolve({ rows: [], rowCount: 1 });
    }
    if (sql.includes('INSERT INTO registros_acceso')) {
      return Promise.resolve({ rows: [{ id: 'reg-1' }], rowCount: 1 });
    }
    return Promise.resolve({ rows: [], rowCount: 0 });
  });
  return { query, release: jest.fn() };
}

/** pool.query fuera de la transacción: preaut/blacklist checks + el UPDATE de intentos fallidos. */
function stubPool() {
  mockPool.query.mockImplementation((sql: string) => {
    if (sql.includes('FROM preautorizaciones')) return Promise.resolve({ rows: [] });
    if (sql.includes('FROM visitante_blacklist')) return Promise.resolve({ rows: [] });
    if (sql.includes('FROM residente_visitante_blacklist')) return Promise.resolve({ rows: [] });
    if (sql.includes('UPDATE invitaciones_qr') && sql.includes('intentos_fallidos_dpi = $2')) {
      return Promise.resolve({ rows: [], rowCount: 1 });
    }
    return Promise.resolve({ rows: [], rowCount: 0 });
  });
}

const makeReq = (body: Record<string, unknown> = {}) =>
  ({
    body: {
      nombre_visitante: 'Juan',
      numero_dpi: '1111111111111',
      residente_id: 'res-1',
      agente_id: 'agente-1',
      invitacion_qr_id: 'inv-1',
      ...body,
    },
    user: { id: 'agente-1', rol: 'agente', sucursal_id: 'suc-1', empresa_id: null },
  }) as unknown as Request;

beforeEach(() => {
  mockPool.query.mockReset();
  mockPool.connect.mockReset();
});

describe('registrarAcceso — bloqueo por intentos fallidos de DPI en QR individual', () => {
  it('incrementa el contador y bloquea al llegar al máximo, pero el contador sobrevive al ROLLBACK', async () => {
    stubPool();
    const client = makeClient({ inv: { intentos_fallidos_dpi: 2 } }); // al fallar llega a 3 = max
    mockPool.connect.mockResolvedValue(client);

    const res = makeRes();
    await registrarAcceso(makeReq({ numero_dpi: '9999999999999' }), res); // DPI equivocado

    expect(res.status).toHaveBeenCalledWith(409);
    expect((res.json as jest.Mock).mock.calls[0][0].error).toMatch(/DPI no coincide/);

    // El incremento se hizo con pool.query (fuera de la transacción), no con client.query,
    // así que sobrevive aunque la transacción completa se revierta.
    const poolCall = mockPool.query.mock.calls.find(
      c => (c[0] as string).includes('intentos_fallidos_dpi = $2')
    );
    expect(poolCall).toBeDefined();
    expect(poolCall![1]).toEqual(['inv-1', 3, true, 15]); // intentos=3 >= max(3) → bloquear=true

    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
    expect(client.query).not.toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO registros_acceso'),
      expect.anything()
    );
  });

  it('rechaza de inmediato si la invitación ya está bloqueada, sin volver a evaluar el DPI', async () => {
    stubPool();
    const futuro = new Date(Date.now() + 5 * 60_000).toISOString();
    const client = makeClient({ inv: { bloqueado_hasta: futuro } });
    mockPool.connect.mockResolvedValue(client);

    const res = makeRes();
    // DPI correcto, pero igual debe rechazar por el bloqueo vigente
    await registrarAcceso(makeReq(), res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect((res.json as jest.Mock).mock.calls[0][0].error).toMatch(/bloqueada temporalmente/);
  });

  it('un acceso exitoso resetea intentos_fallidos_dpi a 0 junto con el incremento de usos', async () => {
    stubPool();
    const client = makeClient({ inv: { intentos_fallidos_dpi: 2 } });
    mockPool.connect.mockResolvedValue(client);

    const res = makeRes();
    await registrarAcceso(makeReq(), res); // DPI correcto

    expect(res.status).not.toHaveBeenCalledWith(409);
    const updateCall = client.query.mock.calls.find(
      c => (c[0] as string).includes('usos_actuales = usos_actuales + 1')
    );
    expect(updateCall![0]).toContain('intentos_fallidos_dpi = 0');
  });
});

describe('registrarAcceso — placa obligatoria (config de sucursal)', () => {
  it('rechaza si la sucursal exige placa y no viene ninguna', async () => {
    stubPool();
    const client = makeClient({ configQr: { requiere_placa: true } });
    mockPool.connect.mockResolvedValue(client);

    const res = makeRes();
    await registrarAcceso(makeReq({ placa: undefined }), res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect((res.json as jest.Mock).mock.calls[0][0].error).toMatch(/requiere registrar la placa/);
  });

  it('rechaza si la placa enviada no coincide con la registrada en la invitación', async () => {
    stubPool();
    const client = makeClient({ configQr: { requiere_placa: true }, inv: { placa: 'P123ABC' } });
    mockPool.connect.mockResolvedValue(client);

    const res = makeRes();
    await registrarAcceso(makeReq({ placa: 'P999ZZZ' }), res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect((res.json as jest.Mock).mock.calls[0][0].error).toMatch(/placa no coincide/);
  });

  it('acepta cualquier placa si la invitación no registró una específica', async () => {
    stubPool();
    const client = makeClient({ configQr: { requiere_placa: true }, inv: { placa: null } });
    mockPool.connect.mockResolvedValue(client);

    const res = makeRes();
    await registrarAcceso(makeReq({ placa: 'P999ZZZ' }), res);

    expect(res.status).not.toHaveBeenCalledWith(409);
  });
});
