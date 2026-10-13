/**
 * I-25b · El cupo de la facturación a mano es por usuario y los bloqueos quedan auditados — T11
 * Condición: el tope se baja por variable de entorno ANTES de cargar la app.
 */
process.env.RATE_LIMIT_FACTURACION_MAX = '3';

import request from 'supertest';
import app from '../../app';
import { q, cerrarPool } from '../helpers/db';
import { sembrar, Fixtures } from '../helpers/seed';
import { login, bearer } from '../helpers/auth';

let fx: Fixtures;
let owner: string;
beforeAll(async () => { fx = await sembrar(); owner = (await login(app, fx.email.owner)).token!; });
afterAll(cerrarPool);

describe('I-25b límite de tasa de la facturación manual', () => {
  it('al 4.º intento responde 429, auditado con la acción y el usuario; revisar vencidas tiene su propio cupo', async () => {
    const generar = () => request(app).post('/api/facturas-saas/generar').set(bearer(owner)).send({ mes: '2020-01' });
    for (let i = 0; i < 3; i++) expect((await generar()).status).toBe(200);
    const bloqueado = await generar();
    expect(bloqueado.status).toBe(429);

    const limite = Date.now() + 3000;
    let filas: any[] = [];
    do {
      filas = await q(`SELECT usuario_id, status_code, datos_nuevos FROM audit_logs WHERE accion = 'FACTURAS_SAAS_GENERADAS' AND status_code = 429 AND usuario_id = $1`, [fx.usuarios.owner]);
      if (filas.length) break;
      await new Promise(r => setTimeout(r, 50));
    } while (Date.now() < limite);
    expect(filas.length).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(filas[0].datos_nuevos)).toContain('facturacion-generar-usuario');

    expect((await request(app).post('/api/facturas-saas/revisar-vencidas').set(bearer(owner)).send({})).status).toBe(200);
  });
});
