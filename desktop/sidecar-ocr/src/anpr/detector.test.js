'use strict';
// Tarea 2 (Sprint 10): detector de vehículos. El post-proceso se prueba con tensores FIJOS (sin modelo); la detección real
// sobre test-fixtures/anpr/ se omite si no se descargó el modelo (`node scripts/fetch-models.mjs`) o no hay ffmpeg.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createCanvas } = require('@napi-rs/canvas');

const {
  DetectorVehiculos, letterbox, rgbaABgrChw, decodificar, nms, iou, contencion, filtrarRoi, CLASES_VEHICULO, ARCHIVO_MODELO,
} = require('./detector');
const { cargar } = require('./imagen');
const { leerClip, hayFfmpeg } = require('./clip');

const MODELOS = path.join(__dirname, '..', '..', 'models');
const FIXTURES = path.join(__dirname, '..', '..', '..', '..', 'test-fixtures', 'anpr');
const hayModelo = fs.existsSync(path.join(MODELOS, ARCHIVO_MODELO));
const verdad = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'verdad_terreno.json'), 'utf8'));

const N = 52 * 52 + 26 * 26 + 13 * 13;
/** Índice de la celda (gx, gy) de la rejilla de paso `paso` en la salida de 3549 filas. */
const celda = (paso, gx, gy) => ({ 8: 0, 16: 52 * 52, 32: 52 * 52 + 26 * 26 }[paso] + gy * (416 / paso) + gx);

/** Salida cruda con objetualidad 0 en todas partes salvo las celdas indicadas. */
function salida(celdas) {
  const s = new Float32Array(N * 85);
  for (const c of celdas) {
    const b = celda(c.paso, c.gx, c.gy) * 85;
    s[b] = c.dx; s[b + 1] = c.dy; s[b + 2] = Math.log(c.w); s[b + 3] = Math.log(c.h); s[b + 4] = c.obj;
    for (const [cls, p] of Object.entries(c.clases)) s[b + 5 + Number(cls)] = p;
  }
  return s;
}

test('decodificar: rejilla, paso, exponencial del tamaño y puntaje = objetualidad × clase', () => {
  // Paso 32, celda (5, 6): centro (5.5·32, 6.5·32) = (176, 208); tamaño 4·32 × 2·32 = 128 × 64.
  const cajas = decodificar(salida([{ paso: 32, gx: 5, gy: 6, dx: 0.5, dy: 0.5, w: 4, h: 2, obj: 0.9, clases: { 2: 0.8 } }]));
  assert.equal(cajas.length, 1);
  const [c] = cajas;
  assert.equal(c.clase, 'carro');
  assert.ok(Math.abs(c.confianza - 0.72) < 1e-6);
  for (const [k, v] of Object.entries({ x: 112, y: 176, w: 128, h: 64 })) assert.ok(Math.abs(c.bbox[k] - v) < 1e-3, `${k}=${c.bbox[k]}`);
  // Paso 8 y 16 también: celda (10, 3) de paso 8 → centro (84, 28).
  const [c8] = decodificar(salida([{ paso: 8, gx: 10, gy: 3, dx: 0.5, dy: 0.5, w: 2, h: 2, obj: 1, clases: { 3: 0.9 } }]));
  assert.equal(c8.clase, 'moto');
  assert.ok(Math.abs(c8.bbox.x + c8.bbox.w / 2 - 84) < 1e-3 && Math.abs(c8.bbox.y + c8.bbox.h / 2 - 28) < 1e-3);
});

test('decodificar: solo clases de vehículo, umbral de confianza y escala del letterbox', () => {
  const s = salida([
    { paso: 16, gx: 2, gy: 2, dx: 0, dy: 0, w: 1, h: 1, obj: 0.95, clases: { 0: 0.99 } },        // persona: no cuenta
    { paso: 16, gx: 9, gy: 9, dx: 0, dy: 0, w: 1, h: 1, obj: 0.9, clases: { 2: 0.2 } },          // carro muy dudoso: 0.18
    { paso: 16, gx: 20, gy: 20, dx: 0, dy: 0, w: 2, h: 2, obj: 0.9, clases: { 7: 0.7, 2: 0.6 } }, // camión 0.63 (gana a carro)
    { paso: 32, gx: 1, gy: 1, dx: 0, dy: 0, w: 1, h: 1, obj: 0.9, clases: { 4: 0.99, 5: 0.5 } }, // avión no cuenta; bus 0.45
  ]);
  const cajas = decodificar(s, { escala: 0.5 });
  assert.deepEqual(cajas.map(c => c.clase).sort(), ['bus', 'camion']);
  const camion = cajas.find(c => c.clase === 'camion');
  // Centro en el letterbox (320, 320) → en el original ÷ 0.5 = (640, 640); 32 px → 64 px.
  assert.ok(Math.abs(camion.bbox.x - (640 - 32)) < 1e-3 && Math.abs(camion.bbox.w - 64) < 1e-3);
  assert.deepEqual(Object.values(CLASES_VEHICULO), ['carro', 'moto', 'bus', 'camion']);
  assert.throws(() => decodificar(new Float32Array(10)), /más corta/);
});

