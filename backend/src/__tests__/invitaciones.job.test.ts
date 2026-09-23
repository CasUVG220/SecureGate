jest.mock('../db/pool', () => ({ __esModule: true, default: { query: jest.fn() } }));

import pool from '../db/pool';
import { expirarInvitaciones } from '../jobs/invitaciones.job';

const mockPool = pool as unknown as { query: jest.Mock };

describe('expirarInvitaciones', () => {
  it('marca como expiradas sólo las pendientes vencidas y reporta cuántas', async () => {
    mockPool.query.mockResolvedValueOnce({ rowCount: 3, rows: [{}, {}, {}] });
    const r = await expirarInvitaciones();
    expect(r).toEqual({ expiradas: 3 });
    const sql = mockPool.query.mock.calls[0][0];
    expect(sql).toMatch(/SET estado = 'expirada'/);
    expect(sql).toMatch(/estado = 'pendiente' AND expira_en <= NOW\(\)/);
  });
});
