/**
 * I-17 · Invitaciones QR sin red: espejo de la garita y descuento de usos al sincronizar — SCRUM-126 (SCRUM-181 y SCRUM-183)
 *
 * Componentes: Express (app.ts) → GET /api/sync/garita (verifyToken + verifyLicencia) y POST /api/accesos (cola offline de la
 *   app de escritorio) → Postgres real (invitaciones_qr, registros_acceso). supertest, sin mocks.
 * Condición: licencia activada de la sucursal A1 (y la de B1), agente de A1 (y de B1) e invitaciones sembradas por SQL con las
 *   fechas y los estados que cada caso necesita.
 * Resultado esperado:
 *   - el snapshot trae las invitaciones de SU sucursal (no las de otra) con lo necesario para validarlas sin red: vigentes,
 *     futuras, agotadas y revocadas del último mes, con fechas como texto AAAA-MM-DD; deja fuera las vencidas de antes y las
 *     revocadas viejas;
 *   - un uso que llega de la cola offline (invitacion_qr_id + id_cliente) descuenta UNA vez: el reenvío y la carrera entre dos
 *     reintentos no duplican; una invitación de un solo uso no sirve dos veces;
 *   - la vigencia por FECHAS se mide al día en que entró la persona (registrado_en), no al día en que se sincroniza; el estado
 *     (revocada, agotada) se mide al sincronizar: una invitación revocada mientras la garita estaba sin red se rechaza al subir,
 *     sin descontar ni registrar;
 *   - una invitación de otra sucursal no se puede gastar con la licencia de esta.
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
let agenteA1: string;
let agenteB1: string;

beforeAll(async () => {
  fx = await sembrar();
  const activar = async (l: Fixtures['licencias']['A1']) => {
    const r = await request(app).post('/api/licencias/activar').send({ codigo: l.codigo, fingerprint: l.fingerprint, nombre_dispositivo: 'INT-pc' });
    expect(r.status).toBe(200);
    return r.body.token_licencia as string;
  };
  licA1 = await activar(fx.licencias.A1);
  licB1 = await activar(fx.licencias.B1);
  agenteA1 = (await login(app, fx.email.agenteA1)).token!;
  agenteB1 = (await login(app, fx.email.agenteB1)).token!;
});
afterAll(cerrarPool);

// ── ayudantes ───────────────────────────────────────────────────────────────────────────────────
/** Día de calendario de Guatemala (AAAA-MM-DD), `n` días desde hoy. */
const diaGt = (n = 0): string => {
  const t = Date.now() + n * 86_400_000;
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Guatemala' }).format(new Date(t));
};
/** Instante (ISO) de las `hora` de un día de Guatemala (UTC−6, sin horario de verano). */
const a_las = (dia: string, hora = '12:00'): string => new Date(`${dia}T${hora}:00-06:00`).toISOString();

interface Inv {
  sucursal?: string; residente?: string; tipo?: 'grupal' | 'individual'; dpi?: string | null;
  inicio?: string; fin?: string | null; usosMax?: number | null; usos?: number; activo?: boolean; creadaHaceDias?: number;
}
const invitacion = async (o: Inv = {}): Promise<string> =>
  (await uno<{ id: string }>(
    `INSERT INTO invitaciones_qr
       (sucursal_id, residente_id, tipo, etiqueta, nombre_visitante, numero_dpi, fecha_inicio, fecha_fin,
        usos_maximos, usos_actuales, activo, created_at)
     VALUES ($1, $2, $3, $4, 'Visita INT', $5, $6::date, $7::date, $8, $9, $10, NOW() - ($11 || ' days')::interval)
     RETURNING id`,
    [
      o.sucursal ?? fx.sucursales.A1, o.residente ?? fx.residentes.A1, o.tipo ?? 'grupal', `QR-${randomUUID().slice(0, 6)}`,
      o.dpi ?? null, o.inicio ?? diaGt(-1), o.fin === undefined ? diaGt(7) : o.fin,
      o.usosMax === undefined ? null : o.usosMax, o.usos ?? 0, o.activo ?? true, String(o.creadaHaceDias ?? 0),
    ]))!.id;

const usos = async (id: string): Promise<number> => (await uno<{ n: number }>('SELECT usos_actuales AS n FROM invitaciones_qr WHERE id = $1', [id]))!.n;
const registros = async (id: string): Promise<number> => (await q('SELECT 1 FROM registros_acceso WHERE invitacion_qr_id = $1', [id])).length;

/** Lo que manda la cola offline de la app de escritorio. */
const subir = (inv: string, extra: Record<string, unknown> = {}, quien: { jwt: string; lic: string } = { jwt: agenteA1, lic: licA1 }) =>
  request(app).post('/api/accesos').set(bearer(quien.jwt)).set('X-Licencia-Token', quien.lic).send({
    nombre_visitante: 'Visita QR Integración', numero_dpi: `INT-QR-${randomUUID().slice(0, 8)}`, residente_id: fx.residentes.A1,
    invitacion_qr_id: inv, id_cliente: randomUUID(), registrado_en: new Date(Date.now() - 5 * 60_000).toISOString(), ...extra,
  });