test('NMS sin distinguir clase: una pickup vista como carro y camión es UN vehículo; dos vehículos separados quedan', () => {
  const a = { clase: 'carro', confianza: 0.8, bbox: { x: 100, y: 100, w: 200, h: 100 } };
  const b = { clase: 'camion', confianza: 0.6, bbox: { x: 110, y: 105, w: 200, h: 100 } };
  const c = { clase: 'carro', confianza: 0.7, bbox: { x: 500, y: 100, w: 200, h: 100 } };
  const r = nms([b, c, a], 0.45);
  assert.deepEqual(r.map(x => x.confianza), [0.8, 0.7]);
  assert.equal(iou(a.bbox, a.bbox), 1);
  assert.equal(iou(a.bbox, c.bbox), 0);
  assert.ok(Math.abs(iou({ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 0, w: 10, h: 10 }) - 50 / 150) < 1e-9);
  assert.equal(iou({ x: 0, y: 0, w: 0, h: 0 }, { x: 0, y: 0, w: 0, h: 0 }), 0);
});

test('NMS: una caja débil contenida en su mayor parte dentro del carro (IoU baja) es el mismo vehículo; uno parcialmente tapado al lado queda', () => {
  // Caso real (clip «entrada_c458dfg», cuadro 21): carro 0,785 y una caja de 0,361 sobre su mitad trasera, IoU 0,39, contenida 79 %.
  const carro = { clase: 'carro', confianza: 0.785, bbox: { x: 131, y: 322, w: 624, h: 218 } };
  const mitad = { clase: 'carro', confianza: 0.361, bbox: { x: 432, y: 316, w: 396, h: 189 } };
  assert.ok(iou(carro.bbox, mitad.bbox) < 0.45, 'el NMS por IoU solo no la quitaba');
  assert.ok(contencion(mitad.bbox, carro.bbox) > 0.75);
  assert.deepEqual(nms([mitad, carro]).map(c => c.confianza), [0.785]);
  // Una moto delante del carro (toda dentro de su caja): son dos vehículos, quedan los dos.
  const moto = { clase: 'moto', confianza: 0.5, bbox: { x: 300, y: 380, w: 120, h: 140 } };
  assert.ok(contencion(moto.bbox, carro.bbox) > 0.6);
  assert.deepEqual(nms([moto, carro]).map(c => c.clase), ['carro', 'moto']);
  // Solo se descarta la contenida MENOS confiable: una caja grande y débil que contiene a una chica y fuerte sigue (la chica no
  // la contiene a ella).
  const grande = { ...carro, confianza: 0.3 };
  const chica = { ...mitad, confianza: 0.9 };
  assert.deepEqual(nms([grande, chica]).map(c => c.confianza), [0.9, 0.3]);
  assert.equal(contencion({ x: 0, y: 0, w: 0, h: 0 }, carro.bbox), 0);
});

test('filtro por ROI: fuera no cuenta, las cajas se acotan al cuadro y se redondean', () => {
  const izq = [[0, 0], [0.5, 0], [0.5, 1], [0, 1]];
  const cajas = [
    { clase: 'carro', confianza: 0.91234, bbox: { x: -20, y: 10.4, w: 200, h: 100 } },
    { clase: 'carro', confianza: 0.8, bbox: { x: 700, y: 10, w: 200, h: 100 } },
    { clase: 'carro', confianza: 0.8, bbox: { x: 2000, y: 10, w: 200, h: 100 } },
  ];
  const r = filtrarRoi(cajas, izq, 960, 540, 0.3);
  assert.equal(r.length, 1);
  assert.deepEqual(r[0], { clase: 'carro', confianza: 0.912, bbox: { x: 0, y: 10, w: 180, h: 100 }, en_roi: 1 });
});

test('pre-proceso: BGR planar y letterbox pegado arriba a la izquierda con relleno 114', () => {
  assert.deepEqual([...rgbaABgrChw(Uint8ClampedArray.from([10, 20, 30, 255]), 1)], [30, 20, 10]);
  const img = createCanvas(832, 416);
  const g = img.getContext('2d');
  g.fillStyle = 'rgb(255,0,0)';
  g.fillRect(0, 0, 832, 416);
  const { datos, escala } = letterbox(img, 416);
  const n = 416 * 416;
  assert.equal(escala, 0.5);
  assert.deepEqual([datos[0], datos[n], datos[2 * n]], [0, 0, 255], 'arriba a la izquierda: rojo en el canal R (el tercero)');
  const abajo = 415 * 416 + 200;
  assert.deepEqual([datos[abajo], datos[n + abajo], datos[2 * n + abajo]], [114, 114, 114], 'abajo: relleno');
});

