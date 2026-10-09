/**
 * ── Por qué existe este test ─────────────────────────────────────────────────
 * Aislamiento entre empresas (multi-tenant). La revisión de seguridad encontró
 * varios UPDATE/DELETE sin filtro de tenant y un `resolveSucursalId` que caía a
 * "la primera sucursal de la base de datos". Cada caso de aquí es un ataque
 * concreto que antes funcionaba:
 *
 *   - un admin de sucursal desactivando al owner de otra empresa,
 *   - un admin de empresa ascendiendo/degradando usuarios ajenos,
 *   - un agente registrando visitas contra residentes de otra empresa,
 *   - un id de otra empresa distinguible (403) de uno inexistente (404).
 *
 * Con `pool` mockeado se verifica que las consultas llevan el filtro de alcance
 * con los parámetros correctos, no sólo que "responden".
 */
jest.mock('../db/pool', () => ({
  __esModule: true,
  default: { query: jest.fn(), connect: jest.fn() },
}));

import pool from '../db/pool';
import { resolverSucursal, ownershipParams } from '../utils/tenant';
import { deleteUsuario, createUsuario } from '../controllers/usuarios.controller';
import { assignAdminSucursal, updateSucursal } from '../controllers/sucursales.controller';
import { getEmpresaStats, assignAdminEmpresa } from '../controllers/empresas.controller';
import { registrarAcceso, registrarSalida } from '../controllers/accesos.controller';
import { checkPreautorizacion, createPreautorizacion } from '../controllers/preautorizaciones.controller';
import { getSnapshotGarita } from '../controllers/sync.controller';
import { updateCargo } from '../controllers/cargos_programados.controller';
import { createConfiguracion } from '../controllers/cargos.controller';
import { aprobarPago, createPago } from '../controllers/pagos.controller';
import { reporteAccesos } from '../controllers/reportes.controller';
import { tokenRevocado, _reiniciarRevocaciones } from '../utils/revocacion';
import type { Request, Response } from 'express';

const mockPool = pool as unknown as { query: jest.Mock; connect: jest.Mock };

const UUID_A = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';
const UUID_B = '9b2f6c1a-7d3e-4b5a-8c1d-2e4f6a8b0c1d';

const makeRes = () => {
  const res: Partial<Response> = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  res.send = jest.fn().mockReturnValue(res);
  res.setHeader = jest.fn().mockReturnValue(res);
  return res as Response;
};

const OWNER    = { id: 'u-owner', rol: 'owner',          sucursal_id: null,    empresa_id: null };
const ADM_EMP  = { id: 'u-ae',    rol: 'admin_empresa',  sucursal_id: null,    empresa_id: 'emp-1' };
const ADM_SUC  = { id: 'u-as',    rol: 'admin_sucursal', sucursal_id: 'suc-1', empresa_id: 'emp-1' };
const AGENTE   = { id: 'u-ag',    rol: 'agente',         sucursal_id: 'suc-1', empresa_id: 'emp-1' };

const req = (over: Record<string, unknown>) => ({ params: {}, body: {}, query: {}, ...over }) as unknown as Request;
const sqlDe = (i = 0) => mockPool.query.mock.calls[i][0] as string;

beforeEach(() => {
  mockPool.query.mockReset();
  mockPool.connect.mockReset();
  _reiniciarRevocaciones();
});

