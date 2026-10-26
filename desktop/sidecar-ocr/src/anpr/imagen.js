/**
 * Utilidades de imagen del ANPR, todas en memoria (nada se escribe a disco).
 *
 * Un fotograma JPEG se decodifica UNA vez (`cargar`) y de esa imagen salen las vistas que necesita cada etapa: el cuadro chico en
 * gris del detector de movimiento, la entrada del detector de vehículos y los recortes para el OCR y la evidencia.
 * Usa `@napi-rs/canvas`, que ya es dependencia del OCR (no suma nada al instalador).
 */
'use strict';

const { createCanvas, loadImage } = require('@napi-rs/canvas');

/** Decodifica un JPEG/PNG (Buffer) a una imagen de canvas. */
async function cargar(buffer) {
  return loadImage(buffer);
}

/** RGBA (Uint8ClampedArray) → gris (Uint8Array) con los pesos de luminancia habituales (enteros: rápido y determinista). */
function rgbaAGris(rgba, ancho, alto) {
  const g = new Uint8Array(ancho * alto);
  for (let i = 0, j = 0; i < g.length; i++, j += 4) g[i] = (rgba[j] * 77 + rgba[j + 1] * 150 + rgba[j + 2] * 29) >> 8;
  return g;
}

/** Cuadro reducido en gris para el detector de movimiento: `ancho` fijo (160 por defecto), alto proporcional. */
function grisReducido(img, ancho = 160) {
  const alto = Math.max(1, Math.round((img.height / img.width) * ancho));
  const c = createCanvas(ancho, alto);
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0, ancho, alto);
  return { ancho, alto, gris: rgbaAGris(g.getImageData(0, 0, ancho, alto).data, ancho, alto) };
}

/** Caja recortada a los límites de la imagen y a enteros. `null` si queda vacía. */
function acotarCaja(caja, ancho, alto) {
  const x0 = Math.max(0, Math.floor(caja.x));
  const y0 = Math.max(0, Math.floor(caja.y));
  const x1 = Math.min(ancho, Math.ceil(caja.x + caja.w));
  const y1 = Math.min(alto, Math.ceil(caja.y + caja.h));
  if (x1 - x0 < 2 || y1 - y0 < 2) return null;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/**
 * Recorta `caja` (píxeles de la imagen original) a un canvas nuevo, reducido si pasa de `maxAncho` o ampliado si no llega a
 * `minAncho` (un recorte de placa de 90 px se lee mejor ampliado). Devuelve `null` si la caja queda fuera de la imagen.
 */
function recortar(img, caja, maxAncho = Infinity, minAncho = 0) {
  const c0 = acotarCaja(caja, img.width, img.height);
  if (!c0) return null;
  const escala = c0.w < minAncho ? minAncho / c0.w : Math.min(1, maxAncho / c0.w);
  const w = Math.max(1, Math.round(c0.w * escala));
  const h = Math.max(1, Math.round(c0.h * escala));
  const c = createCanvas(w, h);
  c.getContext('2d').drawImage(img, c0.x, c0.y, c0.w, c0.h, 0, 0, w, h);
  return { canvas: c, caja: c0, ancho: w, alto: h };
}

/** Canvas → JPEG en memoria. Calidad 0–100. */
function aJpeg(canvas, calidad = 80) {
  return canvas.toBuffer('image/jpeg', calidad);
}

/** Gris de un canvas entero. */
function grisDe(canvas) {
  const { width: w, height: h } = canvas;
  return { ancho: w, alto: h, gris: rgbaAGris(canvas.getContext('2d').getImageData(0, 0, w, h).data, w, h) };
}

/**
 * Varianza del Laplaciano (núcleo 4-vecinos) de un cuadro en gris: medida clásica de nitidez. Una placa movida o desenfocada
 * da valores bajos. Escala: la de los valores de gris al cuadrado (no está normalizada; se compara entre recortes).
 */
function varianzaLaplaciano(gris, ancho, alto) {
  if (ancho < 3 || alto < 3) return 0;
  let s = 0;
  let s2 = 0;
  let n = 0;
  for (let y = 1; y < alto - 1; y++) {
    for (let x = 1; x < ancho - 1; x++) {
      const i = y * ancho + x;
      const l = gris[i - 1] + gris[i + 1] + gris[i - ancho] + gris[i + ancho] - 4 * gris[i];
      s += l;
      s2 += l * l;
      n++;
    }
  }
  const media = s / n;
  return s2 / n - media * media;
}

module.exports = { cargar, rgbaAGris, grisReducido, acotarCaja, recortar, aJpeg, grisDe, varianzaLaplaciano };
