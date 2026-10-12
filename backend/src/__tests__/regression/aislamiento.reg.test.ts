/**
 * R-1 · Regresión de aislamiento multi-tenant (hallazgos S-04 y S-05 de securitytest)
 *
 * Componentes: Express (app.ts) → /api/reservas/disponibilidad
 *   (reservas.controller → ownershipClause) y /api/anuncios/:id/leer
 *   (anuncios.controller, filtro por sucursal) → Postgres real.
 * Condición: dos empresas (A con A1/A2, B con B1). Personal y residentes de A
 *   piden un área y un anuncio que pertenecen a B.
 * Datos: seed (áreas A1/A2/B1, anuncios A1/B1, residentes). Controles positivos:
 *   cada quien SÍ accede a lo de su alcance.
 * Resultado esperado:
 *   - disponibilidad de un área de B: admin_empresa A, admin_sucursal A1 y agente A1 → 403.
 *   - controles: esos mismos roles sobre áreas de su alcance → 200; owner y admin de B → 200.
 *   - un residente de A que marca leído un anuncio de B → 404 y SIN fila en anuncio_lecturas;
 *     marcar el propio anuncio sí funciona (200) y deja su fila.
 */
import request from 'supertest';
import app from '../../app';
import { q, cerrarPool } from '../helpers/db';
import { sembrar, Fixtures } from '../helpers/seed';
import { login, bearer } from '../helpers/auth';

let fx: Fixtures;
const tokens: Record<string, string> = {};
const fecha = new Date(Date.now() + 24 * 3600 * 1000).toISOString().slice(0, 10);

beforeAll(async () => {
  fx = await sembrar();
  for (const k of ['owner', 'adminEmpA', 'adminSucA1', 'agenteA1', 'adminEmpB', 'resA1']) {
    const s = await login(app, fx.email[k]);
    expect(s.status).toBe(200);
    tokens[k] = s.token!;
  }
});
afterAll(cerrarPool);

const disponibilidad = (token: string, area: string) =>
  request(app).get('/api/reservas/disponibilidad').query({ area_id: area, fecha }).set(bearer(token));

describe('R-1 aislamiento multi-tenant', () => {
  describe.each(['adminEmpA', 'adminSucA1', 'agenteA1'])('disponibilidad con %s', (rol) => {
    it('el área de otra empresa (B1) → 403', async () => {
      const r = await disponibilidad(tokens[rol], fx.areas.B1);
      expect(r.status).toBe(403);
    });
    it('control positivo: un área de su alcance → 200', async () => {
      const r = await disponibilidad(tokens[rol], fx.areas.A1);
      expect(r.status).toBe(200);
    });
  });

  it('control positivo: admin_empresa A ve también A2; owner y admin de B ven B1', async () => {
    expect((await disponibilidad(tokens.adminEmpA, fx.areas.A2)).status).toBe(200);
    expect((await disponibilidad(tokens.owner, fx.areas.B1)).status).toBe(200);
    expect((await disponibilidad(tokens.adminEmpB, fx.areas.B1)).status).toBe(200);
  });

  it('admin_sucursal A1 no ve el área de la otra sucursal de su empresa (A2)', async () => {
    expect((await disponibilidad(tokens.adminSucA1, fx.areas.A2)).status).toBe(403);
  });

  it('residente de A marca leído un anuncio de B → 404 y sin fila en anuncio_lecturas', async () => {
    const r = await request(app).post(`/api/anuncios/${fx.anuncios.B1}/leer`).set(bearer(tokens.resA1));
    expect(r.status).toBe(404);
    const filas = await q('SELECT 1 FROM anuncio_lecturas WHERE anuncio_id = $1', [fx.anuncios.B1]);
    expect(filas).toHaveLength(0);
  });

  it('control positivo: el residente marca leído su propio anuncio → 200 y queda la fila', async () => {
    const r = await request(app).post(`/api/anuncios/${fx.anuncios.A1}/leer`).set(bearer(tokens.resA1));
    expect(r.status).toBe(200);
    const filas = await q('SELECT residente_id FROM anuncio_lecturas WHERE anuncio_id = $1', [fx.anuncios.A1]);
    expect(filas).toHaveLength(1);
    expect(filas[0].residente_id).toBe(fx.residentes.A1);
  });
});
