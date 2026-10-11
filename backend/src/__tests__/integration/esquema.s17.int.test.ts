/**
 * I-19 · Migración TIMESTAMP → TIMESTAMPTZ (S-17) probada sobre una copia con el esquema VIEJO — SCRUM-124 / SCRUM-177
 *
 * Componentes: database/init.sql (la sección «S-17» del final) → Postgres real. La prueba arma, en un esquema aparte de la base
 *   desechable (`s17_vieja`), el esquema ANTERIOR a la migración (todo init.sql hasta la sección S-17: columnas TIMESTAMP),
 *   le mete filas con horas de reloj conocidas y recién entonces corre la sección S-17, como lo hará un despliegue sobre una
 *   base que ya tiene datos. Nunca toca una base real: el guardia de base *_test sigue valiendo.
 * Resultado esperado:
 *   - ninguna columna del esquema queda en `timestamp without time zone`, ni en la base recién creada (`public`) ni en la copia;
 *   - los datos existentes conservan su instante: la hora de reloj de lo escrito por Postgres se lee como UTC y las dos
 *     columnas que escribió Node con hora de Guatemala (`refresh_tokens.expires_at`, `visitante_blacklist.fecha_fin`) como UTC−6;
 *     los NULL siguen NULL y los DEFAULT NOW() siguen en pie;
 *   - correr la migración otra vez no cambia nada (idempotente), también con los arranques que repiten el resto de init.sql;
 *   - si una columna no se puede convertir (una vista depende de ella) se avisa y las demás SÍ se convierten.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Client } from 'pg';
import { q, cerrarPool } from '../helpers/db';

const SQL = readFileSync(path.resolve(__dirname, '../../../../database/init.sql'), 'utf8');
const MARCA = '-- ── S-17 · TIMESTAMP → TIMESTAMPTZ';
const ESQUEMA = 's17_vieja';
const idx = SQL.indexOf(MARCA);
const ANTES_DE_S17 = SQL.slice(0, idx);
const SECCION_S17 = SQL.slice(idx);

let c: Client;
const avisos: string[] = [];

const una = async <T = any>(sql: string, params: unknown[] = []): Promise<T> => (await c.query(sql, params)).rows[0] as T;

const tipoDe = async (tabla: string, columna: string): Promise<string> =>
  (await una<{ t: string }>(
    `SELECT data_type AS t FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 AND column_name = $3`,
    [ESQUEMA, tabla, columna])).t;

/** El instante (en UTC, como texto) que devuelve una consulta de una sola columna. */
const instante = async (sql: string): Promise<string> =>
  (await una<{ t: string }>(`SELECT to_char((${sql}) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS t`)).t;

