/**
 * ── Por qué se prioriza esta lógica para testing ─────────────────────────────
 * Suspender una empresa es el mecanismo comercial de cobro (impago) y el de
 * seguridad ante incumplimiento. Si falla en silencio, una empresa suspendida
 * sigue operando: sus admins entran, sus residentes pagan y sus garitas
 * sincronizan. Se prueba que los tres puntos de entrada —login, refresh y
 * licencia de garita— cierran, y que eliminar una empresa arrastra licencias,
 * invitaciones y sesiones.
 */
jest.mock('../db/pool', () => ({
  __esModule: true,
  default: { query: jest.fn(), connect: jest.fn() },
}));

import jwt from 'jsonwebtoken';
import pool from '../db/pool';
import { login, refresh } from '../controllers/auth.controller';
import { validarLicencia, firmarLicencia, hashFingerprint } from '../middleware/licencia.middleware';
import { suspenderEmpresa, reactivarEmpresa, deleteEmpresa, updateEmpresa } from '../controllers/empresas.controller';
import { evaluarEmpresa, bloqueoDeUsuario, HTTP_BLOQUEO } from '../utils/suspension';

process.env.JWT_SECRET = 'test-secret';

const mockPool = pool as unknown as { query: jest.Mock; connect: jest.Mock };

const mockRes = () => {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.locals = {};
  res.json = jest.fn().mockReturnValue(res);
  res.cookie = jest.fn().mockReturnValue(res);
  res.clearCookie = jest.fn().mockReturnValue(res);
  return res;
};

const EMPRESA = { id: 'emp-1', nombre: 'Condominio X', activo: true, suspendida: false, suspension_motivo: null, suspendida_en: null };
const SUSPENDIDA = { ...EMPRESA, suspendida: true, suspension_motivo: 'Factura de agosto pendiente', suspendida_en: new Date() };
const FP = 'a'.repeat(64);

beforeEach(() => { mockPool.query.mockReset(); mockPool.connect.mockReset(); });

/** Las consultas del controlador, sin la fila de auditoría que se escribe al margen (fire-and-forget). */
const sinAuditoria = () => mockPool.query.mock.calls.filter(c => !/INSERT INTO audit_logs/.test(String(c[0])));
const auditorias = () => mockPool.query.mock.calls.filter(c => /INSERT INTO audit_logs/.test(String(c[0])));

describe('evaluarEmpresa / bloqueoDeUsuario', () => {
  it('activa y no suspendida → sin bloqueo; suspendida → motivo; inactiva → baja', () => {
    expect(evaluarEmpresa(EMPRESA)).toBeNull();
    expect(evaluarEmpresa(SUSPENDIDA)).toEqual(expect.objectContaining({ codigo: 'empresa_suspendida', motivo: 'Factura de agosto pendiente' }));
    expect(evaluarEmpresa({ ...SUSPENDIDA, activo: false })?.codigo).toBe('empresa_inactiva');
    expect(evaluarEmpresa(undefined)).toBeNull();
  });

  it('el owner nunca se bloquea y no consulta la base', async () => {
    expect(await bloqueoDeUsuario(pool as any, { rol: 'owner', empresa_id: null, sucursal_id: null })).toBeNull();
    expect(mockPool.query).not.toHaveBeenCalled();
  });

  it('resuelve la empresa por sucursal cuando el usuario no la tiene directa (agente, residente)', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [SUSPENDIDA] });
    const b = await bloqueoDeUsuario(pool as any, { rol: 'agente', empresa_id: null, sucursal_id: 'suc-1' });
    expect(b?.codigo).toBe('empresa_suspendida');
    expect(mockPool.query.mock.calls[0][1]).toEqual([null, 'suc-1']);
  });
});

