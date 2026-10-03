/**
 * Rotación del refresh token con detección de reutilización (SCRUM-124 / S-06): las ramas del controlador, con la base
 * simulada. El comportamiento real contra Postgres (familias, carreras, auditoría) está en `integration/refresh.reuso.int.test.ts`.
 */
jest.mock('../db/pool', () => ({
  __esModule: true,
  default: { query: jest.fn(), connect: jest.fn() },
}));

import pool from '../db/pool';
import { refresh } from '../controllers/auth.controller';
import { tokenRevocado, _reiniciarRevocaciones } from '../utils/revocacion';

process.env.JWT_SECRET = 'test-secret';
const mockPool = pool as unknown as { query: jest.Mock };

const mockRes = () => {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.locals = {};
  res.json = jest.fn().mockReturnValue(res);
  res.cookie = jest.fn().mockReturnValue(res);
  res.clearCookie = jest.fn().mockReturnValue(res);
  return res;
};

const EMPRESA_OK = { id: 'emp-1', nombre: 'Condominio', activo: true, suspendida: false, suspension_motivo: null, suspendida_en: null };
const FILA = {
  id: 'rt-1', usuario_id: 'u-1', nombre: 'Ana', email: 'a@x.com', rol: 'admin_sucursal', sucursal_id: 'suc-1', empresa_id: null,
  empresa_id_via_sucursal: 'emp-1', activo: true, vigente: true, familia_id: 'fam-1', revoked: false, rotado_en: null, en_gracia: false,
};

const sinAuditoria = () => mockPool.query.mock.calls.filter(c => !/INSERT INTO audit_logs/.test(String(c[0])));
const auditorias = () => mockPool.query.mock.calls.filter(c => /INSERT INTO audit_logs/.test(String(c[0])));

/** Prepara las dos primeras consultas: el token y la empresa. Lo demás responde vacío salvo lo que el caso pida. */
const conToken = (fila: Record<string, unknown>) => {
  mockPool.query.mockResolvedValue({ rows: [], rowCount: 0 });
  mockPool.query
    .mockResolvedValueOnce({ rows: [{ ...FILA, ...fila }] })
    .mockResolvedValueOnce({ rows: [EMPRESA_OK] });
};
const llamar = async () => {
  const res = mockRes();
  await refresh({ cookies: { refresh_token: 'raw' }, headers: {}, ip: '1.1.1.1' } as any, res);
  return res;
};

beforeEach(() => { mockPool.query.mockReset(); _reiniciarRevocaciones(); delete process.env.REFRESH_GRACIA_SEGUNDOS; });

