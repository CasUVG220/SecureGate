/**
 * ── Por qué se prioriza esta lógica para testing ─────────────────────────────
 * updatePreferencias() guarda tema e idioma del usuario. Cuando exigía los dos
 * campos a la vez, quien cambiaba uno tenía que inventar el otro: al iniciar
 * sesión el selector de idioma mandaba el tema por defecto y borraba en la base
 * la preferencia real. El síntoma era desconcertante —la pantalla se veía bien
 * y la preferencia se perdía al volver a entrar—, así que se fija por prueba
 * que un campo nunca puede pisar al otro.
 */
jest.mock('../db/pool', () => ({
  __esModule: true,
  default: { query: jest.fn(), connect: jest.fn() },
}));

import pool from '../db/pool';
import { updatePreferencias } from '../controllers/usuarios.controller';
import type { Request, Response } from 'express';

const mockPool = pool as unknown as { query: jest.Mock };

function makeRes() {
  const res: Partial<Response> = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res as Response;
}

const reqCon = (body: unknown) => ({ body, user: { id: 'usr-1' } } as unknown as Request);

describe('updatePreferencias', () => {
  beforeEach(() => { mockPool.query.mockResolvedValue({ rows: [], rowCount: 1 }); });

  it('sólo tema: no toca el idioma guardado', async () => {
    const res = makeRes();
    await updatePreferencias(reqCon({ tema: 'light' }), res);

    const [sql, params] = mockPool.query.mock.calls[0];
    // COALESCE deja intacta la columna cuyo parámetro llega nulo.
    expect(String(sql)).toContain('COALESCE');
    expect(params).toEqual([null, 'light', 'usr-1']);
    expect(res.json).toHaveBeenCalledWith({ message: 'Preferencias actualizadas' });
  });

  it('sólo idioma: no toca el tema guardado', async () => {
    await updatePreferencias(reqCon({ idioma: 'en' }), makeRes());
    expect(mockPool.query.mock.calls[0][1]).toEqual(['en', null, 'usr-1']);
  });

  it('los dos juntos siguen funcionando', async () => {
    await updatePreferencias(reqCon({ idioma: 'es', tema: 'dark' }), makeRes());
    expect(mockPool.query.mock.calls[0][1]).toEqual(['es', 'dark', 'usr-1']);
  });

  it('rechaza el cuerpo vacío sin tocar la base', async () => {
    const res = makeRes();
    await updatePreferencias(reqCon({}), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockPool.query).not.toHaveBeenCalled();
  });

  it('rechaza valores fuera del catálogo', async () => {
    const res1 = makeRes();
    await updatePreferencias(reqCon({ tema: 'fucsia' }), res1);
    expect(res1.status).toHaveBeenCalledWith(400);

    const res2 = makeRes();
    await updatePreferencias(reqCon({ idioma: 'fr' }), res2);
    expect(res2.status).toHaveBeenCalledWith(400);

    expect(mockPool.query).not.toHaveBeenCalled();
  });
});
