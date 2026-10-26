/**
 * E2E-ANPR · De punta a punta (Sprint 10, tarea 8): un clip de video → el ANPR real de la garita → un registro `anpr` en ESTE
 * backend. Ver docs/anpr_continuo.md («Tarea 8»).
 *
 * Componentes: Express (app.ts) en un puerto local + Postgres de prueba ← la garita de verdad SIN ventana: la prueba de Rust
 *   `anpr::pruebas_reales::e2e_clip_hasta_el_backend` activa una licencia, inicia sesión como agente, baja el snapshot (con el
 *   vehículo autorizado), reproduce el clip sintético con ffmpeg en tiempo real por el sidecar real (YOLOX-Nano + PP-OCRv5),
 *   sigue la pista, junta el consenso, decide contra el SQLCipher, encola sin red, sube la cola y la evidencia.
 * Condición: SG_E2E_ANPR=1, y en la máquina `cargo`, `node`, `ffmpeg` y los modelos del sidecar. Sin eso se omite (el resto de la
 *   suite de integración no lo necesita). El CI lo corre en su propio job (`anpr-e2e`).
 * Resultado esperado: el residente autorizado queda como acceso `origen = 'anpr'` con su vehículo, la confianza, la pista y la
 *   evidencia; el vehículo ilegible queda como evento `ilegible` para el agente; nada se duplica; todo en la bitácora.
 */
import { spawn } from 'child_process';
import path from 'path';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import request from 'supertest';
import app from '../../app';
import { q, uno, cerrarPool } from '../helpers/db';
import { sembrar, Fixtures } from '../helpers/seed';
import { login, bearer, PASSWORD } from '../helpers/auth';

const habilitado = process.env.SG_E2E_ANPR === '1';
const TAURI = path.resolve(__dirname, '../../../../desktop/src-tauri');
/** Placa del clip `entrada_p123abc` (sintética). */
const PLACA = 'P123ABC';

let fx: Fixtures;
let server: Server;
let vehiculoId: string;
let salida = '';
let resultado: { acceso: string; ilegible: string; licencia_id?: string } | null = null;

/** Corre la prueba de Rust contra este backend y devuelve su línea `E2E_ANPR {...}`. */
function correrGarita(api: string): Promise<number | null> {
  return new Promise((resolve) => {
    const hijo = spawn('cargo', ['test', '--lib', '--locked', 'anpr::pruebas_reales::e2e_clip_hasta_el_backend', '--', '--ignored', '--exact', '--nocapture'], {
      cwd: TAURI,
      env: {
        ...process.env,
        SG_TEST_API_URL: api,
        SG_E2E_CODIGO: fx.licencias.A1.codigo,
        SG_E2E_AGENTE: fx.email.agenteA1,
        SG_TEST_PASSWORD: PASSWORD,
      },
    });
    hijo.stdout.on('data', d => { salida += d; });
    hijo.stderr.on('data', d => { salida += d; });
    hijo.on('close', resolve);
  });
}

(habilitado ? describe : describe.skip)('E2E: clip → ANPR de la garita → registro anpr en el backend', () => {
  beforeAll(async () => {
    fx = await sembrar();
    const admin = (await login(app, fx.email.adminSucA1)).token!;
    const v = await request(app).post('/api/anpr/vehiculos').set(bearer(admin)).send({ residente_id: fx.residentes.A1, placa: PLACA, descripcion: 'Sedán plateado (E2E)' });
    expect(v.status).toBe(201);
    vehiculoId = v.body.id;
    server = app.listen(0, '127.0.0.1');
    await new Promise(r => server.once('listening', r));
    const { port } = server.address() as AddressInfo;
    const codigo = await correrGarita(`http://127.0.0.1:${port}`);
    const linea = salida.split('\n').find(l => l.startsWith('E2E_ANPR '));
    resultado = linea ? JSON.parse(linea.slice('E2E_ANPR '.length)) : null;
    if (codigo !== 0 || !resultado) {
      // Lo útil del log de la garita, para saber qué falló sin correrlo a mano.
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

  it('el residente autorizado quedó como acceso automático del ANPR, con su vehículo, confianza, pista y evidencia', async () => {
    const r = await uno<Record<string, unknown>>('SELECT * FROM registros_acceso WHERE id_cliente = $1', [resultado!.acceso]);
    expect(r).toMatchObject({
      origen: 'anpr', autorizado: true, visitante_id: null, vehiculo_residente_id: vehiculoId, residente_id: fx.residentes.A1,
      sucursal_id: fx.sucursales.A1, evidencia_ref: `anpr:${resultado!.acceso}`, verificado_por: null, timestamp_salida: null,
    });
    expect(Number(r!.confianza)).toBeGreaterThanOrEqual(0.9);
    expect(String(r!.track_id)).toMatch(/^e2e-/);
    const evid = await q<{ tipo: string; tamano: number }>('SELECT tipo, tamano FROM evidencias_anpr WHERE id_cliente = $1 ORDER BY tipo', [resultado!.acceso]);
    expect(evid.map(e => e.tipo)).toEqual(['placa', 'vehiculo']);
    expect(evid.every(e => e.tamano > 0 && e.tamano <= 256 * 1024)).toBe(true);
  });

  it('el vehículo ilegible quedó como evento para el agente (no como acceso), con la foto del vehículo', async () => {
    const e = await uno<Record<string, unknown>>('SELECT * FROM anpr_eventos WHERE id_cliente = $1', [resultado!.ilegible]);
    expect(e).toMatchObject({ tipo: 'ilegible', placa: null, sucursal_id: fx.sucursales.A1 });
    expect((await q('SELECT 1 FROM registros_acceso WHERE id_cliente = $1', [resultado!.ilegible])).length).toBe(0);
    const evid = await q<{ tipo: string }>('SELECT tipo FROM evidencias_anpr WHERE id_cliente = $1', [resultado!.ilegible]);
    expect(evid.map(x => x.tipo)).toContain('vehiculo');
  });

  it('nada se duplicó (la cola reintentó sin red y después subió una sola vez) y todo está en la bitácora', async () => {
    const accesos = await q('SELECT 1 FROM registros_acceso WHERE sucursal_id = $1 AND origen = $2', [fx.sucursales.A1, 'anpr']);
    expect(accesos.length).toBe(1);
    const acciones = (await q<{ accion: string }>(
      `SELECT accion FROM audit_logs WHERE usuario_id = $1 AND accion LIKE 'ANPR_%' ORDER BY created_at`, [fx.usuarios.agenteA1])).map(a => a.accion);
    expect(acciones).toEqual(expect.arrayContaining(['ANPR_ACCESO_AUTOMATICO', 'ANPR_ILEGIBLE', 'ANPR_EVIDENCIA']));
    expect(acciones.filter(a => a === 'ANPR_ACCESO_AUTOMATICO').length).toBe(1);
  });
});
