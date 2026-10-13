/**
 * I-27b · El tope de exportaciones es por persona y los bloqueos quedan auditados — T12.
 * Condición: el tope se baja por variable de entorno ANTES de cargar la app.
 */
process.env.RATE_LIMIT_EXPORTAR_MAX = '2';

import request from 'supertest';
import app from '../../app';
import { q, cerrarPool } from '../helpers/db';
import { sembrar, Fixtures } from '../helpers/seed';
import { login, bearer } from '../helpers/auth';
import { comoBuffer } from '../helpers/leerZip';

let fx: Fixtures;
afterAll(cerrarPool);
beforeAll(async () => { fx = await sembrar(); });

it('la 3.ª exportación en una hora responde 429 (con la acción y el usuario en la auditoría); otra persona no se ve afectada', async () => {
  const a = (await login(app, fx.email.adminEmpA)).token!;
  const b = (await login(app, fx.email.adminEmpB)).token!;
  const bajar = (t: string, e: string) => request(app).get(`/api/empresas/${e}/exportar`).set(bearer(t)).buffer(true).parse(comoBuffer);
  expect((await bajar(a, fx.empresas.A)).status).toBe(200);
  expect((await bajar(a, fx.empresas.A)).status).toBe(200);
  expect((await bajar(a, fx.empresas.A)).status).toBe(429);
  expect((await bajar(b, fx.empresas.B)).status).toBe(200);

  const limite = Date.now() + 3000;
  let filas: any[] = [];
  do {
    filas = await q(`SELECT 1 FROM audit_logs WHERE accion = 'DATOS_EMPRESA_EXPORTADOS' AND status_code = 429 AND usuario_id = $1`, [fx.usuarios.adminEmpA]);
    if (filas.length) break;
    await new Promise(r => setTimeout(r, 50));
  } while (Date.now() < limite);
  expect(filas.length).toBeGreaterThanOrEqual(1);
});