// ─────────────────────────────────────────────────────────────────────────────
describe('resolverSucursal (antes caía a "la primera sucursal de la base")', () => {
  it('quien tiene sucursal en el JWT escribe SIEMPRE en la suya, ignorando el body', async () => {
    const r = await resolverSucursal(ADM_SUC as any, UUID_B, mockPool);
    expect(r).toEqual({ ok: true, id: 'suc-1' });
    expect(mockPool.query).not.toHaveBeenCalled();
  });

  it('owner/admin_empresa SIN sucursal_id → 400 (ya no hay fallback a una sucursal cualquiera)', async () => {
    for (const u of [OWNER, ADM_EMP]) {
      const r = await resolverSucursal(u as any, undefined, mockPool);
      expect(r).toMatchObject({ ok: false, status: 400 });
    }
    expect(mockPool.query).not.toHaveBeenCalled();
  });

  it('sucursal_id que no es UUID → 400 sin tocar la base', async () => {
    expect(await resolverSucursal(OWNER as any, "x'; DROP TABLE usuarios;--", mockPool)).toMatchObject({ ok: false, status: 400 });
    expect(mockPool.query).not.toHaveBeenCalled();
  });

  it('admin_empresa con una sucursal de OTRA empresa → 403 (la consulta lleva su empresa_id)', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });
    const r = await resolverSucursal(ADM_EMP as any, UUID_A, mockPool);
    expect(r).toMatchObject({ ok: false, status: 403 });
    expect(mockPool.query.mock.calls[0][1]).toEqual([UUID_A, 'admin_empresa', 'emp-1']);
    expect(sqlDe()).toContain('s.activo = TRUE');
  });

  it('admin_empresa con una sucursal propia → ok', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [{ id: UUID_A }] });
    expect(await resolverSucursal(ADM_EMP as any, UUID_A, mockPool)).toEqual({ ok: true, id: UUID_A });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('deleteUsuario (antes: UPDATE … WHERE id = $1, sin filtro)', () => {
  it('lleva el rol y el alcance del que llama y NO permite darse de baja a sí mismo ni al owner', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });
    const res = makeRes();
    await deleteUsuario(req({ user: ADM_SUC, params: { id: 'u-owner' } }), res);

    expect(res.status).toHaveBeenCalledWith(404);          // 404, no 403: no revela que existe
    expect(mockPool.query).toHaveBeenCalledTimes(1);       // y no llegó a revocar sesiones
    expect(mockPool.query.mock.calls[0][1]).toEqual(['u-owner', 'u-as', 'admin_sucursal', 'emp-1', 'suc-1']);
    const sql = sqlDe();
    expect(sql).toContain('u.id <> $2');
    expect(sql).toContain("u.rol <> 'owner'");
    // admin_sucursal sólo alcanza roles inferiores/iguales dentro de SU sucursal
    expect(sql).toMatch(/\$3::text = 'admin_sucursal'[\s\S]*u\.sucursal_id = \$5/);
    // y su rama jamás nombra a admin_empresa ni a owner como objetivo
    const ramaAdminSucursal = sql.slice(sql.indexOf("$3::text = 'admin_sucursal'"));
    expect(ramaAdminSucursal).not.toContain('admin_empresa');
  });

  it('baja correcta: cierra las sesiones (refresh tokens) y corta el access token vigente', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ id: UUID_A, nombre: 'Guardia', email: 'g@sg.com', rol: 'agente', activo: false }] })
      .mockResolvedValueOnce({ rows: [] });
    const res = makeRes();
    await deleteUsuario(req({ user: ADM_SUC, params: { id: UUID_A } }), res);

    expect(sqlDe(1)).toContain('UPDATE refresh_tokens SET revoked = TRUE');
    expect(mockPool.query.mock.calls[1][1]).toEqual([UUID_A]);
    // un token emitido antes de la baja queda revocado inmediatamente
    expect(tokenRevocado({ id: UUID_A, iat: Math.floor(Date.now() / 1000) - 60 })).toBe(true);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ id: UUID_A, activo: false }));
  });
});

