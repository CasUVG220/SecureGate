/**
 * I-3 · Garita offline: licencia, acceso idempotente y sincronización (integración)
 *
 * Componentes: Express (app.ts) → /api/licencias/activar, /api/auth/login,
 *   /api/accesos (verifyToken + licenciaOpcional), /api/sync/garita (verifyToken +
 *   verifyLicencia) → Postgres real (licencias_dispositivo, registros_acceso,
 *   residentes). supertest, sin mocks.
 * Condición: licencia sembrada sin activar para la sucursal A1; agente de A1.
 *   La app de escritorio activa la licencia, inicia sesión y envía accesos de su
 *   cola offline con id_cliente (UUID) y un registrado_en del pasado.
 * Datos: seed (A1/B1, licencias INT-A1/B1, residente A1), DPI y UUID únicos.
 * Resultado esperado:
 *   - activar → 200 con token_licencia.
 *   - POST /api/accesos con X-Licencia-Token + id_cliente → 201, origen 'desktop'.
 *   - el reenvío del mismo id_cliente → 200 duplicado:true y UNA sola fila en BD.
 *   - recibido_en lo pone el servidor (≈ ahora) aunque el cliente mande registrado_en pasado.
 *   - un JWT de usuario usado como licencia → 403; sin licencia el snapshot → 401 (el
 *     middleware responde 401 "Token de licencia no proporcionado").
 *   - GET /api/sync/garita con ambos tokens trae el padrón de A1 y NO el de B1; una
 *     licencia de otra sucursal con la sesión del agente de A1 → 403.
 */
import request from 'supertest';
import { randomUUID } from 'crypto';
import app from '../../app';
import { q, uno, cerrarPool } from '../helpers/db';
import { sembrar, Fixtures } from '../helpers/seed';
import { login, bearer } from '../helpers/auth';

let fx: Fixtures;
let licA1: string;
let licB1: string;
let agente: string;

const activar = async (l: Fixtures['licencias']['A1']) => {
  const r = await request(app).post('/api/licencias/activar')
    .send({ codigo: l.codigo, fingerprint: l.fingerprint, nombre_dispositivo: 'INT-pc' });
  return r;
};

beforeAll(async () => {
  fx = await sembrar();
  const a = await activar(fx.licencias.A1);
  expect(a.status).toBe(200);
  licA1 = a.body.token_licencia;
  const b = await activar(fx.licencias.B1);
  expect(b.status).toBe(200);
  licB1 = b.body.token_licencia;
  agente = (await login(app, fx.email.agenteA1)).token!;
});
afterAll(cerrarPool);