const snapshot = async () => {
  const r = await request(app).get('/api/sync/garita').set(bearer(agenteA1)).set('X-Licencia-Token', licA1);
  expect(r.status).toBe(200);
  return r.body.invitaciones_qr as any[];
};

describe('I-17 snapshot de invitaciones QR para la garita', () => {
  it('trae las de su sucursal con lo necesario para validarlas sin red, y las fechas como texto AAAA-MM-DD', async () => {
    const id = await invitacion({ tipo: 'individual', dpi: '2999111220101', usosMax: 3, usos: 1, fin: diaGt(9) });
    const inv = (await snapshot()).find(i => i.id === id);
    expect(inv).toBeDefined();
    expect(inv).toMatchObject({
      id, tipo: 'individual', nombre_visitante: 'Visita INT', numero_dpi: '2999111220101',
      residente_id: fx.residentes.A1, numero_casa: `INT-A1-${fx.sufijo}`, usos_maximos: 3, usos_actuales: 1, activo: true,
      fecha_inicio: diaGt(-1), fecha_fin: diaGt(9), bloqueado_hasta: null,
    });
    expect(typeof inv.residente_nombre).toBe('string');
    expect(inv.fecha_inicio).toMatch(/^\d{4}-\d{2}-\d{2}$/);        // texto, no un instante que dependa de la zona del servidor
  });

  it('NO trae las de otras sucursales (ni de la misma empresa ni de otra)', async () => {
    const deA2 = await invitacion({ sucursal: fx.sucursales.A2, residente: fx.residentes.A2 });
    const deB1 = await invitacion({ sucursal: fx.sucursales.B1, residente: fx.residentes.B1 });
    const propia = await invitacion();
    const ids = (await snapshot()).map(i => i.id);
    expect(ids).toContain(propia);
    expect(ids).not.toContain(deA2);
    expect(ids).not.toContain(deB1);
  });

  it('incluye las agotadas, las futuras y las sin fecha de fin, para poder explicar el rechazo sin red', async () => {
    const agotada = await invitacion({ usosMax: 1, usos: 1 });
    const futura = await invitacion({ inicio: diaGt(3), fin: diaGt(6) });
    const sinFin = await invitacion({ fin: null });
    const ids = (await snapshot()).map(i => i.id);
    expect(ids).toEqual(expect.arrayContaining([agotada, futura, sinFin]));
  });

  it('las revocadas entran solo si son del último mes; las vencidas de antes de ayer, no', async () => {
    const revocadaReciente = await invitacion({ activo: false, creadaHaceDias: 3 });
    const revocadaVieja = await invitacion({ activo: false, creadaHaceDias: 45 });
    const venceAyer = await invitacion({ inicio: diaGt(-5), fin: diaGt(-1) });          // margen de un día (la fecha del servidor va en UTC)
    const vencidaHaceTiempo = await invitacion({ inicio: diaGt(-20), fin: diaGt(-10) });
    const lista = await snapshot();
    const ids = lista.map(i => i.id);
    expect(ids).toContain(revocadaReciente);
    expect(lista.find(i => i.id === revocadaReciente)!.activo).toBe(false);
    expect(ids).toContain(venceAyer);
    expect(ids).not.toContain(revocadaVieja);
    expect(ids).not.toContain(vencidaHaceTiempo);
  });

  it('lleva el bloqueo temporal por intentos fallidos', async () => {
    const id = await invitacion({ tipo: 'individual', dpi: '2999000000001' });
    await q(`UPDATE invitaciones_qr SET bloqueado_hasta = NOW() + interval '10 minutes' WHERE id = $1`, [id]);
    const inv = (await snapshot()).find(i => i.id === id);
    expect(inv.bloqueado_hasta).toBeTruthy();
  });
});

