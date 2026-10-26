/**
 * Sidecar de OCR local para la app de garita.
 *
 * Proceso hijo de la app Tauri (ver desktop/src-tauri/src/ocr.rs). Habla JSON
 * por líneas: una petición por línea en stdin, una respuesta por línea en
 * stdout. Los logs van a stderr para no ensuciar el canal.
 *
 * Es 100 % local: los modelos se cargan de disco (--models <dir>) y nunca se
 * hace una petición de red. La imagen llega en base64, se decodifica en
 * memoria y se descarta al responder — nunca se escribe a disco.
 *
 *   → {"id":"1","op":"recognize","image":"<base64>"}
 *   ← {"id":"1","ok":true,"texto":"P123ABC","items":[...],"confianza":0.93,
 *      "ms_inferencia":118,"ms_total":131}
 *
 *   → {"id":"2","op":"dpi","image":"<base64>"}        (T4: extractor del DPI, ver src/dpi.js)
 *   ← {"id":"2","ok":true,"cui":"…","nombres":"…","apellidos":"…","confianza":{…},"correcciones":[…],
 *      "revision_obligatoria":true,"motivos":[…],"ms_inferencia":…,"ms_total":…}
 *   La respuesta del DPI NO trae el texto crudo del documento: solo los campos extraídos.
 *
 * Al arrancar emite {"evento":"listo","ms_carga":N} cuando los modelos ya
 * están en memoria; Rust espera ese evento antes de aceptar capturas.
 */
'use strict';

const readline = require('node:readline');
const path = require('node:path');
const fs = require('node:fs');
const { performance } = require('node:perf_hooks');

const { PaddleOcrService } = require('ppu-paddle-ocr');
const { extraerDpi, completarNombres } = require('./dpi');
const { estimarInclinacion, rotar } = require('./enderezar');

const args = process.argv.slice(2);
const argValue = (flag) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
};

const modelsDir = argValue('--models') || path.join(__dirname, '..', 'models');
const MODEL_FILES = {
  detection: 'PP-OCRv5_mobile_det_infer.ort',
  recognition: 'en_PP-OCRv5_mobile_rec_infer.ort',
  charactersDictionary: 'ppocrv5_en_dict.txt',
};

const log = (...a) => process.stderr.write(`[ocr-sidecar] ${a.join(' ')}\n`);
const emit = (obj) => process.stdout.write(JSON.stringify(obj) + '\n');

function resolveModels(dir) {
  const out = {};
  for (const [k, f] of Object.entries(MODEL_FILES)) {
    const p = path.join(dir, f);
    if (!fs.existsSync(p)) {
      throw new Error(`Modelo no encontrado: ${p} (ejecuta sidecar-ocr/scripts/fetch-models.mjs)`);
    }
    out[k] = p;
  }
  return out;
}

/**
 * Configuración para placas: una sola línea corta, letras latinas y dígitos.
 * - modelo v5 "en" mobile: diccionario sólo latino → menos confusiones con
 *   otros alfabetos que el v6 multilingüe.
 * - minimumConfidence 0.3: preferimos devolver un candidato dudoso (la UI
 *   lo marca y pide confirmación) a devolver vacío.
 */
function createService(models) {
  return new PaddleOcrService({
    model: models,
    recognition: { minimumConfidence: 0.3, spaceRecovery: false },
    debugging: { debug: false, verbose: false },
  });
}

async function recognize(service, imageBase64, opciones = {}) {
  const t0 = performance.now();
  const bytes = Buffer.from(imageBase64, 'base64');
  const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const t1 = performance.now();
  // noCache: cada captura es una foto nueva; cachear por bytes no aporta y
  // retendría imágenes en memoria más tiempo del necesario.
  const result = await service.recognize(ab, { flatten: true, noCache: true, ...opciones });
  const t2 = performance.now();

  const items = (result.results || []).map((r) => ({
    texto: r.text,
    confianza: Number(r.confidence.toFixed(4)),
    box: r.box ? { x: r.box.x, y: r.box.y, w: r.box.width, h: r.box.height } : undefined,
  }));

  return {
    texto: result.text || '',
    items,
    confianza: Number((result.confidence || 0).toFixed(4)),
    ms_inferencia: Math.round(t2 - t1),
    ms_total: Math.round(t2 - t0),
  };
}

