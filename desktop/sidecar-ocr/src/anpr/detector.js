/**
 * Detector de vehículos del ANPR (Sprint 10, tarea 2): YOLOX-Nano en ONNX Runtime (CPU), solo mientras hay movimiento.
 *
 * Modelo: `yolox_nano.onnx` oficial de Megvii (YOLOX 0.1.1rc0, **Apache-2.0**), entrenado en COCO, entrada 1×3×416×416 y salida
 * 1×3549×85 SIN decodificar (`decode_in_inference=False` al exportar): por cada celda de las rejillas de 8, 16 y 32 px trae
 * `[dx, dy, log w, log h, objetualidad, 80 clases]` (objetualidad y clases ya con sigmoide). Ver docs/anpr_continuo.md (licencia y
 * por qué no Ultralytics).
 *
 * Pre-proceso (el de `yolox/data/data_augment.py::preproc`, que es con el que se entrenó):
 *  - letterbox a 416×416 **pegado arriba a la izquierda** (no centrado), relleno gris 114, sin normalizar (0–255), orden **BGR**,
 *    HWC → CHW.
 * Post-proceso:
 *  - decodificar: `cx = (dx + gx) · s`, `cy = (dy + gy) · s`, `w = e^lw · s`, `h = e^lh · s`, con `s` el paso de la rejilla;
 *  - puntaje = objetualidad × la mejor de las clases de vehículo (las demás clases no cuentan);
 *  - NMS **sin distinguir clase** (una pickup puede salir a la vez como `car` y `truck`: es UN vehículo);
 *  - volver a coordenadas del cuadro original (÷ escala del letterbox) y filtrar por ROI.
 *
 * Todo lo puro (decodificar, NMS, IoU, filtro ROI) está separado de ONNX para probarlo con tensores fijos.
 */
'use strict';

const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { createCanvas } = require('@napi-rs/canvas');
const { fraccionDentro, normalizarPoligono } = require('./roi');

/** Clases COCO (índice) que interesan → nombre en la app. COCO no separa «camioneta»: una pickup sale como carro o camión. */
const CLASES_VEHICULO = Object.freeze({ 2: 'carro', 3: 'moto', 5: 'bus', 7: 'camion' });
const PASOS = Object.freeze([8, 16, 32]);
const NUM_CLASES = 80;
const ARCHIVO_MODELO = 'yolox_nano.onnx';
const RELLENO = 114;

const POR_DEFECTO = Object.freeze({
  tamano: 416,
  umbralConfianza: 0.35,
  umbralNms: 0.45,
  /** Fracción mínima de la caja dentro del ROI para aceptar la detección. */
  fraccionRoiMin: 0.3,
  /** Hilos de ONNX Runtime para este modelo (1 = mitigación de CPU; ver tarea 7). */
  hilos: 2,
});

/**
 * Pasa una imagen de canvas (o cualquier cosa que `drawImage` acepte, con `width`/`height`) a la entrada del modelo.
 * @returns {{datos: Float32Array, escala: number}}
 */
function letterbox(img, tamano = POR_DEFECTO.tamano) {
  const escala = Math.min(tamano / img.width, tamano / img.height);
  const c = createCanvas(tamano, tamano);
  const g = c.getContext('2d');
  g.fillStyle = `rgb(${RELLENO},${RELLENO},${RELLENO})`;
  g.fillRect(0, 0, tamano, tamano);
  g.drawImage(img, 0, 0, Math.round(img.width * escala), Math.round(img.height * escala));
  return { datos: rgbaABgrChw(g.getImageData(0, 0, tamano, tamano).data, tamano), escala };
}

/** RGBA (HWC) → BGR planar (CHW) en float32 0–255, como lo espera YOLOX. */
function rgbaABgrChw(rgba, tamano) {
  const n = tamano * tamano;
  const t = new Float32Array(3 * n);
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    t[i] = rgba[j + 2];
    t[n + i] = rgba[j + 1];
    t[2 * n + i] = rgba[j];
  }
  return t;
}

/**
 * Decodifica la salida cruda (Float32Array de N×85) a cajas en píxeles del cuadro ORIGINAL.
 * @returns {Array<{clase: string, indiceCoco: number, confianza: number, bbox: {x: number, y: number, w: number, h: number}}>}
 */
function decodificar(salida, { tamano = POR_DEFECTO.tamano, escala = 1, umbralConfianza = POR_DEFECTO.umbralConfianza, clases = CLASES_VEHICULO } = {}) {
  const ancho = 5 + NUM_CLASES;
  const indices = Object.keys(clases).map(Number);
  const cajas = [];
  let k = 0;
  for (const paso of PASOS) {
    const n = tamano / paso;
    for (let gy = 0; gy < n; gy++) {
      for (let gx = 0; gx < n; gx++, k++) {
        const b = k * ancho;
        if (b + ancho > salida.length) throw new Error(`Salida del modelo más corta de lo esperado (${salida.length} valores)`);
        const obj = salida[b + 4];
        if (obj < umbralConfianza) continue; // atajo: con objetualidad baja ningún producto pasa
        let mejor = 0;
        let cls = -1;
        for (const c of indices) {
          const p = salida[b + 5 + c];
          if (p > mejor) { mejor = p; cls = c; }
        }
        const confianza = obj * mejor;
        if (cls < 0 || confianza < umbralConfianza) continue;
        const cx = ((salida[b] + gx) * paso) / escala;
        const cy = ((salida[b + 1] + gy) * paso) / escala;
        const w = (Math.exp(salida[b + 2]) * paso) / escala;
        const h = (Math.exp(salida[b + 3]) * paso) / escala;
        cajas.push({ clase: clases[cls], indiceCoco: cls, confianza, bbox: { x: cx - w / 2, y: cy - h / 2, w, h } });
      }
    }
  }
  return cajas;
}