describe('I-17 el uso que llega de la cola offline se descuenta una vez', () => {
  it('descuenta un uso, lo liga al registro y el reenvío del mismo id_cliente NO vuelve a descontar', async () => {
    const id = await invitacion({ usosMax: 5 });
    const idCliente = randomUUID();
    const primero = await subir(id, { id_cliente: idCliente });
    expect(primero.status).toBe(201);
    expect(await usos(id)).toBe(1);
    expect((await uno('SELECT invitacion_qr_id FROM registros_acceso WHERE id_cliente = $1', [idCliente]))!.invitacion_qr_id).toBe(id);

    for (let i = 0; i < 3; i++) {
      const reenvio = await subir(id, { id_cliente: idCliente });
      expect(reenvio.status).toBe(200);
      expect(reenvio.body.duplicado).toBe(true);
    }
    expect(await usos(id)).toBe(1);
    expect(await registros(id)).toBe(1);
  });

  it('dos reintentos simultáneos del mismo id_cliente descuentan UN uso y dejan UN registro', async () => {
    const id = await invitacion({ usosMax: 5 });
    const idCliente = randomUUID();
    const dpi = `INT-QR-${randomUUID().slice(0, 8)}`;
    const respuestas = await Promise.all([subir(id, { id_cliente: idCliente, numero_dpi: dpi }), subir(id, { id_cliente: idCliente, numero_dpi: dpi })]);
    expect(respuestas.map(r => r.status).sort()).toEqual([200, 201]);
    expect(await usos(id)).toBe(1);
    expect(await registros(id)).toBe(1);
  });

  it('una invitación de un solo uso no sirve dos veces: el segundo uso (otro id_cliente) se rechaza y no descuenta', async () => {
    const id = await invitacion({ usosMax: 1 });
    expect((await subir(id)).status).toBe(201);
    const segundo = await subir(id);
    expect(segundo.status).toBe(409);
    expect(segundo.body.error).toMatch(/máximo de usos/);
    expect(await usos(id)).toBe(1);
    expect(await registros(id)).toBe(1);
  });

  it('cada uso distinto descuenta uno (3 de 3) y el cuarto se rechaza', async () => {
    const id = await invitacion({ usosMax: 3 });
    for (let i = 0; i < 3; i++) expect((await subir(id)).status).toBe(201);
    expect(await usos(id)).toBe(3);
    expect((await subir(id)).status).toBe(409);
    expect(await usos(id)).toBe(3);
  });

  it('revocada MIENTRAS la garita estaba sin red: al subir se rechaza (409), no descuenta y no registra la entrada', async () => {
    const id = await invitacion({ usosMax: 5 });
    await q('UPDATE invitaciones_qr SET activo = FALSE WHERE id = $1', [id]);          // la residente la revoca; la garita sigue con la copia vieja
    const idCliente = randomUUID();
    const r = await subir(id, { id_cliente: idCliente });
    expect(r.status).toBe(409);
    expect(r.body.error).toMatch(/no vigente/);
    expect(await usos(id)).toBe(0);
    expect(await uno('SELECT 1 FROM registros_acceso WHERE id_cliente = $1', [idCliente])).toBeUndefined();
  });

  it('una invitación de OTRA sucursal no se gasta con la licencia de ésta (403) y no descuenta', async () => {
    const deA1 = await invitacion({ usosMax: 5 });
    const r = await subir(deA1, { residente_id: fx.residentes.B1 }, { jwt: agenteB1, lic: licB1 });
    expect(r.status).toBe(403);
    expect(await usos(deA1)).toBe(0);
  });
});

describe('I-17 la vigencia por fechas se mide al día en que entró la persona', () => {
  it('vencía ayer: la entrada de AYER (sincronizada hoy) es válida; la de HOY, no', async () => {
    const id = await invitacion({ inicio: diaGt(-5), fin: diaGt(-1), usosMax: 5 });
    const deAyer = await subir(id, { registrado_en: a_las(diaGt(-1), '12:00') });
    expect(deAyer.status).toBe(201);
    expect(await usos(id)).toBe(1);

    const deHoy = await subir(id, { registrado_en: a_las(diaGt(0), '00:30') });
    expect(deHoy.status).toBe(409);
    expect(deHoy.body.error).toMatch(/no vigente/);
    expect(await usos(id)).toBe(1);
  });

  it('empezaba hoy: una entrada anterior a su primer día se rechaza aunque hoy ya sea válida', async () => {
    const id = await invitacion({ inicio: diaGt(0), fin: diaGt(5), usosMax: 5 });
    expect((await subir(id, { registrado_en: a_las(diaGt(-2), '10:00') })).status).toBe(409);
    expect(await usos(id)).toBe(0);
    expect((await subir(id, { registrado_en: a_las(diaGt(0), '00:05') })).status).toBe(201);
    expect(await usos(id)).toBe(1);
  });

  it('el último día cuenta entero en la zona de Guatemala (23:30 del último día aún es válido)', async () => {
    const id = await invitacion({ inicio: diaGt(-3), fin: diaGt(-1), usosMax: 5 });
    expect((await subir(id, { registrado_en: a_las(diaGt(-1), '23:30') })).status).toBe(201);
  });

  it('un reloj adelantado no gana vigencia: un registrado_en futuro se acota a este momento', async () => {
    const id = await invitacion({ inicio: diaGt(2), fin: diaGt(6), usosMax: 5 });
    const r = await subir(id, { registrado_en: new Date(Date.now() + 3 * 86_400_000).toISOString() });
    expect(r.status).toBe(409);
    expect(await usos(id)).toBe(0);
  });

  it('sin registrado_en (la web) la vigencia sigue midiéndose con el día actual', async () => {
    const vencida = await invitacion({ inicio: diaGt(-9), fin: diaGt(-3), usosMax: 5 });
    const r = await request(app).post('/api/accesos').set(bearer(agenteA1)).send({
      nombre_visitante: 'Visita web', numero_dpi: `INT-QR-${randomUUID().slice(0, 8)}`, residente_id: fx.residentes.A1, invitacion_qr_id: vencida,
    });
    expect(r.status).toBe(409);
    expect(await usos(vencida)).toBe(0);
  });
});
