/**
 * Detección de movimiento por carril (Sprint 10, tarea 1): decide cuándo «despertar» el resto del pipeline ANPR.
 *
 * Por qué así y no con el detector de vehículos siempre encendido: con el carril vacío (casi todo el día) basta con comparar
 * un cuadro chico en gris contra el anterior a 1 fps; el detector y el OCR solo corren mientras algo se mueve en el ROI.
 *
 * Algoritmo (barato a propósito, ~160×90 píxeles):
 *  1. El cuadro llega ya reducido y en gris (`imagen.grisReducido`).
 *  2. Se suaviza con un desenfoque de caja (quita el ruido del sensor y de la compresión JPEG).
 *  3. Se resta del cuadro anterior SOLO dentro del ROI, compensando el cambio de brillo global (la cámara ajusta la exposición,
 *     pasa una nube): se descuenta la diferencia media antes de umbralizar.
 *  4. `cambio` = fracción de píxeles del ROI cuya diferencia supera `umbralPixel`.
 *  5. Histéresis: hacen falta `framesActivar` cuadros seguidos con `cambio ≥ umbralCambio` para emitir `movimiento_inicio`, y
 *     `framesDesactivar` seguidos por debajo para emitir `movimiento_fin`. Un parpadeo no despierta nada (al restar cuadros, un
 *     destello de UN cuadro da DOS diferencias seguidas: aparece y desaparece; por eso el mínimo útil es 3); un carro que frena
 *     un momento no corta el evento.
 *  6. En reposo se mira a 1 fps, pero el primer cuadro sospechoso ya pide el fps activo: la confirmación (3 cuadros) tarda
 *     ~0,4 s y no 3 s.
 *
 * El tiempo de los eventos sale del reloj inyectado (ver `reloj.js`).
 */
'use strict';

const { normalizarPoligono, mascara } = require('./roi');

const POR_DEFECTO = Object.freeze({
  /** Fracción de los píxeles del ROI que deben cambiar para contar el cuadro como «con movimiento». */
  umbralCambio: 0.015,
  /** Diferencia de gris (0–255, ya suavizada y compensada) para contar un píxel como cambiado. */
  umbralPixel: 18,
  framesActivar: 3,
  framesDesactivar: 6,
  /** En reposo solo se mira el movimiento, a 1 fps. */
  fpsReposo: 1,
  /** Con movimiento: detector + seguimiento, 3–5 fps. */
  fpsActivo: 5,
  radioSuavizado: 1,
});

/** Valida la configuración del carril y la completa con los valores por defecto. */
function configurar(cfg = {}) {
  const c = { ...POR_DEFECTO, ...Object.fromEntries(Object.entries(cfg).filter(([, v]) => v !== undefined && v !== null)) };
  const rango = (k, min, max) => {
    if (!Number.isFinite(c[k]) || c[k] < min || c[k] > max) throw new Error(`Configuración de movimiento inválida: ${k}=${c[k]} (entre ${min} y ${max})`);
  };
  rango('umbralCambio', 0.0001, 1);
  rango('umbralPixel', 1, 255);
  rango('framesActivar', 1, 50);
  rango('framesDesactivar', 1, 300);
  rango('fpsReposo', 0.1, 30);
  rango('fpsActivo', 0.1, 30);
  rango('radioSuavizado', 0, 5);
  c.framesActivar = Math.round(c.framesActivar);
  c.framesDesactivar = Math.round(c.framesDesactivar);
  c.radioSuavizado = Math.round(c.radioSuavizado);
  c.roi = normalizarPoligono(cfg.roi);
  return c;
}

/** Desenfoque de caja separable de radio `r` (bordes repetidos). Devuelve un arreglo nuevo. */
function suavizar(gris, ancho, alto, r) {
  if (r <= 0) return Uint8Array.from(gris);
  const tmp = new Uint16Array(ancho * alto);
  const out = new Uint8Array(ancho * alto);
  const n = 2 * r + 1;
  for (let y = 0; y < alto; y++) {
    const fila = y * ancho;
    for (let x = 0; x < ancho; x++) {
      let s = 0;
      for (let k = -r; k <= r; k++) s += gris[fila + Math.min(ancho - 1, Math.max(0, x + k))];
      tmp[fila + x] = s;
    }
  }
  for (let y = 0; y < alto; y++) {
    for (let x = 0; x < ancho; x++) {
      let s = 0;
      for (let k = -r; k <= r; k++) s += tmp[Math.min(alto - 1, Math.max(0, y + k)) * ancho + x];
      out[y * ancho + x] = Math.round(s / (n * n));
    }
  }
  return out;
}