describe('login con empresa suspendida', () => {
  const filaUsuario = { id: 'u-1', nombre: 'Ana', email: 'ana@x.com', rol: 'admin_sucursal', sucursal_id: 'suc-1', empresa_id: null, empresa_id_via_sucursal: 'emp-1', idioma: 'es', tema: 'dark' };

  it('credenciales correctas + empresa suspendida → 423 con el motivo, sin emitir sesión', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [filaUsuario] })   // usuario
      .mockResolvedValueOnce({ rows: [{ ok: true }] })  // crypt(): contraseña correcta
      .mockResolvedValueOnce({ rows: [SUSPENDIDA] });   // estado de la empresa
    const res = mockRes();
    await login({ body: { email: 'ana@x.com', password: 'secret1' }, headers: {}, ip: '1.1.1.1' } as any, res);

    expect(res.status).toHaveBeenCalledWith(HTTP_BLOQUEO);
    const body = res.json.mock.calls[0][0];
    expect(body).toEqual(expect.objectContaining({ codigo: 'empresa_suspendida', empresa: 'Condominio X', motivo: 'Factura de agosto pendiente', estado: 'suspendida' }));
    expect(body.error).toMatch(/suspendidas/);
    expect(res.cookie).not.toHaveBeenCalled();
    expect(mockPool.query.mock.calls.some(c => /INSERT INTO refresh_tokens/.test(c[0]))).toBe(false);
  });

  it('empresa activa → sesión normal', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [filaUsuario] })
      .mockResolvedValueOnce({ rows: [{ ok: true }] })  // crypt()
      .mockResolvedValueOnce({ rows: [EMPRESA] })
      .mockResolvedValueOnce({});                       // INSERT refresh_tokens
    const res = mockRes();
    await login({ body: { email: 'ana@x.com', password: 'secret1' }, headers: {}, ip: '1.1.1.1' } as any, res);
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json.mock.calls[0][0].token).toBeDefined();
  });

  it('el owner entra aunque no tenga empresa', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ ...filaUsuario, rol: 'owner', sucursal_id: null, empresa_id_via_sucursal: null }] })
      .mockResolvedValueOnce({ rows: [{ ok: true }] })  // crypt()
      .mockResolvedValueOnce({});
    const res = mockRes();
    await login({ body: { email: 'o@x.com', password: 'secret1' }, headers: {}, ip: '1.1.1.1' } as any, res);
    expect(res.status).not.toHaveBeenCalled();
    expect(mockPool.query).toHaveBeenCalledTimes(3); // usuario + crypt + INSERT; sin consulta de empresa
  });
});

describe('refresh con empresa suspendida', () => {
  it('revoca el refresh token, limpia la cookie y responde 423', async () => {
    mockPool.query.mockResolvedValue({ rows: [], rowCount: 0 });       // por omisión (p. ej. la fila de auditoría)
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ id: 'rt-1', usuario_id: 'u-1', nombre: 'Ana', email: 'a@x.com', rol: 'residente', sucursal_id: 'suc-1', empresa_id: null, empresa_id_via_sucursal: 'emp-1' }] })
      .mockResolvedValueOnce({ rows: [SUSPENDIDA] })
      .mockResolvedValueOnce({});                       // UPDATE revoked
    const res = mockRes();
    await refresh({ cookies: { refresh_token: 'raw' }, headers: {}, ip: '1.1.1.1' } as any, res);

    expect(res.status).toHaveBeenCalledWith(HTTP_BLOQUEO);
    expect(res.clearCookie).toHaveBeenCalledWith('refresh_token', expect.any(Object));
    expect(sinAuditoria()[2][0]).toMatch(/SET revoked = TRUE WHERE id = \$1/);
    expect(mockPool.query.mock.calls.some(c => /INSERT INTO refresh_tokens/.test(c[0]))).toBe(false);
    // El rechazo queda en la bitácora con la persona del token, la IP y el motivo (RNF-10).
    expect(auditorias()).toHaveLength(1);
    expect(auditorias()[0][1]).toEqual(['u-1', 'REFRESH_RECHAZADO', 'refresh_tokens', null, '1.1.1.1', null, 'suc-1', 423, JSON.stringify({ motivo: 'empresa_suspendida' })]);
  });
});

