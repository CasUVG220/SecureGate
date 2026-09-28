/**
 * Borrado físico de una empresa: irreversible, así que se prueba que (1) sin
 * la contraseña del owner no se toca nada, (2) con ella se borra en el orden
 * de dependencias dentro de una transacción, terminando en `empresas`, y (3)
 * un fallo a mitad hace ROLLBACK.
 */
jest.mock('../db/pool', () => ({
  __esModule: true,
  default: { query: jest.fn(), connect: jest.fn() },
}));

import pool from '../db/pool';
import { eliminarEmpresaDefinitivo } from '../controllers/empresas.controller';

const mockPool = pool as unknown as { query: jest.Mock; connect: jest.Mock };
const mockRes = () => {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};
const OWNER = { id: 'u-owner', rol: 'owner', nombre: 'O', email: 'o@x', sucursal_id: null, empresa_id: null };
const client = { query: jest.fn(), release: jest.fn() };

beforeEach(() => { client.query.mockReset(); client.release.mockReset(); mockPool.connect.mockResolvedValue(client); });

describe('eliminarEmpresaDefinitivo', () => {
  it('sin contraseña → 400 sin abrir conexión', async () => {
    const res = mockRes();
    await eliminarEmpresaDefinitivo({ params: { id: 'emp-1' }, body: {}, user: OWNER } as any, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockPool.connect).not.toHaveBeenCalled();
  });

  it('contraseña incorrecta → 403 y ningún DELETE', async () => {
    client.query.mockResolvedValueOnce({ rows: [] }); // crypt no coincide
    const res = mockRes();
    await eliminarEmpresaDefinitivo({ params: { id: 'emp-1' }, body: { password: 'mala' }, user: OWNER } as any, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(client.query.mock.calls[0][0]).toMatch(/password_hash = crypt\(\$2, password_hash\)/);
    expect(client.query.mock.calls[0][1]).toEqual(['u-owner', 'mala']);
    expect(client.query.mock.calls.some(c => /DELETE|BEGIN/.test(c[0]))).toBe(false);
    expect(client.release).toHaveBeenCalled();
  });

  it('contraseña correcta → borra en orden de dependencias y termina en empresas + COMMIT', async () => {
    client.query.mockImplementation(async (sql: string) => {
      if (/password_hash = crypt/.test(sql)) return { rows: [{}] };
      if (/SELECT id, nombre FROM empresas/.test(sql)) return { rows: [{ id: 'emp-1', nombre: 'Demo' }] };
      if (/SELECT id FROM sucursales/.test(sql)) return { rows: [{ id: 'suc-1' }] };
      if (/SELECT id FROM usuarios/.test(sql)) return { rows: [{ id: 'u-1' }, { id: 'u-2' }] };
      if (/SELECT id FROM residentes/.test(sql)) return { rows: [{ id: 'r-1' }] };
      return { rows: [], rowCount: 1 };
    });
    const res = mockRes();
    await eliminarEmpresaDefinitivo({ params: { id: 'emp-1' }, body: { password: 'ok' }, user: OWNER } as any, res);

    const sqls: string[] = client.query.mock.calls.map(c => c[0]);
    const deletes = sqls.filter(s => s.startsWith('DELETE FROM')).map(s => s.split(' ')[2]);
    // Lo que referencia a residentes/usuarios/sucursales va antes que ellos.
    const idx = (t: string) => deletes.indexOf(t);
    expect(idx('registros_acceso')).toBeGreaterThan(idx('cargos_automaticos'));
    expect(idx('residentes')).toBeGreaterThan(idx('pagos'));
    expect(idx('residentes')).toBeGreaterThan(idx('registros_acceso'));
    expect(idx('usuarios')).toBeGreaterThan(idx('residentes'));
    expect(idx('sucursales')).toBeGreaterThan(idx('usuarios'));
    expect(deletes[deletes.length - 1]).toBe('empresas');
    expect(sqls[sqls.length - 1]).toBe('COMMIT');
    // Los usuarios se resuelven por empresa directa O por sucursal.
    const usuariosSel = client.query.mock.calls.find(c => /SELECT id FROM usuarios/.test(c[0]))!;
    expect(usuariosSel[0]).toMatch(/empresa_id = \$1 OR sucursal_id = ANY/);
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json.mock.calls[0][0]).toEqual(expect.objectContaining({ nombre: 'Demo', eliminado: expect.objectContaining({ empresas: 1 }) }));
  });

  it('un DELETE que falla → ROLLBACK y 500', async () => {
    client.query.mockImplementation(async (sql: string) => {
      if (/password_hash = crypt/.test(sql)) return { rows: [{}] };
      if (/SELECT id, nombre FROM empresas/.test(sql)) return { rows: [{ id: 'emp-1', nombre: 'Demo' }] };
      if (/DELETE FROM pagos/.test(sql)) throw new Error('boom');
      return { rows: [], rowCount: 0 };
    });
    const res = mockRes();
    await eliminarEmpresaDefinitivo({ params: { id: 'emp-1' }, body: { password: 'ok' }, user: OWNER } as any, res);
    expect(client.query.mock.calls.map(c => c[0])).toContain('ROLLBACK');
    expect(res.status).toHaveBeenCalledWith(500);
  });
});