beforeAll(async () => {
  if (idx < 0) throw new Error('No encontré la sección S-17 en database/init.sql: la prueba parte el archivo por esa marca.');
  c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  c.on('notice', n => { if (n.severity === 'WARNING') avisos.push(n.message); });
  await c.query(`DROP SCHEMA IF EXISTS ${ESQUEMA} CASCADE; CREATE SCHEMA ${ESQUEMA};`);
  await c.query(`SET search_path TO ${ESQUEMA}, public`);

  // 1. El esquema anterior a la migración, con sus columnas TIMESTAMP.
  await c.query(ANTES_DE_S17);

  // 2. Datos con horas de reloj conocidas (lo que había en la base el día del despliegue).
  const emp = (await una<{ id: string }>(`INSERT INTO empresas (nombre, created_at) VALUES ('S17 Empresa', '2026-10-10 16:00:00') RETURNING id`)).id;
  const suc = (await una<{ id: string }>(`INSERT INTO sucursales (empresa_id, nombre, direccion, tipo) VALUES ($1, 'S17 Suc', 'dir', 'residencial') RETURNING id`, [emp])).id;
  const usr = (await una<{ id: string }>(
    `INSERT INTO usuarios (nombre, email, password_hash, rol, sucursal_id) VALUES ('S17', 's17@x.test', 'x', 'admin_sucursal', $1) RETURNING id`, [suc])).id;
  await c.query(`INSERT INTO audit_logs (usuario_id, accion, created_at) VALUES ($1, 'PRUEBA_S17', '2026-10-10 16:00:00')`, [usr]);
  await c.query(`INSERT INTO refresh_tokens (usuario_id, token_hash, expires_at, created_at) VALUES ($1, 's17-token', '2026-10-17 10:00:00', '2026-10-10 16:00:00')`, [usr]);
  const vis = (await una<{ id: string }>(`INSERT INTO visitantes (nombre, numero_dpi) VALUES ('Visita S17', 'S17-DPI') RETURNING id`)).id;
  await c.query(
    `INSERT INTO visitante_blacklist (visitante_id, sucursal_id, razon, fecha_inicio, fecha_fin, creado_por)
     VALUES ($1, $2, 'S17', '2026-10-10 12:00:00', '2026-10-20 12:00:00', $3)`, [vis, suc, usr]);
  await c.query(
    `INSERT INTO invitaciones (email, rol_invitado, empresa_id, token_hash, invitado_por, expira_en, created_at)
     VALUES ('s17-inv@x.test', 'admin_empresa', $1, 's17-inv', $2, '2026-10-12 08:00:00', '2026-10-10 08:00:00')`, [emp, usr]);
  await c.query(`INSERT INTO anuncios (sucursal_id, titulo, contenido, vigente_desde, vigente_hasta, creado_por)
                 VALUES ($1, 'S17', 'x', '2026-10-10 00:00:00', '2026-10-12 00:00:00', $2)`, [suc, usr]);
  const res = (await una<{ id: string }>(
    `INSERT INTO residentes (usuario_id, sucursal_id, numero_casa, fecha_ultimo_pago) VALUES ($1, $2, 'S17-1', '2026-09-30 15:30:00') RETURNING id`, [usr, suc])).id;
  await c.query(
    `INSERT INTO registros_acceso (sucursal_id, visitante_id, residente_id, agente_id, tipo, timestamp_entrada, timestamp_salida)
     VALUES ($1, $2, $3, $4, 'entrada', '2026-10-10 15:00:00', NULL)`, [suc, vis, res, usr]);
});

afterAll(async () => {
  await c.query(`SET search_path TO public`).catch(() => undefined);
  await c.query(`DROP SCHEMA IF EXISTS ${ESQUEMA} CASCADE`).catch(() => undefined);
  await c.end();
  await cerrarPool();
});

describe('I-19 antes de migrar: la copia tiene el esquema viejo', () => {
  it('las columnas son TIMESTAMP sin zona (si no, la prueba de abajo no prueba nada)', async () => {
    for (const [t, col] of [['audit_logs', 'created_at'], ['refresh_tokens', 'expires_at'], ['visitante_blacklist', 'fecha_fin'], ['invitaciones', 'expira_en']]) {
      expect([t, col, await tipoDe(t, col)]).toEqual([t, col, 'timestamp without time zone']);
    }
    const n = (await una<{ n: number }>(`SELECT count(*)::int AS n FROM information_schema.columns WHERE table_schema = $1 AND data_type = 'timestamp without time zone'`, [ESQUEMA])).n;
    expect(n).toBeGreaterThan(40);
  });
});