/**
 * OCR + extracción de un DPI (T4). Devuelve los campos y cuánto tardó; nunca el texto crudo ni la imagen.
 * Los tiempos incluyen la extracción (despreciable frente a la inferencia).
 */
async function reconocerDpi(service, imageBase64) {
  const t0 = performance.now();
  const original = Buffer.from(imageBase64, 'base64');
  // 1) Se endereza la foto si el documento está torcido (el detector de líneas se confunde pasados ~6°).
  let grados = 0;
  try { grados = (await estimarInclinacion(original)).grados; } catch { /* sin enderezado: se lee la imagen tal cual */ }
  const entrada = grados ? await rotar(original, grados) : original;
  // Sin spaceRecovery: en el conjunto sintético acierta más campos que con él (que parte «GLORIA» en «G LO RIA»);
  // lo que sí pierde son los espacios entre dos nombres («LUISLUCIA»), y por eso la pantalla muestra siempre los campos para revisar.
  let r = await recognize(service, entrada.toString('base64'), { spaceRecovery: false });
  // Reglas del DPI (`extraerDpi`) y la segunda pasada sobre los nombres (une piezas de la misma línea y marca lo dudoso).
  let campos = completarNombres(extraerDpi(r.items), r.items);
  let intentos = 1;
  let msInferencia = r.ms_inferencia;
  // 2) Si no salió un CUI válido y se había girado la imagen, se prueba también sin girar y se queda el mejor resultado.
  if (!campos.cui_valido && grados) {
    const r2 = await recognize(service, original.toString('base64'), { spaceRecovery: false });
    const c2 = completarNombres(extraerDpi(r2.items), r2.items);
    intentos = 2;
    msInferencia += r2.ms_inferencia;
    if (c2.cui_valido || c2.confianza.cui > campos.confianza.cui) campos = c2;
  }
  return {
    ...campos,
    // El evaluador y la pantalla hablan de «revisión»; se expone con ese nombre además del detallado.
    requiere_revision: campos.revision_obligatoria,
    inclinacion_grados: grados,
    intentos,
    ms_inferencia: msInferencia,
    ms_total: Math.round(performance.now() - t0),
  };
}

async function main() {
  const tCarga = performance.now();
  let service;
  try {
    service = createService(resolveModels(modelsDir));
    await service.initialize();
  } catch (err) {
    emit({ evento: 'error_carga', error: String(err && err.message || err) });
    log('no se pudieron cargar los modelos:', err);
    process.exit(1);
  }
  emit({ evento: 'listo', ms_carga: Math.round(performance.now() - tCarga), modelos: modelsDir });

  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  // Las peticiones se atienden en serie: una garita hace una captura a la
  // vez y así el pico de memoria es el de UNA inferencia.
  let cola = Promise.resolve();

  rl.on('line', (line) => {
    if (!line.trim()) return;
    let req;
    try {
      req = JSON.parse(line);
    } catch {
      emit({ ok: false, error: 'JSON inválido' });
      return;
    }
    cola = cola.then(async () => {
      if (req.op === 'ping') return emit({ id: req.id, ok: true, pong: true });
      if (req.op === 'shutdown') { await service.destroy(); process.exit(0); }
      if ((req.op !== 'recognize' && req.op !== 'dpi') || typeof req.image !== 'string') {
        return emit({ id: req.id, ok: false, error: 'petición inválida' });
      }
      try {
        const r = req.op === 'dpi' ? await reconocerDpi(service, req.image) : await recognize(service, req.image);
        emit({ id: req.id, ok: true, ...r });
      } catch (err) {
        emit({ id: req.id, ok: false, error: String(err && err.message || err) });
      }
    });
  });

  rl.on('close', async () => {
    await cola;
    await service.destroy().catch(() => {});
    process.exit(0);
  });
}

if (require.main === module) {
  main().catch((err) => { log('fatal', err); process.exit(1); });
}

module.exports = { createService, recognize, reconocerDpi, resolveModels, MODEL_FILES };
