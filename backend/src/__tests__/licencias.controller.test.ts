/**
 * ── Por qué se prioriza esta lógica para testing ─────────────────────────────
 * La licencia es la llave del dispositivo de garita. Un fallo aquí tiene dos
 * caras: un código activable en N máquinas (licencia compartida = pérdida de
 * ingresos) o un heartbeat que no respeta la revocación (kill switch roto =
 * equipo robado sigue sincronizando). Se prueba el enrutado de decisiones,
 * no el SQL: pool mockeado como en el resto de la suite.
 */
jest.mock('../db/pool', () => ({
  __esModule: true,
  default: { query: jest.fn(), connect: jest.fn() },
}));

import jwt from 'jsonwebtoken';
import pool from '../db/pool';
import { activarLicencia, heartbeatLicencia, revocarLicencia, generarCodigo } from '../controllers/licencias.controller';
import { validarLicencia, hashFingerprint, LICENCIA_HEADER } from '../middleware/licencia.middleware';

process.env.JWT_SECRET = 'test-secret';

const mockPool = pool as unknown as { query: jest.Mock };
const FP = 'a'.repeat(64);

const mockRes = () => {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

const filaLicencia = (over: Record<string, unknown> = {}) => ({
  id: 'lic-1', sucursal_id: 'suc-1', estado: 'activa', fingerprint: null,
  sucursal_nombre: 'Garita Norte', empresa_id: 'emp-1', ...over,
});

describe('generarCodigo', () => {
  it('produce códigos SG-XXXX-XXXX-XXXX-XXXX sin caracteres ambiguos', () => {
    for (let i = 0; i < 50; i++) {
      const c = generarCodigo();
      expect(c).toMatch(/^SG-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
      expect(c).not.toMatch(/[01OIL]/);
    }
  });
});

describe('activarLicencia', () => {
  it('rechaza sin codigo o fingerprint', async () => {
    const res = mockRes();
    await activarLicencia({ body: { codigo: 'SG-1' } } as any, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockPool.query).not.toHaveBeenCalled();
  });

  it('vincula un código libre al fingerprint y devuelve un token de licencia', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [filaLicencia()] })          // SELECT por código
      .mockResolvedValueOnce({ rows: [{ id: 'lic-1' }] });        // UPDATE ... WHERE fingerprint IS NULL
    const res = mockRes();
    await activarLicencia({ body: { codigo: 'sg-abcd-efgh-jkmn-pqrs', fingerprint: FP } } as any, res);

    expect(res.status).not.toHaveBeenCalledWith(expect.any(Number));
    const body = res.json.mock.calls[0][0];
    expect(body.licencia).toEqual({ id: 'lic-1', sucursal_id: 'suc-1', sucursal_nombre: 'Garita Norte', empresa_id: 'emp-1' });

    // El código se normaliza a mayúsculas antes de buscarlo
    expect(mockPool.query.mock.calls[0][1]).toEqual(['SG-ABCD-EFGH-JKMN-PQRS']);
    // El UPDATE es condicional a fingerprint IS NULL (carrera entre dos máquinas)
    expect(mockPool.query.mock.calls[1][0]).toContain('fingerprint IS NULL');

    // El token lleva sólo el hash del fingerprint, nunca el crudo
    const payload = jwt.verify(body.token_licencia, 'test-secret') as any;
    expect(payload.typ).toBe('licencia');
    expect(payload.lic).toBe('lic-1');
    expect(payload.fp).toBe(hashFingerprint(FP));
    expect(JSON.stringify(payload)).not.toContain(FP);
  });

  it('rechaza (409) un código ya vinculado a OTRO dispositivo', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [filaLicencia({ fingerprint: 'b'.repeat(64) })] });
    const res = mockRes();
    await activarLicencia({ body: { codigo: 'SG-X', fingerprint: FP } } as any, res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(mockPool.query).toHaveBeenCalledTimes(1);
  });

  it('rechaza (409) si otra máquina ganó la carrera del UPDATE', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [filaLicencia()] })
      .mockResolvedValueOnce({ rows: [] });                        // UPDATE no afectó filas
    const res = mockRes();
    await activarLicencia({ body: { codigo: 'SG-X', fingerprint: FP } } as any, res);
    expect(res.status).toHaveBeenCalledWith(409);
  });

  it('permite reactivar desde el MISMO dispositivo (reinstalación) sin re-vincular', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [filaLicencia({ fingerprint: FP })] })
      .mockResolvedValueOnce({ rows: [] });                        // UPDATE ultimo_heartbeat
    const res = mockRes();
    await activarLicencia({ body: { codigo: 'SG-X', fingerprint: FP } } as any, res);
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json.mock.calls[0][0].token_licencia).toEqual(expect.any(String));
    expect(mockPool.query.mock.calls[1][0]).not.toContain('SET fingerprint');
  });

  it('rechaza (403) una licencia revocada aunque el código sea correcto', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [filaLicencia({ estado: 'revocada', fingerprint: FP })] });
    const res = mockRes();
    await activarLicencia({ body: { codigo: 'SG-X', fingerprint: FP } } as any, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ estado: 'revocada' }));
  });

  it('responde 404 genérico para un código inexistente', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });
    const res = mockRes();
    await activarLicencia({ body: { codigo: 'SG-NOPE', fingerprint: FP } } as any, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });
});