describe('I-3 garita offline', () => {
  const idCliente = randomUUID();
  const dpi = `INT-DPI-${randomUUID().slice(0, 8)}`;
  const haceUnaHora = new Date(Date.now() - 60 * 60 * 1000).toISOString();

  const enviar = (extra: Record<string, unknown> = {}) =>
    request(app).post('/api/accesos').set(bearer(agente)).set('X-Licencia-Token', licA1).send({
      nombre_visitante: 'Visitante Integración', numero_dpi: dpi, residente_id: fx.residentes.A1,
      id_cliente: idCliente, registrado_en: haceUnaHora, ...extra,
    });

  it('activar guardó la huella y dejó la licencia ligada al dispositivo', async () => {
    const f = await uno('SELECT fingerprint, activado_en FROM licencias_dispositivo WHERE id = $1', [fx.licencias.A1.id]);
    expect(f.fingerprint).toBe(fx.licencias.A1.fingerprint);
    expect(f.activado_en).not.toBeNull();
  });

  it('el primer envío crea el acceso y el reenvío del mismo id_cliente no duplica', async () => {
    const primero = await enviar();
    expect(primero.status).toBe(201);

    const reenvio = await enviar();
    expect(reenvio.status).toBe(200);
    expect(reenvio.body.duplicado).toBe(true);

    const filas = await q('SELECT origen, licencia_id, sucursal_id FROM registros_acceso WHERE id_cliente = $1', [idCliente]);
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({ origen: 'desktop', licencia_id: fx.licencias.A1.id, sucursal_id: fx.sucursales.A1 });
  });

  it('T5: el origen del DPI (local / remoto / manual) se guarda; un valor raro se ignora; manual sin origen cuenta como manual', async () => {
    const registrar = async (extra: Record<string, unknown>) => {
      const id = randomUUID();
      const r = await request(app).post('/api/accesos').set(bearer(agente)).set('X-Licencia-Token', licA1).send({
        nombre_visitante: 'Visitante Origen', numero_dpi: `INT-DPI-${randomUUID().slice(0, 8)}`, residente_id: fx.residentes.A1,
        id_cliente: id, ...extra,
      });
      expect(r.status).toBe(201);
      return (await uno('SELECT origen_dpi, capturado_manualmente FROM registros_acceso WHERE id_cliente = $1', [id]));
    };
    expect(await registrar({ origen_dpi: 'local', capturado_manualmente: false })).toMatchObject({ origen_dpi: 'local', capturado_manualmente: false });
    expect(await registrar({ origen_dpi: 'remoto', capturado_manualmente: false })).toMatchObject({ origen_dpi: 'remoto' });
    expect(await registrar({ origen_dpi: 'manual', capturado_manualmente: true })).toMatchObject({ origen_dpi: 'manual', capturado_manualmente: true });
    expect(await registrar({ origen_dpi: 'drop table', capturado_manualmente: false })).toMatchObject({ origen_dpi: null });
    expect(await registrar({ capturado_manualmente: true })).toMatchObject({ origen_dpi: 'manual' });
    expect(await registrar({})).toMatchObject({ origen_dpi: null });
  });

  it('recibido_en lo sella el servidor aunque el cliente mande un registrado_en pasado', async () => {
    const f = await uno(
      `SELECT (recibido_en >= NOW() - interval '2 minutes' AND recibido_en <= NOW() + interval '1 minute') AS recibido_ahora,
              (registrado_en <= recibido_en - interval '30 minutes')                                       AS cliente_en_el_pasado
         FROM registros_acceso WHERE id_cliente = $1`, [idCliente]);
    expect(f.recibido_ahora).toBe(true);
    expect(f.cliente_en_el_pasado).toBe(true);
  });

  it('un JWT de usuario usado como licencia da 403 y sin licencia el snapshot da 401', async () => {
    const comoLicencia = await request(app).post('/api/accesos').set(bearer(agente)).set('X-Licencia-Token', agente).send({
      nombre_visitante: 'X', numero_dpi: `INT-DPI-${randomUUID().slice(0, 8)}`, residente_id: fx.residentes.A1,
    });
    expect(comoLicencia.status).toBe(403);

    const sinLicencia = await request(app).get('/api/sync/garita').set(bearer(agente));
    expect(sinLicencia.status).toBe(401);
    const userComoLicencia = await request(app).get('/api/sync/garita').set(bearer(agente)).set('X-Licencia-Token', agente);
    expect(userComoLicencia.status).toBe(403);
  });

  it('GET /api/sync/garita trae el padrón de su sucursal y no el de otra', async () => {
    const r = await request(app).get('/api/sync/garita').set(bearer(agente)).set('X-Licencia-Token', licA1);
    expect(r.status).toBe(200);
    expect(r.body.sucursal_id).toBe(fx.sucursales.A1);
    const casas: string[] = r.body.residentes.map((x: { numero_casa: string }) => x.numero_casa);
    expect(casas).toContain(`INT-A1-${fx.sufijo}`);
    expect(casas).not.toContain(`INT-B1-${fx.sufijo}`);
    expect(casas).not.toContain(`INT-A2-${fx.sufijo}`);

    // La licencia de otra sucursal con la sesión del agente de A1 no sirve.
    const cruzada = await request(app).get('/api/sync/garita').set(bearer(agente)).set('X-Licencia-Token', licB1);
    expect(cruzada.status).toBe(403);
  });
});
