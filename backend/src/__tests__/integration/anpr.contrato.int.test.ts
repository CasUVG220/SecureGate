/**
 * Contrato · Placas de los residentes de punta a punta (Sprint 10, seguimiento del ANPR, tarea 3). Ver docs/anpr_continuo.md §16.
 *
 * Componentes: Express (app.ts) en un puerto local + Postgres de prueba ← la garita de verdad SIN ventana ni cámara: la prueba de
 *   Rust `anpr::contrato_placas::contrato_placas_de_residentes` activa la licencia, inicia sesión como agente y, como
 *   administrador de la sucursal, usa los MISMOS endpoints que la pantalla de casas (`/api/anpr/vehiculos`, eliminar residente,
 *   desactivar usuario). Después de cada cambio baja `GET /sync/garita` (incremental, con la versión) y decide con
 *   `decision::hechos` + `decision::decidir` contra su copia SQLCipher, como cuando el sidecar le entrega una lectura.
 * Condición: SG_E2E_ANPR=1 o SG_CONTRATO_GARITA=1, y `cargo` en la máquina (no necesita sidecar, modelos ni ffmpeg). El CI lo
 *   corre en el job `anpr-e2e`.
 * Resultado esperado: alta → versión nueva → abre; baja → versión nueva → no abre y sale de la copia; residente eliminado → no
 *   abre y su placa no queda en la copia; la misma placa reasignada abre para el residente nuevo (sin heredar nada); usuario del
 *   residente desactivado → versión nueva → no abre. Cada alta y baja quedan en `audit_logs`.
 */
import { spawn } from 'child_process';
import path from 'path';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import app from '../../app';
import { q, uno, cerrarPool } from '../helpers/db';
import { sembrar, Fixtures } from '../helpers/seed';
import { PASSWORD } from '../helpers/auth';
import { esperarAuditoriaDe } from '../helpers/audit';

const habilitado = process.env.SG_E2E_ANPR === '1' || process.env.SG_CONTRATO_GARITA === '1';
const TAURI = path.resolve(__dirname, '../../../../desktop/src-tauri');
const PLACA = 'P777RES';

let fx: Fixtures;
let server: Server;
let residenteNuevo: string;
let salida = '';
let resultado: { v1: string; v2: string; v3: string; versiones: number[] } | null = null;

function correrGarita(api: string): Promise<number | null> {
  return new Promise((resolve) => {
    const hijo = spawn('cargo', ['test', '--lib', '--locked', 'anpr::contrato_placas::contrato_placas_de_residentes', '--', '--ignored', '--exact', '--nocapture'], {
      cwd: TAURI,
      env: {
        ...process.env,
        SG_TEST_API_URL: api,
        SG_TEST_PASSWORD: PASSWORD,
        SG_CONTRATO_CODIGO: fx.licencias.A1.codigo,
        SG_CONTRATO_AGENTE: fx.email.agenteA1,
        SG_CONTRATO_ADMIN: fx.email.adminSucA1,
        SG_CONTRATO_RESIDENTE: fx.residentes.A1,
        SG_CONTRATO_RESIDENTE_NUEVO: residenteNuevo,
        SG_CONTRATO_USUARIO_RESIDENTE: fx.usuarios.resA1,
      },
    });
    hijo.stdout.on('data', d => { salida += d; });
    hijo.stderr.on('data', d => { salida += d; });
    hijo.on('close', resolve);
  });
}

(habilitado ? describe : describe.skip)('Contrato: placa de residente desde la web → /sync/garita → decisión del ANPR', () => {
  beforeAll(async () => {
    fx = await sembrar();
    // Un residente recién dado de alta (sin historial), para poder eliminarlo como lo hace la lista de casas.
    const u = await uno<{ id: string }>(
      `INSERT INTO usuarios (nombre, email, password_hash, rol, sucursal_id, activo)
       VALUES ('INT residente nuevo', $1, crypt($2, gen_salt('bf', 4)), 'residente', $3, TRUE) RETURNING id`,
      [`resnuevo.${fx.sufijo}@inttest.local`, PASSWORD, fx.sucursales.A1]);
    residenteNuevo = (await uno<{ id: string }>(
      `INSERT INTO residentes (usuario_id, sucursal_id, numero_casa, estado_pago, saldo_pendiente)
       VALUES ($1, $2, $3, 'al_dia', 0) RETURNING id`, [u!.id, fx.sucursales.A1, `INT-NUEVA-${fx.sufijo}`]))!.id;

    server = app.listen(0, '127.0.0.1');
    await new Promise(r => server.once('listening', r));
    const { port } = server.address() as AddressInfo;
    const codigo = await correrGarita(`http://127.0.0.1:${port}`);
    const linea = salida.split('\n').find(l => l.startsWith('CONTRATO_PLACAS '));
    resultado = linea ? JSON.parse(linea.slice('CONTRATO_PLACAS '.length)) : null;
    if (codigo !== 0 || !resultado) {
      const lineas = salida.split('\n');
      const i = lineas.findIndex(l => /panicked/.test(l));
      console.error((i >= 0 ? lineas.slice(i, i + 12) : lineas.slice(-30)).join('\n'));
    }
    expect(codigo).toBe(0);
  }, 15 * 60_000);

  afterAll(async () => {
    await new Promise(r => (server ? server.close(r) : r(undefined)));
    await cerrarPool();
  });

  it('la garita vio una versión nueva en cada cambio y decidió con ella (las aserciones de la garita pasaron)', () => {
    expect(resultado).not.toBeNull();
    const v = resultado!.versiones;
    expect([...v].sort((a, b) => a - b)).toEqual(v);
    expect(new Set(v).size).toBe(v.length);
  });

  it('la pantalla escribe en la única fuente que lee la garita: vehiculos_residentes, normalizada', async () => {
    const filas = await q<{ id: string; placa: string; residente_id: string; activo: boolean }>(
      'SELECT id, placa, residente_id, activo FROM vehiculos_residentes WHERE sucursal_id = $1 AND placa = $2 ORDER BY created_at', [fx.sucursales.A1, PLACA]);
    // v2 se fue con el residente eliminado; quedan la baja (v1) y la reasignada (v3).
    expect(filas.map(f => [f.id, f.activo])).toEqual([[resultado!.v1, false], [resultado!.v3, true]]);
    expect((await q('SELECT 1 FROM vehiculos WHERE placa = $1', [PLACA])).length).toBe(0);
  });

  it('cada alta y cada baja de placa quedó en la bitácora con la placa', async () => {
    const altas = await q<{ status_code: number; datos_nuevos: { placa: string } }>(
      `SELECT status_code, datos_nuevos FROM audit_logs WHERE accion = 'VEHICULO_RESIDENTE_CREADO' AND usuario_id = $1 ORDER BY created_at`,
      [fx.usuarios.adminSucA1]);
    expect(altas.map(a => [a.status_code, a.datos_nuevos.placa])).toEqual([[201, PLACA], [201, PLACA], [201, PLACA]]);
    const bajas = await esperarAuditoriaDe('VEHICULO_RESIDENTE_DADO_DE_BAJA', fx.usuarios.adminSucA1);
    expect(bajas[0]).toMatchObject({ status_code: 200, registro_id: resultado!.v1 });
    expect(bajas[0].datos_nuevos.placa).toBe(PLACA);
    expect((await esperarAuditoriaDe('RESIDENTE_ELIMINADO', fx.usuarios.adminSucA1))[0].status_code).toBe(200);
  });
});