describe('createUsuario', () => {
  const body = { nombre: 'Ana', email: 'Ana@SG.com', password: 'clave-segura-1', rol: 'agente' };

  it('contraseña débil → 400 antes de tocar la base', async () => {
    const res = makeRes();
    await createUsuario(req({ user: ADM_SUC, body: { ...body, password: '123456' } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockPool.query).not.toHaveBeenCalled();
  });

  it('admin_empresa que manda una sucursal de otra empresa → 403 (antes se aceptaba tal cual)', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] }); // resolverSucursal: no es de su empresa
    const res = makeRes();
    await createUsuario(req({ user: ADM_EMP, body: { ...body, sucursal_id: UUID_A } }), res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(mockPool.connect).not.toHaveBeenCalled();
  });

  it('admin_empresa sin sucursal_id → 400 (no hay fallback)', async () => {
    const res = makeRes();
    await createUsuario(req({ user: ADM_EMP, body }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('sucursales', () => {
  it('assignAdminSucursal: usuario de otra empresa/rol no permitido → 404 y NO se tocan sesiones', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ id: UUID_A, empresa_id: 'emp-1' }] }) // la sucursal sí es suya
      .mockResolvedValueOnce({ rows: [] });                                    // pero el usuario no cumple
    const res = makeRes();
    await assignAdminSucursal(req({ user: ADM_EMP, params: { id: UUID_A }, body: { usuario_id: UUID_B } }), res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(mockPool.query).toHaveBeenCalledTimes(2);
    const sql = sqlDe(1);
    expect(sql).toContain("u.rol IN ('agente', 'admin_sucursal')"); // jamás owner, admin_empresa ni residente
    expect(sql).toContain('u.activo = TRUE');
    expect(mockPool.query.mock.calls[1][1]).toEqual([UUID_A, UUID_B, 'emp-1']);
  });

  it('assignAdminSucursal: sucursal de otra empresa → 404', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });
    const res = makeRes();
    await assignAdminSucursal(req({ user: ADM_EMP, params: { id: UUID_A }, body: { usuario_id: UUID_B } }), res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(mockPool.query.mock.calls[0][1]).toEqual([UUID_A, 'admin_empresa', 'emp-1']);
  });

  it('assignAdminSucursal: usuario_id que no es UUID → 400', async () => {
    const res = makeRes();
    await assignAdminSucursal(req({ user: ADM_EMP, params: { id: UUID_A }, body: { usuario_id: 'todos' } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockPool.query).not.toHaveBeenCalled();
  });

  it('updateSucursal filtra por la empresa del admin (el owner queda exento)', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });
    const res = makeRes();
    await updateSucursal(req({ user: ADM_EMP, params: { id: UUID_A }, body: { nombre: 'X' } }), res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(sqlDe()).toContain("$6::text = 'owner' OR empresa_id = $7");
    expect(mockPool.query.mock.calls[0][1].slice(-2)).toEqual(['admin_empresa', 'emp-1']);
  });
});