describe('refresh: 423 también cuando suspender ya revocó el token (S-11)', () => {
  const FILA = { id: 'rt-1', usuario_id: 'u-1', nombre: 'Ana', email: 'a@x.com', rol: 'residente', sucursal_id: 'suc-1', empresa_id: null, empresa_id_via_sucursal: 'emp-1', activo: true };
  const llamar = async () => {
    const res = mockRes();
    await refresh({ cookies: { refresh_token: 'raw' }, headers: {}, ip: '1.1.1.1' } as any, res);
    return res;
  };
  beforeEach(() => { mockPool.query.mockResolvedValue({ rows: [], rowCount: 0 }); });

  it('token revocado por la suspensión + empresa suspendida → 423 con el motivo, sin tocar nada más', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ ...FILA, revoked: true, vigente: true }] })
      .mockResolvedValueOnce({ rows: [SUSPENDIDA] });
    const res = await llamar();
    expect(res.status).toHaveBeenCalledWith(HTTP_BLOQUEO);
    expect((res.json as jest.Mock).mock.calls[0][0]).toEqual(expect.objectContaining({ codigo: 'empresa_suspendida', empresa: SUSPENDIDA.nombre }));
    expect(res.clearCookie).toHaveBeenCalled();
    expect(sinAuditoria()).toHaveLength(2);   // ya estaba revocado: no vuelve a escribir
    expect(auditorias()).toHaveLength(1);
  });

  it('token revocado y empresa en regla (cierre de sesión, rotación vieja) → 401, auditado como «token_revocado»', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ ...FILA, revoked: true, vigente: true }] })
      .mockResolvedValueOnce({ rows: [{ id: 'emp-1', nombre: 'Condominio', activo: true, suspendida: false, suspension_motivo: null, suspendida_en: null }] });
    const res = await llamar();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(mockPool.query.mock.calls.some(c => /INSERT INTO refresh_tokens/.test(c[0]))).toBe(false);
    expect(auditorias()[0][1][1]).toBe('REFRESH_RECHAZADO');
    expect(auditorias()[0][1][7]).toBe(401);
    expect(auditorias()[0][1][8]).toBe(JSON.stringify({ motivo: 'token_revocado' }));
  });

  it('token vencido o usuario dado de baja → 401 sin revelar el estado de la empresa (ni consultarlo)', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [{ ...FILA, revoked: true, vigente: false }] });
    expect((await llamar()).status).toHaveBeenCalledWith(401);
    mockPool.query.mockResolvedValueOnce({ rows: [{ ...FILA, revoked: false, vigente: true, activo: false }] });
    expect((await llamar()).status).toHaveBeenCalledWith(401);
    expect(sinAuditoria()).toHaveLength(2);   // solo las dos búsquedas del token
    expect(auditorias().map(a => JSON.parse(a[1][8]).motivo)).toEqual(['token_vencido', 'usuario_inactivo']);
  });

  it('token que no existe → 401 (sin usuario que atribuir, pero con IP)', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });
    expect((await llamar()).status).toHaveBeenCalledWith(401);
    expect(auditorias()[0][1][0]).toBeNull();
    expect(auditorias()[0][1][4]).toBe('1.1.1.1');
    expect(auditorias()[0][1][8]).toBe(JSON.stringify({ motivo: 'token_desconocido' }));
  });
});

describe('licencia de garita con empresa suspendida', () => {
  const token = firmarLicencia({ lic: 'lic-1', sucursal_id: 'suc-1', empresa_id: 'emp-1', fp: hashFingerprint(FP) });
  const fila = (emp: typeof EMPRESA) => ({
    id: 'lic-1', sucursal_id: 'suc-1', estado: 'activa', fingerprint: FP, empresa_id: 'emp-1',
    e_id: emp.id, e_nombre: emp.nombre, e_activo: emp.activo, e_suspendida: emp.suspendida, e_motivo: emp.suspension_motivo, e_desde: emp.suspendida_en,
  });

  it('suspendida → 423 estado "suspendida" (la app deja de sincronizar sin perder la licencia)', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [fila(SUSPENDIDA)] });
    const r = await validarLicencia(token, FP);
    expect(r).toEqual(expect.objectContaining({ ok: false, status: HTTP_BLOQUEO, estado: 'suspendida' }));
  });

  it('activa → ok', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [fila(EMPRESA)] });
    const r = await validarLicencia(token, FP);
    expect(r.ok).toBe(true);
  });
});