describe('I-19 la migración sobre datos existentes', () => {
  beforeAll(async () => { await c.query(SECCION_S17); });

  it('no queda ninguna columna sin zona en la copia', async () => {
    const sobran = await c.query(
      `SELECT table_name || '.' || column_name AS col FROM information_schema.columns
        WHERE table_schema = $1 AND data_type = 'timestamp without time zone'`, [ESQUEMA]);
    expect(sobran.rows).toEqual([]);
    expect(avisos.filter(a => a.includes('S-17'))).toEqual([]);                 // y sin avisos de columnas que no se pudieron convertir
  });

  it('lo que escribió Postgres (NOW()) se lee como UTC: la hora de reloj pasa a ser ese mismo instante', async () => {
    expect(await instante(`SELECT created_at FROM audit_logs WHERE accion = 'PRUEBA_S17'`)).toBe('2026-10-10T16:00:00Z');
    expect(await instante(`SELECT created_at FROM refresh_tokens WHERE token_hash = 's17-token'`)).toBe('2026-10-10T16:00:00Z');
    expect(await instante(`SELECT expira_en FROM invitaciones WHERE email = 's17-inv@x.test'`)).toBe('2026-10-12T08:00:00Z');
    expect(await instante(`SELECT fecha_inicio FROM visitante_blacklist WHERE razon = 'S17'`)).toBe('2026-10-10T12:00:00Z');
    expect(await instante(`SELECT vigente_desde FROM anuncios WHERE titulo = 'S17'`)).toBe('2026-10-10T00:00:00Z');
    expect(await instante(`SELECT vigente_hasta FROM anuncios WHERE titulo = 'S17'`)).toBe('2026-10-12T00:00:00Z');
    expect(await instante(`SELECT fecha_ultimo_pago FROM residentes WHERE numero_casa = 'S17-1'`)).toBe('2026-09-30T15:30:00Z');
    expect(await instante(`SELECT timestamp_entrada FROM registros_acceso LIMIT 1`)).toBe('2026-10-10T15:00:00Z');
    expect(await instante(`SELECT created_at FROM empresas WHERE nombre = 'S17 Empresa'`)).toBe('2026-10-10T16:00:00Z');
  });

  it('lo que escribió Node con hora de Guatemala (token de refresco y fin del bloqueo) se lee como UTC−6: ya dura lo que debía', async () => {
    // 10:00 de Guatemala = 16:00 UTC: el token vence a los 7 d EXACTOS de haberse creado (10 oct 16:00Z → 17 oct 16:00Z).
    expect(await instante(`SELECT expires_at FROM refresh_tokens WHERE token_hash = 's17-token'`)).toBe('2026-10-17T16:00:00Z');
    const dias = (await una<{ d: string }>(
      `SELECT EXTRACT(EPOCH FROM (expires_at - created_at)) / 86400 AS d FROM refresh_tokens WHERE token_hash = 's17-token'`)).d;
    expect(Number(dias)).toBe(7);
    expect(await instante(`SELECT fecha_fin FROM visitante_blacklist WHERE razon = 'S17'`)).toBe('2026-10-20T18:00:00Z');
  });

  it('los NULL siguen NULL y las columnas pasan a `timestamp with time zone`', async () => {
    expect((await una(`SELECT timestamp_salida FROM registros_acceso LIMIT 1`)).timestamp_salida).toBeNull();
    for (const [t, col] of [['audit_logs', 'created_at'], ['refresh_tokens', 'expires_at'], ['registros_acceso', 'timestamp_salida'], ['invitaciones', 'aceptada_en']]) {
      expect([t, col, await tipoDe(t, col)]).toEqual([t, col, 'timestamp with time zone']);
    }
  });

  it('los DEFAULT NOW() siguen funcionando: una fila nueva queda con el instante actual', async () => {
    const f = await una<{ ok: boolean }>(
      `INSERT INTO audit_logs (accion) VALUES ('S17_DEFAULT') RETURNING (created_at BETWEEN NOW() - interval '1 minute' AND NOW() + interval '1 minute') AS ok`);
    expect(f.ok).toBe(true);
    const d = (await una<{ d: string }>(
      `SELECT column_default AS d FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'audit_logs' AND column_name = 'created_at'`, [ESQUEMA])).d;
    expect(d).toMatch(/now\(\)/i);
  });

  it('un `Date` de Node ya viaja con su zona: se guarda y se compara bien sin ninguna conversión', async () => {
    const ahoraMasSieteDias = new Date(Date.now() + 7 * 24 * 3600_000);
    await c.query(
      `INSERT INTO refresh_tokens (usuario_id, token_hash, expires_at) SELECT id, 's17-nuevo', $1 FROM usuarios WHERE email = 's17@x.test'`, [ahoraMasSieteDias]);
    const f = await una<{ d: string }>(`SELECT EXTRACT(EPOCH FROM (expires_at - NOW())) / 86400 AS d FROM refresh_tokens WHERE token_hash = 's17-nuevo'`);
    expect(Number(f.d)).toBeGreaterThan(6.999);                                 // con TIMESTAMP eran 6.75 (6 d 18 h)
    expect(Number(f.d)).toBeLessThan(7.001);
  });

  it('es idempotente: volver a correr la sección, y el resto de init.sql, no cambia nada', async () => {
    const antes = await instante(`SELECT expires_at FROM refresh_tokens WHERE token_hash = 's17-token'`);
    const fin = await instante(`SELECT fecha_fin FROM visitante_blacklist WHERE razon = 'S17'`);
    await c.query(SECCION_S17);
    await c.query(SQL);                                                           // un arranque completo más: lo viejo (guardado) y lo nuevo
    expect(await instante(`SELECT expires_at FROM refresh_tokens WHERE token_hash = 's17-token'`)).toBe(antes);
    expect(await instante(`SELECT fecha_fin FROM visitante_blacklist WHERE razon = 'S17'`)).toBe(fin);
    expect(await tipoDe('visitante_blacklist', 'fecha_fin')).toBe('timestamp with time zone');   // y no se deshizo (el ALTER viejo estaba sin guarda)
    expect(await tipoDe('visitante_blacklist', 'fecha_inicio')).toBe('timestamp with time zone');
  });
});