test('DetectorVehiculos con un ONNX falso: arma el tensor, decodifica, filtra por ROI y mide el tiempo', async () => {
  const ort = {
    Tensor: class { constructor(tipo, datos, dims) { Object.assign(this, { tipo, datos, dims }); } },
    InferenceSession: {
      create: async (ruta, opciones) => {
        assert.ok(ruta.endsWith(ARCHIVO_MODELO));
        assert.equal(opciones.intraOpNumThreads, 1);
        return {
          inputNames: ['images'], outputNames: ['output'],
          run: async (feeds) => {
            assert.deepEqual(feeds.images.dims, [1, 3, 416, 416]);
            return { output: { data: salida([
              { paso: 32, gx: 5, gy: 6, dx: 0.5, dy: 0.5, w: 4, h: 2, obj: 0.9, clases: { 2: 0.8 } },
              { paso: 32, gx: 11, gy: 1, dx: 0.5, dy: 0.5, w: 2, h: 2, obj: 0.9, clases: { 2: 0.8 } },
            ]) } };
          },
          release: async () => {},
        };
      },
    },
  };
  const det = await DetectorVehiculos.crear({ dirModelos: '/modelos', hilos: 1, ort });
  const img = createCanvas(416, 416);
  const r = await det.detectar(img, { roi: [[0, 0], [0.6, 0], [0.6, 1], [0, 1]] });
  assert.equal(r.cajas.length, 1, 'la de la derecha cae fuera del ROI');
  assert.equal(r.descartadas, 1);
  assert.ok(r.ms >= 0);
  await det.cerrar();
});

test('detección real con YOLOX-Nano sobre las imágenes de test-fixtures/anpr', { skip: hayModelo ? false : 'falta el modelo (fetch-models.mjs)' }, async (t) => {
  const det = await DetectorVehiculos.crear({ dirModelos: MODELOS });
  try {
    const tiempos = [];
    for (const im of verdad.imagenes) {
      const img = await cargar(fs.readFileSync(path.join(FIXTURES, im.archivo)));
      await det.detectar(img, { roi: verdad.roi }); // la primera inferencia paga la inicialización
      const r = await det.detectar(img, { roi: verdad.roi });
      tiempos.push(r.ms);
      assert.equal(r.cajas.length, im.vehiculos_en_roi, `${im.archivo}: ${JSON.stringify(r.cajas)}`);
      for (const c of r.cajas) assert.ok(c.confianza >= 0.5 && c.clase === 'carro', JSON.stringify(c));
    }
    t.diagnostic(`ms por fotograma (960×540, entrada 416): ${tiempos.join(' / ')}`);
  } finally {
    await det.cerrar();
  }
});

test('detección real en un clip: hay vehículo mientras está en el ROI y ninguno con el carril vacío o en el carril vecino', {
  skip: !hayModelo ? 'falta el modelo' : !hayFfmpeg() ? 'falta ffmpeg' : false, timeout: 120_000,
}, async (t) => {
  const det = await DetectorVehiculos.crear({ dirModelos: MODELOS });
  try {
    const porClip = {};
    const ms = [];
    for (const nombre of ['entrada_p123abc', 'vacio', 'carril_vecino']) {
      const conVehiculo = [];
      await leerClip(path.join(FIXTURES, 'clips', `${nombre}.mp4`), { fps: 5 }, async (jpeg) => {
        const r = await det.detectar(await cargar(jpeg), { roi: verdad.roi });
        ms.push(r.ms);
        conVehiculo.push(r.cajas.length);
      });
      porClip[nombre] = conVehiculo;
    }
    assert.ok(porClip.vacio.every(n => n === 0), `vacío: ${porClip.vacio}`);
    assert.ok(porClip.carril_vecino.every(n => n === 0), `carril vecino: ${porClip.carril_vecino}`);
    const e = porClip.entrada_p123abc;
    assert.ok(e.filter(n => n === 1).length >= 18, `el vehículo se ve en la mayoría de los cuadros con él (${e.join('')})`);
    assert.ok(e.every(n => n <= 1), 'nunca dos detecciones del mismo vehículo');
    assert.equal(e[0], 0, 'el clip empieza con el carril vacío');
    ms.sort((a, b) => a - b);
    t.diagnostic(`ms por fotograma en ${ms.length} cuadros: mediana ${ms[ms.length >> 1]}, p95 ${ms[Math.floor(ms.length * 0.95)]}`);
  } finally {
    await det.cerrar();
  }
});