describe('empresas', () => {
  it('getEmpresaStats: un admin de empresa NO ve las métricas de otra empresa', async () => {
    const res = makeRes();
    await getEmpresaStats(req({ user: ADM_EMP, params: { id: UUID_A } }), res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(mockPool.query).not.toHaveBeenCalled();
  });

  it('assignAdminEmpresa: no admite como candidato a un owner ni a un residente, y no degrada a nadie antes de comprobarlo', async () => {
    const client = {
      query: jest.fn((sql: string, _params?: unknown[]) => {
        if (sql.startsWith('SELECT id FROM empresas')) return Promise.resolve({ rows: [{ id: UUID_A }] });
        if (sql.includes("rol IN ('admin_empresa', 'admin_sucursal', 'agente')")) return Promise.resolve({ rows: [] });
        return Promise.resolve({ rows: [] });
      }),
      release: jest.fn(),
    };
    mockPool.connect.mockResolvedValue(client);
    const res = makeRes();
    await assignAdminEmpresa(req({ user: OWNER, params: { id: UUID_A }, body: { usuario_id: UUID_B } }), res);

    expect(res.status).toHaveBeenCalledWith(404);
    const sqls = client.query.mock.calls.map(c => c[0] as string);
    expect(sqls.some(s => s.includes("SET rol = 'agente'"))).toBe(false); // no degradó al admin actual
    expect(sqls).toContain('ROLLBACK');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('registrarAcceso — alcance del residente y del agente', () => {
  const BODY = { nombre_visitante: 'Juan', numero_dpi: '1234567890101', residente_id: UUID_B, agente_id: 'u-otro' };

  const clientQueVeResidente = (visible: boolean) => {
    const query = jest.fn(async (sql: string, _params?: unknown[]) => {
      if (sql.includes('FROM residentes WHERE id')) {
        return { rows: visible ? [{ id: UUID_B, estado_pago: 'al_dia', sucursal_id: 'suc-1', saldo_pendiente: '0' }] : [] };
      }
      if (sql.includes('FROM usuarios')) return { rows: [{ id: 'u-ag' }] };
      if (sql.includes('SELECT id FROM visitantes')) return { rows: [{ id: 'v-1' }] };
      if (sql.includes('SELECT * FROM visitantes')) return { rows: [{ id: 'v-1', nombre: 'Juan', numero_dpi: '1234567890101', foto: 'https://otro-tenant/foto.jpg' }] };
      if (sql.includes('INSERT INTO registros_acceso')) return { rows: [{ id: 'reg-1' }] };
      return { rows: [] };
    });
    return { query, release: jest.fn() };
  };

  beforeEach(() => { mockPool.query.mockResolvedValue({ rows: [] }); });

  it('un residente de OTRA empresa (fuera del alcance) → 404 y no se registra nada', async () => {
    const client = clientQueVeResidente(false);
    mockPool.connect.mockResolvedValue(client);
    const res = makeRes();
    await registrarAcceso(req({ user: AGENTE, body: BODY }), res);

    expect(res.status).toHaveBeenCalledWith(404);
    const sqls = client.query.mock.calls.map(c => c[0] as string);
    expect(sqls.some(s => s.includes('INSERT INTO registros_acceso'))).toBe(false);
    expect(sqls.some(s => s.includes('UPDATE residentes'))).toBe(false); // ni cargo por mora sobre el vecino ajeno
    const consulta = client.query.mock.calls.find(c => String(c[0]).includes('FROM residentes WHERE id'))!;
    expect(consulta[1]).toEqual([UUID_B, 'agente', 'emp-1', 'suc-1']);
    expect(consulta[0]).toContain('sucursales _os');
  });

  it('el agente que queda registrado es el de la SESIÓN, no el que diga el body', async () => {
    const client = clientQueVeResidente(true);
    mockPool.connect.mockResolvedValue(client);
    const res = makeRes();
    await registrarAcceso(req({ user: AGENTE, body: BODY }), res);

    const insert = client.query.mock.calls.find(c => String(c[0]).includes('INSERT INTO registros_acceso'))!;
    expect(insert[1]).toContain('u-ag');
    expect(insert[1]).not.toContain('u-otro');
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('no devuelve la foto que subió otro tenant para el mismo DPI (visitantes es global)', async () => {
    mockPool.connect.mockResolvedValue(clientQueVeResidente(true));
    const res = makeRes();
    await registrarAcceso(req({ user: AGENTE, body: BODY }), res);
    const cuerpo = (res.json as jest.Mock).mock.calls[0][0];
    expect(cuerpo.visitante).toEqual({ id: 'v-1', nombre: 'Juan', numero_dpi: '1234567890101' });
    expect(cuerpo.visitante).not.toHaveProperty('foto');
  });

  it('sesión de una sucursal con la licencia de OTRA → 403 sin tocar la base', async () => {
    const res = makeRes();
    await registrarAcceso(
      req({ user: AGENTE, body: BODY, licencia: { id: 'lic-1', sucursal_id: 'suc-OTRA', empresa_id: 'emp-1' } }),
      res,
    );
    expect(res.status).toHaveBeenCalledWith(403);
    expect(mockPool.connect).not.toHaveBeenCalled();
  });

  it('campos que exceden la longitud de la columna → 400 (antes: 500 con el mensaje de Postgres)', async () => {
    const res = makeRes();
    await registrarAcceso(req({ user: AGENTE, body: { ...BODY, numero_dpi: '1'.repeat(40) } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockPool.connect).not.toHaveBeenCalled();
  });
});

describe('registrarSalida', () => {
  it('un acceso de otra empresa responde 404 igual que uno inexistente (antes 403/409 revelaban que existía)', async () => {
    mockPool.query.mockResolvedValue({ rows: [] });
    const res = makeRes();
    await registrarSalida(req({ user: AGENTE, params: { id: UUID_A } }), res);
    expect(res.status).toHaveBeenCalledWith(404);
    // ambas consultas (UPDATE y diagnóstico) llevan el filtro de alcance
    expect(mockPool.query).toHaveBeenCalledTimes(2);
    for (const call of mockPool.query.mock.calls) {
      expect(call[0]).toContain('sucursales _os');
      expect(call[1]).toEqual([UUID_A, ...ownershipParams(AGENTE as any)]);
    }
  });

  it('un acceso propio que ya tenía salida → 409', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: UUID_A, timestamp_salida: new Date() }] });
    const res = makeRes();
    await registrarSalida(req({ user: AGENTE, params: { id: UUID_A } }), res);
    expect(res.status).toHaveBeenCalledWith(409);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('preautorizaciones', () => {
  it('una preautorización sólo de PLACA ya no autoriza a cualquier DPI (antes numero_dpi IS NULL era comodín)', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });
    const ok = await checkPreautorizacion('1234567890101', 'res-1', null);
    expect(ok).toBe(false);
    const sql = sqlDe();
    expect(sql).not.toMatch(/numero_dpi = \$2 OR numero_dpi IS NULL\)/);
    expect(sql).toContain('numero_dpi IS NULL AND placa IS NOT NULL');
    expect(mockPool.query.mock.calls[0][1]).toEqual(['res-1', '1234567890101', null]);
  });

  it('createPreautorizacion sobre un residente fuera del alcance → 404', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });
    const res = makeRes();
    await createPreautorizacion(
      req({ user: ADM_SUC, body: { residente_id: UUID_B, nombre_visitante: 'X', numero_dpi: '1', fecha_inicio: '2026-01-01', fecha_fin: '2026-01-02' } }),
      res,
    );
    expect(res.status).toHaveBeenCalledWith(404);
    expect(sqlDe()).toContain('sucursales _os');
    expect(mockPool.query).toHaveBeenCalledTimes(1); // no insertó
  });
});

describe('sync/garita', () => {
  it('agente de la sucursal A con la licencia de la B → 403 (no descarga el padrón de la B)', async () => {
    const res = makeRes();
    await getSnapshotGarita(
      req({ user: AGENTE, licencia: { id: 'lic-1', sucursal_id: 'suc-B', empresa_id: 'emp-2' } }),
      res,
    );
    expect(res.status).toHaveBeenCalledWith(403);
    expect(mockPool.query).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('cargos', () => {
  it('updateCargo (programados) lleva el filtro de alcance', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });
    const res = makeRes();
    await updateCargo(req({ user: ADM_SUC, params: { id: UUID_A }, body: { monto: 5 } }), res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(sqlDe()).toContain('sucursales _os');
    expect(mockPool.query.mock.calls[0][1].slice(-3)).toEqual(['admin_sucursal', 'emp-1', 'suc-1']);
  });

  it('createConfiguracion: sucursal de otra empresa → 403 y no inserta', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });
    const res = makeRes();
    await createConfiguracion(req({ user: ADM_EMP, body: { nombre: 'Cuota', monto: 100, sucursal_id: UUID_A } }), res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(mockPool.query).toHaveBeenCalledTimes(1);
  });

  it('createConfiguracion: monto negativo o frecuencia inválida → 400', async () => {
    const r1 = makeRes();
    await createConfiguracion(req({ user: ADM_SUC, body: { nombre: 'x', monto: -5 } }), r1);
    expect(r1.status).toHaveBeenCalledWith(400);
    const r2 = makeRes();
    await createConfiguracion(req({ user: ADM_SUC, body: { nombre: 'x', monto: 5, frecuencia: 'cada_segundo' } }), r2);
    expect(r2.status).toHaveBeenCalledWith(400);
  });
});

describe('pagos', () => {
  const clientPago = (estado: string, encontrado = true) => ({
    query: jest.fn(async (sql: string, _params?: unknown[]) => {
      if (sql.includes('FROM pagos p')) return { rows: encontrado ? [{ residente_id: 'res-1', estado }] : [] };
      return { rows: [], rowCount: 0 };
    }),
    release: jest.fn(),
  });

  it('aprobarPago bloquea la fila (FOR UPDATE): dos clics simultáneos no liquidan dos veces', async () => {
    const client = clientPago('pendiente');
    mockPool.connect.mockResolvedValue(client);
    await aprobarPago(req({ user: ADM_SUC, params: { id: UUID_A } }), makeRes());
    const sel = client.query.mock.calls.find(c => String(c[0]).includes('FROM pagos p'))!;
    expect(sel[0]).toContain('FOR UPDATE OF p');
  });

  it('aprobarPago NO resucita un pago rechazado', async () => {
    const client = clientPago('rechazado');
    mockPool.connect.mockResolvedValue(client);
    const res = makeRes();
    await aprobarPago(req({ user: ADM_SUC, params: { id: UUID_A } }), res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(client.query.mock.calls.some(c => String(c[0]).includes('UPDATE residentes'))).toBe(false);
  });

  it('createPago sobre un residente fuera del alcance → 404 (antes cualquier admin cobraba a cualquier residente)', async () => {
    const client = { query: jest.fn(async (_sql: string, _params?: unknown[]) => ({ rows: [] })), release: jest.fn() };
    mockPool.connect.mockResolvedValue(client);
    const res = makeRes();
    await createPago(req({ user: ADM_SUC, body: { residente_id: UUID_B, monto: 100 } }), res);
    expect(res.status).toHaveBeenCalledWith(404);
    const sel = client.query.mock.calls.find(c => String(c[0]).includes('FROM residentes WHERE id'))!;
    expect(sel[0]).toContain('sucursales _os');
    expect(client.query.mock.calls.some(c => String(c[0]).includes('INSERT INTO pagos'))).toBe(false);
  });
});

describe('reportes — inyección de fórmulas en el CSV', () => {
  it('las celdas que empiezan con = + - @ se prefijan con comilla para que Excel no las ejecute', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [{
        fecha: '2026-09-01', hora_entrada: '10:00:00', hora_salida: null,
        nombre_visitante: '=HYPERLINK("http://evil","clic")', numero_dpi: '+1234', placa: '-cmd', numero_casa: '@SUM(A1)', cargo_generado: 'No',
      }],
    });
    const res = makeRes();
    await reporteAccesos(req({ user: ADM_SUC, query: { desde: '2026-09-01', hasta: '2026-09-30' } }), res);
    const csv = (res.send as jest.Mock).mock.calls[0][0] as string;
    const fila = csv.split('\n')[1];
    expect(fila).toContain(`"'=HYPERLINK(""http://evil"",""clic"")"`);
    expect(fila).toContain("'+1234");
    expect(fila).toContain("'-cmd");
    expect(fila).toContain("'@SUM(A1)");
    expect(fila).not.toMatch(/(^|,)=/);
  });

  it('fechas con formato inválido → 400 (antes: error de Postgres)', async () => {
    const res = makeRes();
    await reporteAccesos(req({ user: ADM_SUC, query: { desde: "2026-01-01'; --", hasta: '2026-09-30' } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockPool.query).not.toHaveBeenCalled();
  });
});