/** Intersección sobre unión de dos cajas `{x, y, w, h}`. */
function iou(a, b) {
  const x0 = Math.max(a.x, b.x);
  const y0 = Math.max(a.y, b.y);
  const x1 = Math.min(a.x + a.w, b.x + b.w);
  const y1 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
  const union = a.w * a.h + b.w * b.h - inter;
  return union > 0 ? inter / union : 0;
}

/** Supresión de no-máximos sin distinguir clase: de cada grupo que se solapa más que `umbral` queda la más confiable. */
function nms(cajas, umbral = POR_DEFECTO.umbralNms) {
  const orden = [...cajas].sort((a, b) => b.confianza - a.confianza);
  const quedan = [];
  for (const c of orden) {
    if (quedan.every(q => iou(q.bbox, c.bbox) <= umbral)) quedan.push(c);
  }
  return quedan;
}

/** Acota las cajas al cuadro y descarta las que quedan fuera del ROI (menos de `fraccionMin` adentro). */
function filtrarRoi(cajas, roi, ancho, alto, fraccionMin = POR_DEFECTO.fraccionRoiMin) {
  const salida = [];
  for (const c of cajas) {
    const x0 = Math.max(0, c.bbox.x);
    const y0 = Math.max(0, c.bbox.y);
    const x1 = Math.min(ancho, c.bbox.x + c.bbox.w);
    const y1 = Math.min(alto, c.bbox.y + c.bbox.h);
    if (x1 - x0 < 2 || y1 - y0 < 2) continue;
    const bbox = { x: Math.round(x0), y: Math.round(y0), w: Math.round(x1 - x0), h: Math.round(y1 - y0) };
    const enRoi = fraccionDentro(bbox, roi, ancho, alto);
    if (enRoi >= fraccionMin) salida.push({ clase: c.clase, confianza: Math.round(c.confianza * 1000) / 1000, bbox, en_roi: Math.round(enRoi * 100) / 100 });
  }
  return salida;
}

class DetectorVehiculos {
  /**
   * Carga el modelo. `ort` se inyecta en las pruebas; en producción es `onnxruntime-node`.
   * @param {{dirModelos: string, hilos?: number, ort?: object}} opciones
   */
  static async crear({ dirModelos, hilos = POR_DEFECTO.hilos, ort = require('onnxruntime-node'), ...resto } = {}) {
    const ruta = path.join(dirModelos, ARCHIVO_MODELO);
    const sesion = await ort.InferenceSession.create(ruta, {
      executionProviders: ['cpu'],
      intraOpNumThreads: hilos,
      interOpNumThreads: 1,
      executionMode: 'sequential',
      graphOptimizationLevel: 'all',
    });
    return new DetectorVehiculos(sesion, ort, resto);
  }

  constructor(sesion, ort, cfg = {}) {
    this.sesion = sesion;
    this.ort = ort;
    this.cfg = { ...POR_DEFECTO, ...cfg };
    this.entrada = sesion.inputNames[0];
    this.salida = sesion.outputNames[0];
  }

  /**
   * Detecta vehículos en una imagen (canvas o Image) y devuelve solo los que caen en el ROI.
   * @param {object} img  imagen decodificada (`imagen.cargar`)
   * @param {{roi?: number[][], fraccionRoiMin?: number}} opciones
   * @returns {Promise<{cajas: Array<{clase: string, confianza: number, bbox: object, en_roi: number}>, descartadas: number, ms: number}>}
   */
  async detectar(img, { roi, fraccionRoiMin = this.cfg.fraccionRoiMin } = {}) {
    const t0 = performance.now();
    const { datos, escala } = letterbox(img, this.cfg.tamano);
    const tensor = new this.ort.Tensor('float32', datos, [1, 3, this.cfg.tamano, this.cfg.tamano]);
    const r = await this.sesion.run({ [this.entrada]: tensor });
    const crudas = decodificar(r[this.salida].data, { tamano: this.cfg.tamano, escala, umbralConfianza: this.cfg.umbralConfianza });
    const unicas = nms(crudas, this.cfg.umbralNms);
    const cajas = filtrarRoi(unicas, normalizarPoligono(roi), img.width, img.height, fraccionRoiMin);
    return { cajas, descartadas: unicas.length - cajas.length, ms: Math.round((performance.now() - t0) * 10) / 10 };
  }

  async cerrar() {
    if (this.sesion && typeof this.sesion.release === 'function') await this.sesion.release();
  }
}

module.exports = { DetectorVehiculos, letterbox, rgbaABgrChw, decodificar, nms, iou, filtrarRoi, CLASES_VEHICULO, ARCHIVO_MODELO, POR_DEFECTO };
