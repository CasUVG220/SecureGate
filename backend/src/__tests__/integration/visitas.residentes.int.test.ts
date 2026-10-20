/**
 * I-VIS-RES · Las entradas de residentes no son visitas del plan (Sprint 10, seguimiento del ANPR) — integración.
 *
 * Componentes: Express (app.ts) → /api/anpr/accesos, /api/anpr/eventos, /api/accesos, /api/empresas/:id/uso, /api/planes/uso →
 *   services/suscripciones (`visitasDelMes`, `visitasPorEmpresa`) y services/facturacion (`visitasEnRango`) → Postgres real.
 * Condición: licencia de A1 activada; un vehículo autorizado de un residente de A1. La empresa A de esta siembra solo tiene lo que
 *   crean estas pruebas.
 * Resultado esperado (decisión del equipo: el reconocimiento de placas es parte del servicio y un residente que entra no es una
 *   visita):
 *   (a) la entrada ANPR automática de un residente no suma visitas en ninguna de las tres consultas;
 *   (b) tampoco la que el agente confirma con un clic ni una de residente registrada a mano;
 *   (c) la visita que el agente registra después de verificar una placa desconocida SÍ suma;
 *   (d) los totales de registros anteriores al sprint (todos con visitante) no cambian.
 */
import request from 'supertest';
import { randomUUID } from 'crypto';
import app from '../../app';
import pool from '../../db/pool';
import { q, uno, cerrarPool } from '../helpers/db';
import { sembrar, Fixtures } from '../helpers/seed';
import { login, bearer } from '../helpers/auth';
import { visitasDelMes, visitasPorEmpresa } from '../../services/suscripciones';
import { visitasEnRango } from '../../services/facturacion';

let fx: Fixtures;
let lic: string;
let agente: string;
let owner: string;
let vehiculo: { id: string; placa: string };

const garita = (ruta: string, body: Record<string, unknown>) =>
  request(app).post(`/api/anpr${ruta}`).set(bearer(agente)).set('X-Licencia-Token', lic).send(body);

/** Mes y día de Guatemala de un registro (para contar en el periodo donde quedó, aunque la prueba corra a medianoche). */
const periodoDe = async (registroId: string) =>
  (await uno<{ mes: string; dia: string }>(
    `SELECT to_char(timestamp_entrada AT TIME ZONE 'America/Guatemala', 'YYYY-MM') AS mes,
            to_char(timestamp_entrada AT TIME ZONE 'America/Guatemala', 'YYYY-MM-DD') AS dia
       FROM registros_acceso WHERE id = $1`, [registroId]))!;

/** Las tres consultas del plan para la empresa A: uso del mes (API), panel del owner (API) y la factura (servicio). */
async function conteos(mes: string, dia: string) {
  const uso = await request(app).get(`/api/empresas/${fx.empresas.A}/uso?mes=${mes}`).set(bearer(owner));
  const panel = await request(app).get(`/api/planes/uso?mes=${mes}`).set(bearer(owner));
  expect([uso.status, panel.status]).toEqual([200, 200]);
  const fila = panel.body.empresas.find((e: { empresa_id: string }) => e.empresa_id === fx.empresas.A);
  return { uso: uso.body.visitas as number, panel: (fila?.visitas ?? 0) as number, factura: await visitasEnRango(pool, fx.empresas.A, dia, dia) };
}

const mesDe = (s: string) => ({ anio: Number(s.slice(0, 4)), mes: Number(s.slice(5, 7)) });

beforeAll(async () => {
  fx = await sembrar();
  lic = (await request(app).post('/api/licencias/activar').send({ codigo: fx.licencias.A1.codigo, fingerprint: fx.licencias.A1.fingerprint, nombre_dispositivo: 'INT-visitas' })).body.token_licencia;
  agente = (await login(app, fx.email.agenteA1)).token!;
  owner = (await login(app, fx.email.owner)).token!;
  const admin = (await login(app, fx.email.adminSucA1)).token!;
  const placa = `P${String(Date.now()).slice(-3)}VRS`;
  const v = await request(app).post('/api/anpr/vehiculos').set(bearer(admin)).send({ residente_id: fx.residentes.A1, placa });
  expect(v.status).toBe(201);
  vehiculo = v.body;
});
afterAll(cerrarPool);

const accesoAnpr = (modo: 'automatico' | 'verificacion') => garita('/accesos', {
  id_cliente: randomUUID(), vehiculo_id: vehiculo.id, placa: vehiculo.placa, confianza: 0.97, track_id: 'carril1-vis-1',
  carril: 'carril1', modo, registrado_en: new Date(Date.now() - 30_000).toISOString(),
});