describe('validarLicencia / heartbeat', () => {
  const tokenValido = () => jwt.sign(
    { typ: 'licencia', lic: 'lic-1', sucursal_id: 'suc-1', empresa_id: 'emp-1', fp: hashFingerprint(FP) },
    'test-secret', { expiresIn: '1h' },
  );

  it('acepta un token válido cuya fila sigue activa y con el mismo fingerprint', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [filaLicencia({ fingerprint: FP })] });
    const r = await validarLicencia(tokenValido(), FP);
    expect(r).toEqual({ ok: true, licencia: { id: 'lic-1', sucursal_id: 'suc-1', empresa_id: 'emp-1' } });
  });

  it('KILL SWITCH: el heartbeat falla con estado=revocada cuando la fila fue revocada', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [filaLicencia({ fingerprint: FP, estado: 'revocada' })] });
    const res = mockRes();
    await heartbeatLicencia(
      { headers: { [LICENCIA_HEADER]: tokenValido() }, body: { fingerprint: FP } } as any, res,
    );
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ estado: 'revocada' }));
    // No se registra heartbeat de una licencia revocada
    expect(mockPool.query).toHaveBeenCalledTimes(1);
  });

  it('rechaza un token copiado a otra máquina (fingerprint distinto al vinculado)', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [filaLicencia({ fingerprint: FP })] });
    const r = await validarLicencia(tokenValido(), 'c'.repeat(64));
    expect(r.ok).toBe(false);
    if (r.ok === false) expect(r.status).toBe(403);
  });

  it('rechaza un JWT de usuario (sin typ=licencia) aunque esté firmado con el mismo secreto', async () => {
    const jwtUsuario = jwt.sign({ id: 'u1', rol: 'agente' }, 'test-secret');
    const r = await validarLicencia(jwtUsuario);
    expect(r.ok).toBe(false);
    expect(mockPool.query).not.toHaveBeenCalled();
  });

  it('rechaza sin token (401) y con token mal firmado (403)', async () => {
    expect((await validarLicencia(undefined) as any).status).toBe(401);
    const ajeno = jwt.sign({ typ: 'licencia', lic: 'lic-1', fp: 'x' }, 'otro-secreto');
    expect((await validarLicencia(ajeno) as any).status).toBe(403);
  });

  it('heartbeat OK actualiza ultimo_heartbeat y devuelve intervalo + gracia', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [filaLicencia({ fingerprint: FP })] })
      .mockResolvedValueOnce({ rows: [] });
    const res = mockRes();
    await heartbeatLicencia({ headers: { [LICENCIA_HEADER]: tokenValido() }, body: {} } as any, res);
    expect(mockPool.query.mock.calls[1][0]).toContain('ultimo_heartbeat = NOW()');
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      estado: 'activa', heartbeat_intervalo_min: 15, gracia_offline_horas: 72,
    }));
  });
});

describe('revocarLicencia', () => {
  const admin = { id: 'adm', rol: 'admin_sucursal', sucursal_id: 'suc-1', empresa_id: 'emp-1' };

  it('revoca una licencia activa del propio tenant', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [{ id: 'lic-1', estado: 'revocada', revocado_en: 'now' }] });
    const res = mockRes();
    await revocarLicencia({ params: { id: 'lic-1' }, user: admin } as any, res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ estado: 'revocada' }));
    expect(mockPool.query.mock.calls[0][1]).toEqual(['lic-1', 'admin_sucursal', 'emp-1', 'suc-1']);
  });

  it('409 si ya estaba revocada, 404 si no existe, 403 si es de otro tenant', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ estado: 'revocada' }] });
    let res = mockRes();
    await revocarLicencia({ params: { id: 'lic-1' }, user: admin } as any, res);
    expect(res.status).toHaveBeenCalledWith(409);

    mockPool.query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] });
    res = mockRes();
    await revocarLicencia({ params: { id: 'nope' }, user: admin } as any, res);
    expect(res.status).toHaveBeenCalledWith(404);

    mockPool.query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ estado: 'activa' }] });
    res = mockRes();
    await revocarLicencia({ params: { id: 'lic-ajena' }, user: admin } as any, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });
});