describe('refresh: rotación normal', () => {
  it('revoca el viejo y crea el nuevo en UNA sentencia, heredando la familia, y responde con el access token', async () => {
    conToken({});
    mockPool.query.mockResolvedValueOnce({ rows: [{ id: 'rt-2' }], rowCount: 1 });          // la rotación atómica devolvió fila
    const res = await llamar();
    expect(res.status).not.toHaveBeenCalled();
    expect(res.cookie).toHaveBeenCalledWith('refresh_token', expect.any(String), expect.objectContaining({ httpOnly: true }));
    expect(res.json.mock.calls[0][0].token).toBeDefined();

    const rotacion = sinAuditoria()[2];
    expect(rotacion[0]).toMatch(/WITH viejo AS \(\s*UPDATE refresh_tokens SET revoked = TRUE, revoked_at = NOW\(\), rotado_en = NOW\(\), reemplazado_por = \$5/);
    expect(rotacion[0]).toMatch(/INSERT INTO refresh_tokens \(id, usuario_id, token_hash, expires_at, ip_address, familia_id\)/);
    expect(rotacion[1][0]).toBe('rt-1');                                                    // reclama el token que llegó
    expect(sinAuditoria()).toHaveLength(3);                                                 // token + empresa + rotación: nada más
    expect(auditorias()).toHaveLength(0);                                                   // las renovaciones buenas no se auditan
  });

  it('pierde la carrera (otra petición ya lo reclamó): recibe su propio sucesor en la misma familia y no es un evento', async () => {
    conToken({});
    mockPool.query
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })                                     // la rotación no devolvió fila
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });                                    // el sucesor en gracia sí se insertó
    const res = await llamar();
    expect(res.status).not.toHaveBeenCalled();
    const hijo = sinAuditoria()[3];
    expect(hijo[0]).toMatch(/INSERT INTO refresh_tokens \(usuario_id, token_hash, expires_at, ip_address, familia_id\)/);
    expect(hijo[1][4]).toBe('fam-1');
    expect(auditorias()).toHaveLength(0);
  });

  it('pierde la carrera Y la familia se cerró entre la lectura y la rotación: no emite nada, responde «sesión cerrada» sin otro evento de robo', async () => {
    conToken({});
    mockPool.query
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })                                     // la rotación no devolvió fila
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });                                    // y la guarda de «familia cerrada» no insertó
    const res = await llamar();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json.mock.calls[0][0].codigo).toBe('sesion_comprometida');
    expect(res.cookie).not.toHaveBeenCalled();
    expect(res.clearCookie).toHaveBeenCalled();
    expect(auditorias()).toHaveLength(1);
    expect(auditorias()[0][1][1]).toBe('REFRESH_RECHAZADO');
    expect(auditorias()[0][1][8]).toBe(JSON.stringify({ motivo: 'sesion_cerrada_por_reuso' }));
  });
});

