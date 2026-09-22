/**
 * ── Hallazgos S-04 y S-05 (backend/securitytest, Sprint 8) ───────────────────
 * Las pruebas IDOR (01-idor.js) con el token de la empresa A encontraron dos
 * accesos cruzados que los guards de rol no cubren porque el usuario SÍ tiene
 * el rol correcto; falta el filtro de tenant en el controlador:
 *
 *  S-04  GET /reservas/disponibilidad: cualquier personal leía nombre, tarifa y
 *        horarios ocupados de un área de OTRA empresa.
 *  S-05  POST /anuncios/:id/leer: un residente insertaba una lectura sobre el
 *        anuncio de otra empresa (inflaba su contador y confirmaba que existía).
 */
jest.mock('../db/pool', () => ({ __esModule: true, default: { query: jest.fn(), connect: jest.fn() } }));

import pool from '../db/pool';
import { getDisponibilidad } from '../controllers/reservas.controller';
import { marcarLeido } from '../controllers/anuncios.controller';

const mockPool = pool as unknown as { query: jest.Mock };
const res = () => { const r: any = {}; r.status = jest.fn().mockReturnValue(r); r.json = jest.fn().mockReturnValue(r); return r; };
const AREA = { id: 'area-B', sucursal_id: 'suc-B', nombre: 'Salón B', activa: true, tarifa_tipo: 'gratis', tarifa_monto: '0.00', requiere_aprobacion: null };

beforeEach(() => mockPool.query.mockReset());

describe('S-04 · reservas/disponibilidad respeta el alcance del personal', () => {
  const peticion = (user: any) => ({ query: { area_id: 'area-B', fecha: '2030-01-01' }, user } as any);

  it('un agente de OTRA sucursal recibe 403 y no se consulta el calendario', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [AREA] })   // el área existe
      .mockResolvedValueOnce({ rows: [] });      // ...pero no está en su alcance
    const r = res();
    await getDisponibilidad(peticion({ id: 'u', rol: 'agente', sucursal_id: 'suc-A', empresa_id: 'emp-A' }), r);
    expect(r.status).toHaveBeenCalledWith(403);
    expect(mockPool.query).toHaveBeenCalledTimes(2);            // ni config ni reservas
    expect(mockPool.query.mock.calls[1][0]).toMatch(/sucursales _os/); // ownershipClause
    expect(mockPool.query.mock.calls[1][1]).toEqual(['area-B', 'agente', 'emp-A', 'suc-A']);
  });

  it('un admin de empresa ajena también recibe 403', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [AREA] }).mockResolvedValueOnce({ rows: [] });
    const r = res();
    await getDisponibilidad(peticion({ id: 'u', rol: 'admin_empresa', sucursal_id: null, empresa_id: 'emp-A' }), r);
    expect(r.status).toHaveBeenCalledWith(403);
  });

  it('personal DENTRO de su alcance sí obtiene la disponibilidad', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [AREA] })
      .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] })   // en alcance
      .mockResolvedValueOnce({ rows: [] })                    // configuracion_reservas → defaults
      .mockResolvedValueOnce({ rows: [] });                   // ocupados
    const r = res();
    await getDisponibilidad(peticion({ id: 'u', rol: 'admin_sucursal', sucursal_id: 'suc-B', empresa_id: 'emp-B' }), r);
    expect(r.status).not.toHaveBeenCalled();
    expect(r.json.mock.calls[0][0].area.nombre).toBe('Salón B');
  });
});

describe('S-05 · anuncios/:id/leer sólo sobre anuncios visibles para el residente', () => {
  const peticion = { params: { id: 'anuncio-B' }, user: { id: 'usr-A', rol: 'residente' } } as any;

  it('anuncio de OTRA sucursal → 404 y ninguna lectura insertada', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ id: 'res-A', sucursal_id: 'suc-A' }] })
      .mockResolvedValueOnce({ rows: [] })    // INSERT ... SELECT no encuentra el anuncio en su alcance
      .mockResolvedValueOnce({ rows: [] });   // tampoco es visible
    const r = res();
    await marcarLeido(peticion, r);
    expect(r.status).toHaveBeenCalledWith(404);
    const insert = mockPool.query.mock.calls[1];
    expect(insert[0]).toMatch(/a\.sucursal_id = \$3/);
    expect(insert[1]).toEqual(['anuncio-B', 'res-A', 'suc-A']);
  });

  it('anuncio propio → 200 leido', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ id: 'res-A', sucursal_id: 'suc-A' }] })
      .mockResolvedValueOnce({ rows: [{ anuncio_id: 'anuncio-B' }] });
    const r = res();
    await marcarLeido(peticion, r);
    expect(r.json).toHaveBeenCalledWith({ anuncio_id: 'anuncio-B', leido: true });
  });

  it('anuncio propio ya leído (ON CONFLICT no inserta) sigue respondiendo 200', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ id: 'res-A', sucursal_id: 'suc-A' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });  // es visible: ya estaba leído
    const r = res();
    await marcarLeido(peticion, r);
    expect(r.json).toHaveBeenCalledWith({ anuncio_id: 'anuncio-B', leido: true });
    expect(r.status).not.toHaveBeenCalled();
  });
});