class DetectorMovimiento {
  /**
   * @param {object} cfg  ver `POR_DEFECTO` + `roi` (polígono normalizado)
   * @param {{ahora(): number}} reloj
   */
  constructor(cfg, reloj) {
    if (!reloj || typeof reloj.ahora !== 'function') throw new Error('DetectorMovimiento necesita un reloj');
    this.cfg = configurar(cfg);
    this.reloj = reloj;
    this.reiniciar();
  }

  reiniciar() {
    this.anterior = null;
    this.dim = null;
    this.mascara = null;
    this.pixelesRoi = 0;
    this.activo = false;
    this.seguidosArriba = 0;
    this.seguidosAbajo = 0;
    this.inicio = null;
  }

  /** fps al que conviene mandar cuadros ahora: el de movimiento si hay (o se está confirmando), si no el de reposo. */
  get fpsDeseado() {
    return this.activo || this.seguidosArriba > 0 ? this.cfg.fpsActivo : this.cfg.fpsReposo;
  }

  /**
   * Procesa un cuadro reducido en gris `{ancho, alto, gris: Uint8Array}`.
   * @returns {{activo: boolean, cambio: number, eventos: Array<{tipo: string, ts: number, cambio: number, duracion_ms?: number}>, fpsDeseado: number}}
   */
  procesar(cuadro) {
    const { ancho, alto, gris } = cuadro;
    if (!ancho || !alto || !gris || gris.length !== ancho * alto) throw new Error('Cuadro inválido para el detector de movimiento');
    const ts = this.reloj.ahora();
    const clave = `${ancho}x${alto}`;
    if (this.dim !== clave) {
      // Otro tamaño (se cambió el stream): se empieza de cero sin inventar movimiento.
      const estabaActivo = this.activo;
      this.reiniciar();
      this.activo = estabaActivo;
      this.dim = clave;
      this.mascara = mascara(this.cfg.roi, ancho, alto);
      this.pixelesRoi = this.mascara.reduce((a, b) => a + b, 0);
    }
    const actual = suavizar(gris, ancho, alto, this.cfg.radioSuavizado);
    const anterior = this.anterior;
    this.anterior = actual;
    if (!anterior || this.pixelesRoi === 0) return { activo: this.activo, cambio: 0, eventos: [], fpsDeseado: this.fpsDeseado };

    const m = this.mascara;
    let suma = 0;
    for (let i = 0; i < actual.length; i++) if (m[i]) suma += actual[i] - anterior[i];
    const media = suma / this.pixelesRoi;
    let cambiados = 0;
    for (let i = 0; i < actual.length; i++) {
      if (m[i] && Math.abs(actual[i] - anterior[i] - media) > this.cfg.umbralPixel) cambiados++;
    }
    const cambio = cambiados / this.pixelesRoi;

    const eventos = [];
    if (cambio >= this.cfg.umbralCambio) {
      this.seguidosArriba++;
      this.seguidosAbajo = 0;
      if (!this.activo && this.seguidosArriba >= this.cfg.framesActivar) {
        this.activo = true;
        this.inicio = ts;
        eventos.push({ tipo: 'movimiento_inicio', ts, cambio: redondear(cambio) });
      }
    } else {
      this.seguidosAbajo++;
      this.seguidosArriba = 0;
      if (this.activo && this.seguidosAbajo >= this.cfg.framesDesactivar) {
        this.activo = false;
        eventos.push({ tipo: 'movimiento_fin', ts, cambio: redondear(cambio), duracion_ms: this.inicio == null ? 0 : ts - this.inicio });
        this.inicio = null;
      }
    }
    return { activo: this.activo, cambio: redondear(cambio), eventos, fpsDeseado: this.fpsDeseado };
  }
}

const redondear = (v) => Math.round(v * 10000) / 10000;

module.exports = { DetectorMovimiento, configurar, suavizar, POR_DEFECTO };