describe('refresh: token ya rotado', () => {
  it('DENTRO de la gracia: emite un sucesor en la misma familia sin tocar al padre ni cerrar nada', async () => {
    conToken({ revoked: true, rotado_en: new Date(), en_gracia: true });
    mockPool.query.mockResolvedValueOnce({ rows: [], rowCount: 1 });                        // el sucesor se insertó
    const res = await llamar();
    expect(res.status).not.toHaveBeenCalled();
    expect(res.cookie).toHaveBeenCalled();
    const sqls = sinAuditoria().map(c => String(c[0]));
    expect(sqls.some(q => /UPDATE refresh_tokens/.test(q))).toBe(false);
    expect(sqls.some(q => /INSERT INTO refresh_tokens \(usuario_id, token_hash, expires_at, ip_address, familia_id\)/.test(q))).toBe(true);
    expect(auditorias()).toHaveLength(0);
  });

  it('DENTRO de la gracia de un token hermano pero con la familia YA cerrada por reutilización: no emite nada y avisa al titular', async () => {
    conToken({ revoked: true, rotado_en: new Date(), en_gracia: true });
    mockPool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });                        // la guarda de familia cerrada no insertó
    const res = await llamar();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json.mock.calls[0][0].codigo).toBe('sesion_comprometida');
    expect(res.cookie).not.toHaveBeenCalled();
    const insercion = sinAuditoria().map(c => String(c[0])).find(q => /INSERT INTO refresh_tokens/.test(q))!;
    expect(insercion).toMatch(/WHERE NOT EXISTS \(SELECT 1 FROM refresh_tokens WHERE familia_id = \$5::uuid AND cierre_motivo = 'reutilizacion'\)/);
    expect(auditorias()).toHaveLength(1);
    expect(auditorias()[0][1][8]).toBe(JSON.stringify({ motivo: 'sesion_cerrada_por_reuso' }));
  });

  it('FUERA de la gracia: cierra la familia entera, corta los access tokens, limpia la cookie, responde 401 y lo audita', async () => {
    conToken({ revoked: true, rotado_en: new Date(Date.now() - 60_000), en_gracia: false });
    mockPool.query.mockResolvedValueOnce({ rows: [], rowCount: 3 });                        // UPDATE de la familia: 3 tokens vivos
    const res = await llamar();

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json.mock.calls[0][0].codigo).toBe('sesion_comprometida');
    expect(res.clearCookie).toHaveBeenCalledWith('refresh_token', expect.any(Object));
    expect(res.cookie).not.toHaveBeenCalled();

    const cierre = sinAuditoria()[2];
    expect(cierre[0]).toMatch(/UPDATE refresh_tokens SET revoked = TRUE, revoked_at = NOW\(\), cierre_motivo = 'reutilizacion'\s+WHERE familia_id = \$1 AND revoked = FALSE/);
    expect(cierre[1]).toEqual(['fam-1']);
    expect(sinAuditoria().some(c => /INSERT INTO refresh_tokens/.test(String(c[0])))).toBe(false);   // no se emite nada

    // Los access tokens de la persona anteriores a este momento dejan de servir.
    expect(tokenRevocado({ id: 'u-1', iat: Math.floor(Date.now() / 1000) - 30 })).toBe(true);

    expect(auditorias()).toHaveLength(1);
    expect(auditorias()[0][1]).toEqual(['u-1', 'REFRESH_REUTILIZADO', 'refresh_tokens', null, '1.1.1.1', null, 'suc-1', 401,
      JSON.stringify({ motivo: 'token_reutilizado', sesiones_cerradas: 3 })]);
  });

  it('un token que la detección de robo ya cerró: el dueño legítimo se entera (sesion_comprometida), sin otro evento de robo', async () => {
    conToken({ revoked: true, rotado_en: null, cierre_motivo: 'reutilizacion' });
    const res = await llamar();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json.mock.calls[0][0].codigo).toBe('sesion_comprometida');
    expect(res.clearCookie).toHaveBeenCalled();
    expect(sinAuditoria().some(c => /familia_id = \$1/.test(String(c[0])))).toBe(false);
    expect(auditorias()).toHaveLength(1);
    expect(auditorias()[0][1][1]).toBe('REFRESH_RECHAZADO');
    expect(auditorias()[0][1][8]).toBe(JSON.stringify({ motivo: 'sesion_cerrada_por_reuso' }));
  });

  it('revocado por cierre de sesión, baja o suspensión (sin rotado_en): 401 normal, sin cerrar la familia ni cortar access tokens', async () => {
    conToken({ revoked: true, rotado_en: null, en_gracia: false });
    const res = await llamar();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json.mock.calls[0][0].codigo).toBeUndefined();
    expect(sinAuditoria().some(c => /familia_id = \$1/.test(String(c[0])))).toBe(false);
    expect(tokenRevocado({ id: 'u-1', iat: Math.floor(Date.now() / 1000) - 30 })).toBe(false);
    expect(auditorias()[0][1][1]).toBe('REFRESH_RECHAZADO');
    expect(auditorias()[0][1][8]).toBe(JSON.stringify({ motivo: 'token_revocado' }));
  });

  it('la gracia sale de REFRESH_GRACIA_SEGUNDOS (10 por omisión) y un valor absurdo vuelve al valor por omisión', async () => {
    conToken({});
    mockPool.query.mockResolvedValueOnce({ rows: [{ id: 'rt-2' }], rowCount: 1 });
    await llamar();
    expect(sinAuditoria()[0][1]).toEqual([expect.any(String), 10]);

    mockPool.query.mockReset();
    process.env.REFRESH_GRACIA_SEGUNDOS = '3';
    conToken({});
    mockPool.query.mockResolvedValueOnce({ rows: [{ id: 'rt-2' }], rowCount: 1 });
    await llamar();
    expect(sinAuditoria()[0][1][1]).toBe(3);

    mockPool.query.mockReset();
    process.env.REFRESH_GRACIA_SEGUNDOS = 'no-es-un-numero';
    conToken({});
    mockPool.query.mockResolvedValueOnce({ rows: [{ id: 'rt-2' }], rowCount: 1 });
    await llamar();
    expect(sinAuditoria()[0][1][1]).toBe(10);
  });
});
