'use strict';
// Tarea 4 (Sprint 10): el proceso del ANPR. Las peticiones se prueban sin modelos (contexto falso); la corrida REAL —proceso
// aparte, YOLOX-Nano + el OCR de la captura por clic, clips de test-fixtures/anpr reproducidos en tiempo real como los entrega el
// puente de cámaras— se omite si faltan los modelos o ffmpeg.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { createCanvas } = require('@napi-rs/canvas');

const { atender, MAX_JPEG_BASE64 } = require('./servidor');
const { RelojFalso } = require('./reloj');
const { hayFfmpeg, cuadrosDeClip, reproducir } = require('./clip');
const { ARCHIVO_MODELO } = require('./detector');

const MODELOS = path.join(__dirname, '..', '..', 'models');
const FIXTURES = path.join(__dirname, '..', '..', '..', '..', 'test-fixtures', 'anpr');
const verdad = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'verdad_terreno.json'), 'utf8'));
const faltante = !fs.existsSync(path.join(MODELOS, ARCHIVO_MODELO)) ? 'falta el modelo YOLOX (fetch-models.mjs)'
  : !fs.existsSync(path.join(MODELOS, 'SHA256SUMS')) ? 'faltan los modelos de OCR' : !hayFfmpeg() ? 'falta ffmpeg' : false;

function ctxFalso() {
  return {
    carriles: new Map(),
    reloj: new RelojFalso(),
    detector: { detectar: async () => ({ cajas: [], ms: 0 }) },
    ocr: async () => ({ texto: '', items: [] }),
  };
}

const jpeg = () => createCanvas(64, 36).toBuffer('image/jpeg', 80).toString('base64');

test('peticiones: configurar, fotograma, quitar, ping y errores claros', async () => {
  const ctx = ctxFalso();
  assert.deepEqual(await atender(ctx, { id: '1', op: 'ping' }), { id: '1', ok: true, pong: true, carriles: [] });
  assert.equal((await atender(ctx, { id: '2', op: 'configurar' })).ok, false);
  const malRoi = await atender(ctx, { id: '3', op: 'configurar', carril: { id: 'c1', roi: [[0, 0]] } });
  assert.deepEqual([malRoi.ok, /ROI/.test(malRoi.error)], [false, true]);
  assert.deepEqual(await atender(ctx, { id: '4', op: 'configurar', carril: { id: 'c1', roi: verdad.roi } }), { id: '4', ok: true });
  assert.deepEqual(await atender(ctx, { id: '5', op: 'configurar', carril: { id: 'c1' } }), { id: '5', ok: true }, 'reconfigurar el mismo');
  assert.deepEqual((await atender(ctx, { id: '6', op: 'ping' })).carriles, ['c1']);

  const r = await atender(ctx, { id: '7', op: 'fotograma', carril: 'c1', jpeg: jpeg() });
  assert.deepEqual([r.id, r.ok, r.procesado, r.fps_deseado], ['7', true, true, 1]);
  assert.deepEqual(r.tamano, [64, 36]);
  assert.equal((await atender(ctx, { id: '8', op: 'fotograma', carril: 'otro', jpeg: jpeg() })).error, 'carril no configurado');
  assert.equal((await atender(ctx, { id: '9', op: 'fotograma', carril: 'c1', jpeg: '' })).error, 'fotograma inválido');
  assert.equal((await atender(ctx, { id: '10', op: 'fotograma', carril: 'c1', jpeg: 'x'.repeat(MAX_JPEG_BASE64 + 1) })).error, 'fotograma inválido');
  ctx.reloj.avanzar(5000);
  const roto = await atender(ctx, { id: '11', op: 'fotograma', carril: 'c1', jpeg: Buffer.from('no es un jpeg').toString('base64') });
  assert.equal(roto.ok, false, 'una imagen corrupta es un error de ESA petición, no tumba el proceso');
  assert.deepEqual(await atender(ctx, { id: '12', op: 'quitar', carril: 'c1' }), { id: '12', ok: true, quitado: true });
  assert.equal((await atender(ctx, { id: '13', op: 'nada' })).error, 'petición inválida');
});

