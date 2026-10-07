/**
 * R-2 · Regresión de vigencia de invitaciones (hallazgo S-02 de securitytest; causa raíz S-17 resuelta en SCRUM-124)
 *
 * Componentes: Express (app.ts) → /api/invitaciones/:token y /:token/aceptar →
 *   invitaciones.controller (vencida = expira_en <= NOW(), calculada por Postgres) →
 *   Postgres real (tablas invitaciones y usuarios).
 * Historia de la causa raíz: `expira_en` era un TIMESTAMP sin zona escrito con NOW() en UTC mientras el backend corre con
 *   TZ=America/Guatemala; `pg` lo leía como hora local, 6 h en el futuro, y una comparación hecha en Node aceptaba invitaciones
 *   vencidas. Desde S-17 la columna es TIMESTAMPTZ (el instante, sin interpretación) y Node la lee bien; la decisión sigue
 *   tomándola Postgres (`vencida`). Lo que reproduce la regresión AHORA es otra cosa: que una invitación vencida no se acepte,
 *   y que la columna no vuelva a ser un TIMESTAMP que Node lea corrida (la prueba «Node lee expira_en en el pasado»).
 *   El entorno (Node en UTC−6, Postgres en UTC) se sigue verificando: sin él, la prueba nueva pasaría en vacío.
 * Datos: dos invitaciones creadas por la API; a una se le fuerza por SQL
 *   expira_en = NOW() - 1 minuto; la otra queda vigente.
 * Resultado esperado:
 *   - entorno: Node con offset -6 (America/Guatemala) y Postgres en UTC; si no, la prueba
 *     falla con un mensaje claro en vez de pasar en vacío.
 *   - vencida: GET → 410, aceptar → 410 y NO se crea usuario.
 *   - Node lee esa misma columna como un instante PASADO (no 6 h en el futuro).
 *   - vigente (control positivo): GET → 200 y aceptar → 200.
 */
import request from 'supertest';
import app from '../../app';
import { q, uno, cerrarPool } from '../helpers/db';
import { sembrar, Fixtures } from '../helpers/seed';
import { login, bearer, PASSWORD } from '../helpers/auth';

let fx: Fixtures;
let admin: string;

const crear = async (prefijo: string) => {
  const correo = `${prefijo}.${fx.sufijo}@inttest.local`;
  const r = await request(app).post('/api/invitaciones').set(bearer(admin))
    .send({ email: correo, rol_invitado: 'admin_sucursal', sucursal_id: fx.sucursales.A2 });
  expect(r.status).toBe(201);
  return { correo, token: (r.body.enlace as string).split('/invitacion/')[1] };
};

beforeAll(async () => {
  // Comprobación de entorno: sin ella la prueba podría pasar sin ejercitar el bug de zonas horarias.
  const offset = new Date().getTimezoneOffset();
  if (offset !== 360) {
    throw new Error(
      `[R-2] El proceso de Node no está en America/Guatemala (offset de zona = ${offset} min, se esperaba 360 = UTC-6; ` +
      `TZ="${process.env.TZ ?? ''}"). Ejecuta con TZ=America/Guatemala (npm run test:regression ya lo fija).`);
  }
  const tz = (await uno<{ tz: string }>(`SELECT current_setting('TimeZone') AS tz`))!.tz;
  if (!/^(Etc\/)?UTC$/.test(tz)) {
    throw new Error(`[R-2] Postgres debe estar en UTC y está en "${tz}". Usa la imagen postgres:15 sin TimeZone personalizado.`);
  }
  fx = await sembrar();
  admin = (await login(app, fx.email.adminEmpA)).token!;
});
afterAll(cerrarPool);

describe('R-2 vigencia de invitaciones', () => {
  it('entorno: Node en America/Guatemala (-6) y Postgres en UTC', async () => {
    expect(new Date().getTimezoneOffset()).toBe(360);
    expect((await uno(`SELECT current_setting('TimeZone') AS tz`))!.tz).toMatch(/UTC/);
  });

  it('invitación vencida hace 1 minuto → GET 410, aceptar 410 y no se crea el usuario', async () => {
    const inv = await crear('vencida');
    await q(`UPDATE invitaciones SET expira_en = NOW() - interval '1 minute' WHERE email = $1`, [inv.correo]);

    const consulta = await request(app).get(`/api/invitaciones/${inv.token}`);
    expect(consulta.status).toBe(410);

    const acepta = await request(app).post(`/api/invitaciones/${inv.token}/aceptar`)
      .send({ nombre: 'Persona Tardía', password: PASSWORD });
    expect(acepta.status).toBe(410);

    const n = await q('SELECT count(*)::int AS n FROM usuarios WHERE email = $1', [inv.correo]);
    expect(n[0].n).toBe(0);
  });

  it('Node lee expira_en en el pasado: la columna es TIMESTAMPTZ y no llega 6 h corrida (causa raíz de S-02, S-17)', async () => {
    const inv = await crear('instante');
    await q(`UPDATE invitaciones SET expira_en = NOW() - interval '1 minute' WHERE email = $1`, [inv.correo]);
    const fila = await uno<{ expira_en: Date }>('SELECT expira_en FROM invitaciones WHERE email = $1', [inv.correo]);
    const hace = Date.now() - fila!.expira_en.getTime();
    // Con TIMESTAMP, `pg` lo leía 6 h en el futuro (hace ≈ −6 h): una comparación en Node la habría dado por vigente.
    expect(hace).toBeGreaterThan(30_000);
    expect(hace).toBeLessThan(5 * 60_000);
    const tipo = await uno<{ data_type: string }>(
      `SELECT data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'invitaciones' AND column_name = 'expira_en'`);
    expect(tipo!.data_type).toBe('timestamp with time zone');
  });

  it('control positivo: invitación vigente → GET 200 y aceptar 200', async () => {
    const inv = await crear('vigente');
    expect((await request(app).get(`/api/invitaciones/${inv.token}`)).status).toBe(200);
    const acepta = await request(app).post(`/api/invitaciones/${inv.token}/aceptar`)
      .send({ nombre: 'Persona A Tiempo', password: PASSWORD });
    expect(acepta.status).toBe(200);
    const n = await q('SELECT count(*)::int AS n FROM usuarios WHERE email = $1', [inv.correo]);
    expect(n[0].n).toBe(1);
  });
});
