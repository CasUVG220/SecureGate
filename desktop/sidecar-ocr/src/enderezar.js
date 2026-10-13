/**
 * Enderezado de la foto del documento (T4).
 *
 * El detector de líneas del OCR confunde las líneas de un documento torcido más de ~6° (junta renglones distintos y
 * devuelve letras sueltas). Antes de leer se estima la inclinación de los renglones con la técnica clásica del perfil de
 * proyección: se prueban ángulos entre -20° y 20° sobre una copia reducida en gris y se queda el que hace más nítidos los
 * renglones (mayor contraste entre filas vecinas). Si la inclinación es menor a 2° no se toca la imagen.
 *
 * Todo ocurre en memoria: la imagen no se escribe a disco. Usa `@napi-rs/canvas` (ya es dependencia del OCR).
 */
'use strict';

const { createCanvas, loadImage } = require('@napi-rs/canvas');

const ANCHO_ANALISIS = 360;
const PASO_GRUESO = 2;
const MIN_GRADOS = 2;

async function cargar(buffer) {
  return loadImage(buffer);
}

/** Puntaje de nitidez de renglones de `gris` (Uint8) tras girarlo `grados`. */
function puntaje(img, ancho, alto, grados) {
  const c = createCanvas(ancho, alto);
  const g = c.getContext('2d');
  g.fillStyle = '#808080';
  g.fillRect(0, 0, ancho, alto);
  g.translate(ancho / 2, alto / 2);
  g.rotate((grados * Math.PI) / 180);
  g.drawImage(img, -ancho / 2, -alto / 2, ancho, alto);
  const { data } = g.getImageData(0, 0, ancho, alto);
  // Perfil: oscuridad acumulada por fila, solo en la franja central (los bordes de la mesa no cuentan).
  const x0 = Math.floor(ancho * 0.15), x1 = Math.floor(ancho * 0.85);
  const filas = new Float64Array(alto);
  for (let y = 0; y < alto; y++) {
    let s = 0;
    for (let x = x0; x < x1; x++) { const i = (y * ancho + x) * 4; s += 255 - (data[i] * 0.3 + data[i + 1] * 0.59 + data[i + 2] * 0.11); }
    filas[y] = s;
  }
  let p = 0;
  for (let y = 1; y < alto; y++) { const d = filas[y] - filas[y - 1]; p += d * d; }
  return p;
}

/** Inclinación estimada en grados (positivo = girada a la derecha); 0 si no hay evidencia clara. */
async function estimarInclinacion(buffer) {
  const img = await cargar(buffer);
  const ancho = ANCHO_ANALISIS, alto = Math.max(1, Math.round((img.height / img.width) * ANCHO_ANALISIS));
  const eval_ = (a) => puntaje(img, ancho, alto, a);
  let mejor = 0, mejorP = -1;
  for (let a = -20; a <= 20; a += PASO_GRUESO) { const p = eval_(a); if (p > mejorP) { mejorP = p; mejor = a; } }
  for (let a = mejor - 1; a <= mejor + 1; a += 0.5) { const p = eval_(a); if (p > mejorP) { mejorP = p; mejor = a; } }
  const p0 = eval_(0);
  // Solo se endereza si el giro mejora de forma clara frente a la imagen tal cual (evita girar por ruido).
  if (Math.abs(mejor) < MIN_GRADOS || mejorP < p0 * 1.08) return { grados: 0, mejora: mejorP / (p0 || 1) };
  // Se devuelve el ángulo que HAY QUE APLICAR a la imagen para enderezarla (el que la hizo más nítida al girarla).
  return { grados: mejor, mejora: mejorP / (p0 || 1) };
}

/** Gira la imagen `grados` (en memoria) y la devuelve en JPEG; el fondo que queda es gris oscuro neutro. */
async function rotar(buffer, grados) {
  const img = await cargar(buffer);
  const c = createCanvas(img.width, img.height);
  const g = c.getContext('2d');
  g.fillStyle = '#3b3f45';
  g.fillRect(0, 0, img.width, img.height);
  g.translate(img.width / 2, img.height / 2);
  g.rotate((grados * Math.PI) / 180);
  g.drawImage(img, -img.width / 2, -img.height / 2);
  return c.toBuffer('image/jpeg', 92);
}

module.exports = { estimarInclinacion, rotar, MIN_GRADOS };