describe('I-19 si una columna no se puede convertir, las demás sí', () => {
  it('una vista que depende de la columna la deja como estaba, avisa, y el resto del esquema se migra', async () => {
    // Esquema nuevo y aparte, otra vez viejo; con una vista que impide alterar `audit_logs.created_at`.
    await c.query(`DROP SCHEMA IF EXISTS ${ESQUEMA} CASCADE; CREATE SCHEMA ${ESQUEMA}; SET search_path TO ${ESQUEMA}, public;`);
    await c.query(ANTES_DE_S17);
    await c.query(`CREATE VIEW vista_s17 AS SELECT id, created_at FROM audit_logs`);
    avisos.length = 0;

    await c.query(SECCION_S17);                                                  // no lanza: el error de esa columna queda contenido

    expect(await tipoDe('audit_logs', 'created_at')).toBe('timestamp without time zone');       // la bloqueada sigue igual
    expect(await tipoDe('refresh_tokens', 'expires_at')).toBe('timestamp with time zone');      // las demás se convirtieron
    expect(await tipoDe('invitaciones', 'expira_en')).toBe('timestamp with time zone');
    expect(avisos.some(a => a.includes('S-17') && a.includes('audit_logs.created_at'))).toBe(true);
    const sobran = (await c.query(
      `SELECT table_name || '.' || column_name AS col FROM information_schema.columns
        WHERE table_schema = $1 AND data_type = 'timestamp without time zone' AND table_name <> 'vista_s17'`, [ESQUEMA])).rows;   // la vista también aparece en information_schema.columns
    expect(sobran.map(r => r.col)).toEqual(['audit_logs.created_at']);

    // Y la base real (public) no se tocó: sigue sin columnas sin zona.
    const publico = await q(`SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND data_type = 'timestamp without time zone'`);
    expect(publico).toHaveLength(0);
  });
});

describe('I-19 la base recién creada (esquema público de las pruebas)', () => {
  it('init.sql completo deja TODAS las columnas de fecha y hora con zona', async () => {
    const sobran = await q(
      `SELECT table_name || '.' || column_name AS col FROM information_schema.columns
        WHERE table_schema = 'public' AND data_type = 'timestamp without time zone'`);
    expect(sobran).toEqual([]);
    const con = await q(`SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND data_type = 'timestamp with time zone'`);
    expect(con.length).toBeGreaterThan(50);
  });
});
