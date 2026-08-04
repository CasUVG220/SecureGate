/**
 * ── Por qué se prioriza esta lógica para testing ─────────────────────────────
 * checkBlacklist() es un control de seguridad: se ejecuta en cada registro de
 * acceso para decidir si un visitante puede entrar. Un falso negativo deja
 * pasar a alguien vetado; un falso positivo bloquea a un visitante legítimo.
 * Es lógica de negocio crítica, no un CRUD trivial.
 *
 * El vencimiento del ban se filtra en SQL (fecha_fin IS NULL OR fecha_fin >
 * NOW()). Con pool.query mockeado verificamos el enrutado de resultados
 * (fila → bloqueado, sin fila → null) y que la consulta incluya el guardia de
 * expiración para no considerar bans vencidos.
 */
jest.mock('../db/pool', () => ({
  __esModule: true,
  default: { query: jest.fn(), connect: jest.fn() },
}));

import pool from '../db/pool';
import { checkBlacklist } from '../controllers/blacklist.controller';

const mockPool = pool as unknown as { query: jest.Mock };

describe('checkBlacklist', () => {
  it('detecta como bloqueado un ban indefinido (fecha_fin NULL)', async () => {
    // La consulta a nivel sucursal devuelve el ban activo indefinido
    mockPool.query.mockResolvedValueOnce({
      rows: [{ id: 'ban-1', razon: 'Robo en el condominio', fecha_fin: null }],
    });

    const result = await checkBlacklist('1234567890101', 'suc-1');

    expect(result).not.toBeNull();
    expect(result).toEqual({ id: 'ban-1', razon: 'Robo en el condominio', fecha_fin: null });
    // Basta la consulta de sucursal: no hace falta la de residente
    expect(mockPool.query).toHaveBeenCalledTimes(1);
    expect(mockPool.query).toHaveBeenCalledWith(expect.any(String), ['1234567890101', 'suc-1']);
  });

  it('NO detecta un ban expirado (fecha_fin en el pasado lo excluye el SQL)', async () => {
    // Como el ban está vencido, ambas consultas no devuelven filas
    mockPool.query
      .mockResolvedValueOnce({ rows: [] })   // sucursal-level
      .mockResolvedValueOnce({ rows: [] });  // residente-level

    const result = await checkBlacklist('1234567890101', 'suc-1');

    expect(result).toBeNull();
    // La consulta de sucursal filtra bans vencidos con el guardia de expiración
    const sucursalSql = mockPool.query.mock.calls[0][0] as string;
    expect(sucursalSql).toContain('fecha_fin IS NULL OR bl.fecha_fin > NOW()');
  });

  it('retorna null si el visitante no tiene registro en blacklist', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [] })   // sucursal-level
      .mockResolvedValueOnce({ rows: [] });  // residente-level

    const result = await checkBlacklist('9999999999999', 'suc-1');

    expect(result).toBeNull();
    // Consultó ambos niveles (sucursal y residente) antes de descartar
    expect(mockPool.query).toHaveBeenCalledTimes(2);
  });
});