describe('las entradas de residentes no consumen visitas del plan', () => {
  it('(a) la entrada ANPR automática de un residente no suma en el uso del mes, el panel del owner ni la factura', async () => {
    const r = await accesoAnpr('automatico');
    expect(r.status).toBe(201);
    expect(r.body.registro).toMatchObject({ origen: 'anpr', autorizado: true, visitante_id: null, vehiculo_residente_id: vehiculo.id });
    const { mes, dia } = await periodoDe(r.body.registro.id);
    expect(await conteos(mes, dia)).toEqual({ uso: 0, panel: 0, factura: 0 });
    // Las funciones del servicio, directo (las que usa la facturación mensual).
    expect(await visitasDelMes(pool, fx.empresas.A, mesDe(mes))).toBe(0);
    expect((await visitasPorEmpresa(pool, mesDe(mes))).get(fx.empresas.A) ?? 0).toBe(0);
  });

  it('(b) tampoco la que el agente confirma con un clic (modo verificación) ni una de residente registrada a mano', async () => {
    const r = await accesoAnpr('verificacion');
    expect(r.status).toBe(201);
    expect(r.body.registro.verificado_por).toBe(fx.usuarios.agenteA1);
    // Una entrada de residente que llegara por otro camino (escritorio, captura manual): el criterio es «sin visitante», no el origen.
    const manual = await uno<{ id: string }>(
      `INSERT INTO registros_acceso (sucursal_id, residente_id, vehiculo_residente_id, agente_id, tipo, origen, capturado_manualmente)
       VALUES ($1, $2, $3, $4, 'entrada', 'desktop', TRUE) RETURNING id`,
      [fx.sucursales.A1, fx.residentes.A1, vehiculo.id, fx.usuarios.agenteA1]);
    const { mes, dia } = await periodoDe(manual!.id);
    expect(await conteos(mes, dia)).toEqual({ uso: 0, panel: 0, factura: 0 });
  });

  it('(c) la visita que el agente registra tras verificar una placa desconocida SÍ suma', async () => {
    const placa = `C${String(Date.now()).slice(-3)}DSC`;
    // El ANPR leyó una placa desconocida; el agente eligió «Registro manual»: el evento queda resuelto…
    const ev = await garita('/eventos', {
      id_cliente: randomUUID(), tipo: 'verificacion_resuelta', placa, carril: 'carril1', track_id: 'carril1-vis-2',
      detalle: { resolucion: 'registro_manual', estado_previo: 'verificacion_pendiente', motivo: 'desconocida' },
    });
    expect(ev.status).toBe(201);
    // …y registra la visita con el formulario de siempre (con la placa leída).
    const visita = await request(app).post('/api/accesos').set(bearer(agente)).set('X-Licencia-Token', lic).send({
      nombre_visitante: 'Visita tras ANPR', numero_dpi: `VR${randomUUID().slice(0, 10)}`, residente_id: fx.residentes.A1, placa, id_cliente: randomUUID(),
    });
    expect(visita.status).toBe(201);
    const { mes, dia } = await periodoDe(visita.body.registro.id);
    expect(await conteos(mes, dia)).toEqual({ uso: 1, panel: 1, factura: 1 });
  });

  it('(d) los totales de registros anteriores al sprint no cambian: todos tienen visitante y se cuentan igual que antes', async () => {
    // Registros «de antes» (junio de 2025) en una empresa nueva: autorizados, uno rechazado y un reenvío por id_cliente.
    const e = (await uno<{ id: string }>(`INSERT INTO empresas (nombre) VALUES ($1) RETURNING id`, [`VIS Hist ${randomUUID().slice(0, 6)}`]))!.id;
    const s = (await uno<{ id: string }>(`INSERT INTO sucursales (empresa_id, nombre) VALUES ($1, 'VIS Hist') RETURNING id`, [e]))!.id;
    const insertar = async (cuando: string, autorizado = true, idCliente: string | null = null) => {
      const v = (await uno<{ id: string }>(`INSERT INTO visitantes (nombre, numero_dpi) VALUES ('VIS hist', $1) RETURNING id`, [`VH${randomUUID().slice(0, 12)}`]))!.id;
      await q(`INSERT INTO registros_acceso (sucursal_id, visitante_id, residente_id, agente_id, tipo, timestamp_entrada, autorizado, id_cliente, origen)
               VALUES ($1, $2, $3, $4, 'entrada', $5::timestamptz, $6, $7, 'web') ON CONFLICT DO NOTHING`,
        [s, v, fx.residentes.A1, fx.usuarios.agenteA1, cuando, autorizado, idCliente]);
    };
    for (const d of ['01', '05', '09', '30']) await insertar(`2025-06-${d} 10:00:00-06`);
    await insertar('2025-06-12 10:00:00-06', false);
    const idc = randomUUID();
    await insertar('2025-06-15 10:00:00-06', true, idc);
    await insertar('2025-06-15 10:00:01-06', true, idc);

    // La fórmula de ANTES (sin la condición de visitante), sobre los mismos registros.
    const antes = (await uno<{ n: number }>(
      `SELECT COUNT(DISTINCT COALESCE(ra.id_cliente, ra.id))::int AS n FROM registros_acceso ra
        WHERE ra.sucursal_id = $1 AND ra.autorizado = TRUE`, [s]))!.n;
    expect(antes).toBe(5);
    const junio = { anio: 2025, mes: 6 };
    expect(await visitasDelMes(pool, e, junio)).toBe(antes);
    expect((await visitasPorEmpresa(pool, junio)).get(e)).toBe(antes);
    expect(await visitasEnRango(pool, e, '2025-06-01', '2025-06-30')).toBe(antes);

    // En toda la base: lo único que la condición nueva deja fuera son entradas de residentes (su vehículo, sin visitante).
    const fuera = await uno<{ total: number; de_residente: number }>(
      `SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE vehiculo_residente_id IS NOT NULL)::int AS de_residente
         FROM registros_acceso WHERE autorizado = TRUE AND visitante_id IS NULL`);
    expect(fuera!.total).toBe(fuera!.de_residente);
  });
});
