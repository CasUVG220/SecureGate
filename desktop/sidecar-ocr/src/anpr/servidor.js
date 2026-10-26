/**
 * Proceso del ANPR continuo (Sprint 10). Corre APARTE del OCR por clic (`../server.js`), con el mismo runtime Node empaquetado:
 * así la captura por clic no espera detrás de los fotogramas del carril, un fallo aquí no la tumba y «Pausar ANPR» solo tiene que
 * terminar este proceso. Lo lanza y alimenta Rust (`desktop/src-tauri/src/anpr/`).
 *
 * Protocolo: JSON por líneas en stdin/stdout, como `server.js`; los logs van a stderr y nunca llevan placas ni imágenes.
 *
 *   ← {"evento":"listo","ms_carga":N}                                   (modelos de OCR y detector en memoria)
 *   → {"id":"1","op":"configurar","carril":{"id":"c1","roi":[[x,y],…],"movimiento":{…},"tracker":{…},"consenso":{…}}}
 *   ← {"id":"1","ok":true}
 *   → {"id":"2","op":"fotograma","carril":"c1","jpeg":"<base64>"}
 *   ← {"id":"2","ok":true,"procesado":true,"fps_deseado":5,"eventos":[…],"pistas":[…],"tamano":[960,540],"ms":{…}}
 *   → {"id":"3","op":"quitar","carril":"c1"}   → {"op":"ping"}   → {"op":"shutdown"}
 *
 * Los eventos `decision` llevan la evidencia (JPEG en base64): viaja por el pipe hacia Rust, que la guarda cifrada. Este proceso
 * no escribe nada a disco. Las peticiones se atienden en serie (un solo OCR y un solo detector compartidos entre carriles).
 *
 *   node src/anpr/servidor.js --models <dir> [--hilos-detector 2]
 */
'use strict';

const readline = require('node:readline');
const path = require('node:path');
const { performance } = require('node:perf_hooks');

const { createService, recognize, resolveModels } = require('../server');
const { DetectorVehiculos } = require('./detector');
const { Carril } = require('./carril');
const { RelojSistema } = require('./reloj');

const MAX_JPEG_BASE64 = 4 * 1024 * 1024;

const log = (...a) => process.stderr.write(`[anpr] ${a.join(' ')}\n`);
const emitir = (obj) => process.stdout.write(JSON.stringify(obj) + '\n');

/**
 * Atiende una petición ya parseada. Separado de la E/S para probarlo sin procesos.
 * @param {{carriles: Map<string, Carril>, detector: object, ocr: Function, reloj: object}} ctx
 */
async function atender(ctx, req) {
  const { id } = req;
  switch (req.op) {
    case 'ping':
      return { id, ok: true, pong: true, carriles: [...ctx.carriles.keys()] };
    case 'configurar': {
      const c = req.carril;
      if (!c || typeof c !== 'object') return { id, ok: false, error: 'falta la configuración del carril' };
      try {
        const existente = ctx.carriles.get(c.id);
        if (existente) existente.configurar(c);
        else ctx.carriles.set(c.id, new Carril({ id: c.id, config: c, reloj: ctx.reloj, detector: ctx.detector, ocr: ctx.ocr }));
        return { id, ok: true };
      } catch (err) {
        return { id, ok: false, error: String(err && err.message || err) };
      }
    }
    case 'quitar':
      return { id, ok: true, quitado: ctx.carriles.delete(req.carril) };
    case 'fotograma': {
      const carril = ctx.carriles.get(req.carril);
      if (!carril) return { id, ok: false, error: 'carril no configurado' };
      if (typeof req.jpeg !== 'string' || !req.jpeg || req.jpeg.length > MAX_JPEG_BASE64) return { id, ok: false, error: 'fotograma inválido' };
      try {
        const r = await carril.procesar(Buffer.from(req.jpeg, 'base64'));
        return { id, ok: true, ...r };
      } catch (err) {
        return { id, ok: false, error: String(err && err.message || err) };
      }
    }
    default:
      return { id, ok: false, error: 'petición inválida' };
  }
}

/** OCR del carril: el MISMO `recognize` de la captura por clic, sobre un JPEG en memoria. */
const ocrCon = (service) => async (jpeg) => recognize(service, jpeg.toString('base64'));

async function main() {
  const args = process.argv.slice(2);
  const valor = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; };
  const dirModelos = valor('--models') || path.join(__dirname, '..', '..', 'models');
  const hilos = Number(valor('--hilos-detector') || 2);

  const t0 = performance.now();
  let service;
  let detector;
  try {
    service = createService(resolveModels(dirModelos));
    await service.initialize();
    detector = await DetectorVehiculos.crear({ dirModelos, hilos });
  } catch (err) {
    emitir({ evento: 'error_carga', error: String(err && err.message || err) });
    log('no se pudieron cargar los modelos:', String(err && err.message || err));
    process.exit(1);
  }
  emitir({ evento: 'listo', ms_carga: Math.round(performance.now() - t0) });

  const ctx = { carriles: new Map(), detector, ocr: ocrCon(service), reloj: new RelojSistema() };
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  let cola = Promise.resolve();
  const cerrar = async () => {
    await detector.cerrar().catch(() => {});
    await service.destroy().catch(() => {});
    process.exit(0);
  };
  rl.on('line', (linea) => {
    if (!linea.trim()) return;
    let req;
    try {
      req = JSON.parse(linea);
    } catch {
      emitir({ ok: false, error: 'JSON inválido' });
      return;
    }
    cola = cola.then(async () => {
      if (req.op === 'shutdown') return cerrar();
      emitir(await atender(ctx, req));
    });
  });
  rl.on('close', () => { cola.then(cerrar); });
}

if (require.main === module) {
  main().catch((err) => { log('fatal', String(err && err.message || err)); process.exit(1); });
}

module.exports = { atender, ocrCon, MAX_JPEG_BASE64 };