/** Proceso real del ANPR con su protocolo de líneas. */
function lanzar() {
  const hijo = spawn(process.execPath, [path.join(__dirname, 'servidor.js'), '--models', MODELOS], { stdio: ['pipe', 'pipe', 'pipe'] });
  let buf = '';
  let err = '';
  const esperando = new Map();
  let listo;
  const enListo = new Promise((resolve, reject) => { listo = { resolve, reject }; });
  hijo.stderr.on('data', d => { err += d; });
  hijo.stdout.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const linea = buf.slice(0, i);
      buf = buf.slice(i + 1);
      const m = JSON.parse(linea);
      if (m.evento === 'listo') listo.resolve(m);
      else if (m.evento === 'error_carga') listo.reject(new Error(m.error));
      else esperando.get(m.id)?.(m);
    }
  });
  let n = 0;
  const pedir = (req) => new Promise((resolve) => { const id = String(++n); esperando.set(id, resolve); hijo.stdin.write(JSON.stringify({ ...req, id }) + '\n'); });
  const cerrar = () => new Promise((resolve) => { hijo.on('close', resolve); hijo.stdin.write('{"op":"shutdown"}\n'); });
  return { enListo, pedir, cerrar, stderr: () => err };
}

test('corrida real: clips sintéticos en tiempo real → una decisión correcta por vehículo, ninguna sin vehículo', { skip: faltante, timeout: 240_000 }, async (t) => {
  const anpr = lanzar();
  const listo = await anpr.enListo;
  t.diagnostic(`carga de modelos (OCR + YOLOX): ${listo.ms_carga} ms`);
  const resumen = [];
  try {
    for (const clip of verdad.clips.filter(c => ['entrada_p123abc', 'dos_seguidos', 'ilegible', 'vacio', 'carril_vecino'].some(n => c.archivo.includes(n)))) {
      const nombre = path.basename(clip.archivo, '.mp4');
      assert.equal((await anpr.pedir({ op: 'configurar', carril: { id: nombre, roi: verdad.roi } })).ok, true);
      const cuadros = await cuadrosDeClip(path.join(FIXTURES, clip.archivo), { fps: clip.fps });
      const decisiones = [];
      const movimiento = [];
      const r = await reproducir(cuadros, clip.fps, async (j) => {
        const resp = await anpr.pedir({ op: 'fotograma', carril: nombre, jpeg: j.toString('base64') });
        assert.equal(resp.ok, true, resp.error);
        for (const e of resp.eventos) {
          if (e.tipo === 'decision') decisiones.push(e);
          if (e.tipo.startsWith('movimiento_')) movimiento.push(e.tipo);
        }
        return resp;
      });
      // Unos cuadros vacíos al final para que terminen las pistas (como si la cámara siguiera).
      await anpr.pedir({ op: 'quitar', carril: nombre });
      const esperadas = clip.vehiculos.map(v => v.placa);
      resumen.push(`${nombre}: ${decisiones.map(d => `${d.resultado}:${d.placa ?? d.placa_probable ?? '—'}${d.requiere_verificacion ? '(verif)' : ''} ${d.ms_desde_legible ?? '-'}ms`).join(', ') || 'sin decisiones'} (${r.enviados}/${cuadros.length} cuadros)`);
      assert.equal(decisiones.length, esperadas.length, `${nombre}: ${JSON.stringify(decisiones.map(d => [d.resultado, d.placa, d.motivo]))}`);
      decisiones.forEach((d, i) => {
        if (esperadas[i]) {
          assert.deepEqual([d.resultado, d.placa, d.requiere_verificacion], ['confirmada', esperadas[i], false], `${nombre}: ${JSON.stringify(d.lecturas)}`);
          assert.ok(d.evidencia.placa_jpeg && d.evidencia.vehiculo_jpeg, 'con evidencia');
        } else {
          assert.equal(d.resultado, 'ilegible', `${nombre}: nunca una placa inventada (${JSON.stringify(d.lecturas)})`);
          assert.equal(d.placa, null);
          assert.ok(d.evidencia.vehiculo_jpeg, 'la verificación lleva la foto del vehículo');
        }
      });
      if (!esperadas.length) assert.deepEqual(movimiento, [], `${nombre}: ni siquiera despierta`);
    }
    t.diagnostic(resumen.join('\n'));
  } finally {
    await anpr.cerrar();
  }
  assert.ok(!/P123ABC|C458DFG|P555TRK|U318BCD/.test(anpr.stderr()), 'los logs no llevan placas');
});