describe('suspender / reactivar / eliminar', () => {
  const client = { query: jest.fn(), release: jest.fn() };
  beforeEach(() => { client.query.mockReset(); client.release.mockReset(); mockPool.connect.mockResolvedValue(client); });

  it('suspender exige motivo', async () => {
    const res = mockRes();
    await suspenderEmpresa({ params: { id: 'emp-1' }, body: { motivo: 'x' } } as any, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockPool.connect).not.toHaveBeenCalled();
  });

  it('suspender marca la empresa y cierra las sesiones de toda la empresa en una transacción', async () => {
    client.query
      .mockResolvedValueOnce({})                                  // BEGIN
      .mockResolvedValueOnce({ rows: [SUSPENDIDA] })              // UPDATE empresas
      .mockResolvedValueOnce({})                                  // revocar sesiones
      .mockResolvedValueOnce({});                                 // COMMIT
    const res = mockRes();
    await suspenderEmpresa({ params: { id: 'emp-1' }, body: { motivo: 'Factura de agosto pendiente' } } as any, res);

    const sqls = client.query.mock.calls.map(c => c[0]);
    expect(sqls[1]).toMatch(/SET suspendida = TRUE, suspension_motivo = \$2, suspendida_en = NOW\(\)/);
    expect(client.query.mock.calls[1][1]).toEqual(['emp-1', 'Factura de agosto pendiente']);
    expect(sqls[2]).toMatch(/UPDATE refresh_tokens SET revoked = TRUE/);
    expect(sqls[2]).toMatch(/u\.empresa_id = \$1 OR s\.empresa_id = \$1/);
    expect(sqls).toContain('COMMIT');
    expect(res.json.mock.calls[0][0].suspendida).toBe(true);
  });

  it('reactivar limpia motivo y fecha; 404 si no estaba suspendida', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [EMPRESA] });
    const res = mockRes();
    await reactivarEmpresa({ params: { id: 'emp-1' } } as any, res);
    expect(mockPool.query.mock.calls[0][0]).toMatch(/SET suspendida = FALSE, suspension_motivo = NULL, suspendida_en = NULL/);
    expect(res.status).not.toHaveBeenCalled();

    mockPool.query.mockResolvedValueOnce({ rows: [] });
    const res2 = mockRes();
    await reactivarEmpresa({ params: { id: 'emp-1' } } as any, res2);
    expect(res2.status).toHaveBeenCalledWith(404);
  });

  it('desactivar (activo=false) cierra las sesiones de la empresa', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [{ ...EMPRESA, activo: false }] }).mockResolvedValueOnce({});
    const res = mockRes();
    await updateEmpresa({ params: { id: 'emp-1' }, body: { activo: false } } as any, res);
    expect(mockPool.query.mock.calls[1][0]).toMatch(/UPDATE refresh_tokens SET revoked = TRUE/);
  });

  it('eliminar arrastra licencias de garita, invitaciones pendientes y sesiones', async () => {
    client.query.mockImplementation(async (sql: string) => {
      if (/SELECT id FROM sucursales/.test(sql)) return { rows: [{ id: 'suc-1' }, { id: 'suc-2' }] };
      if (/UPDATE empresas SET activo = FALSE/.test(sql)) return { rows: [{ id: 'emp-1' }] };
      return { rows: [] };
    });
    const res = mockRes();
    await deleteEmpresa({ params: { id: 'emp-1' } } as any, res);

    const sqls = client.query.mock.calls.map(c => c[0]);
    const lic = client.query.mock.calls.find(c => /UPDATE licencias_dispositivo SET estado = 'revocada'/.test(c[0]))!;
    expect(lic[1]).toEqual([['suc-1', 'suc-2']]);
    const inv = client.query.mock.calls.find(c => /UPDATE invitaciones SET estado = 'revocada'/.test(c[0]))!;
    expect(inv[1]).toEqual(['emp-1']);
    expect(sqls.some(s => /UPDATE refresh_tokens SET revoked = TRUE/.test(s))).toBe(true);
    expect(sqls.some(s => /UPDATE usuarios SET activo = FALSE/.test(s))).toBe(true);
    expect(sqls).toContain('COMMIT');
    expect(res.status).not.toHaveBeenCalled();
  });
});

describe('JWT de licencia sigue siendo el mismo (sin cambios en la app)', () => {
  it('firmarLicencia emite typ licencia', () => {
    const t = firmarLicencia({ lic: 'l', sucursal_id: 's', empresa_id: 'e', fp: 'f' });
    expect((jwt.verify(t, 'test-secret') as any).typ).toBe('licencia');
  });
});
