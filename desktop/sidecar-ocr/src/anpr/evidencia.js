/**
 * Evidencia de cada decisión del ANPR (Sprint 10, tarea 4): un recorte de la PLACA y uno de la parte BAJA del vehículo, en JPEG,
 * en memoria. El sidecar no los escribe a disco: viajan en la respuesta hacia Rust, que los guarda cifrados (SQLCipher) y los
 * purga a los 7 días (`expira_ms`).
 *
 * Privacidad: el recorte del vehículo deja fuera la parte de arriba de la caja (parabrisas / medallón y cabina), que es donde
 * podría verse una cara; se toma desde el 45 % de la altura hacia abajo (defensa, cajuela o capó, placa y ruedas) y se reduce a
 * 480 px de ancho como máximo. Es una regla geométrica, no un detector de caras: con una cámara muy alta o muy cerca podría
 * colarse algo de la cabina (pendiente de validar con la cámara real, ver docs/anpr_continuo.md).
 */
'use strict';

const { recortar, aJpeg } = require('./imagen');

const RETENCION_MS = 7 * 24 * 60 * 60 * 1000;

const POR_DEFECTO = Object.freeze({
  /** Desde qué fracción de la altura de la caja del vehículo empieza el recorte (lo de arriba es la cabina). */
  corteCabina: 0.45,
  maxAnchoVehiculo: 480,
  calidadVehiculo: 70,
  calidadPlaca: 85,
  /** Margen alrededor de la placa, como fracción de su ancho/alto. */
  margenPlaca: 0.2,
  /** Margen a los lados de la caja del vehículo (ver `zonaInferior`). */
  margenVehiculo: 0.12,
});

/**
 * Parte baja de la caja del vehículo (sin la cabina), con un margen a los lados y abajo: la caja del detector suele quedarse
 * corta en una vista de tres cuartos y la placa queda justo en el borde (medido con los clips de prueba: ~16 % menos del lado
 * de la placa). `margen` = fracción del ancho que se suma a cada lado; `recortar` lo acota al cuadro.
 */
function zonaInferior(bbox, corte = POR_DEFECTO.corteCabina, margen = 0) {
  const y = bbox.y + bbox.h * corte;
  return { x: bbox.x - bbox.w * margen, y, w: bbox.w * (1 + 2 * margen), h: bbox.y + bbox.h * (1 + margen / 2) - y };
}

/** Caja de la placa con margen. */
function conMargen(caja, margen = POR_DEFECTO.margenPlaca) {
  return { x: caja.x - caja.w * margen, y: caja.y - caja.h * margen, w: caja.w * (1 + 2 * margen), h: caja.h * (1 + 2 * margen) };
}

/**
 * Recortes de evidencia de un cuadro.
 * @param {object} img   imagen decodificada del cuadro
 * @param {{x,y,w,h}} bboxVehiculo
 * @param {{x,y,w,h}|null} cajaPlaca  caja de la placa en píxeles del cuadro (o null si no se ubicó)
 * @param {{ts: number}} opciones  `ts` = hora (reloj inyectado) de la decisión
 * @returns {{placa_jpeg: string|null, vehiculo_jpeg: string|null, expira_ms: number, bytes: number}}  JPEG en base64
 */
function recortesEvidencia(img, bboxVehiculo, cajaPlaca, { ts, ...cfg } = {}) {
  const c = { ...POR_DEFECTO, ...cfg };
  const vehiculo = bboxVehiculo ? recortar(img, zonaInferior(bboxVehiculo, c.corteCabina, c.margenVehiculo), c.maxAnchoVehiculo) : null;
  const placa = cajaPlaca ? recortar(img, conMargen(cajaPlaca, c.margenPlaca)) : null;
  const vj = vehiculo ? aJpeg(vehiculo.canvas, c.calidadVehiculo) : null;
  const pj = placa ? aJpeg(placa.canvas, c.calidadPlaca) : null;
  return {
    placa_jpeg: pj ? pj.toString('base64') : null,
    vehiculo_jpeg: vj ? vj.toString('base64') : null,
    expira_ms: ts + RETENCION_MS,
    bytes: (pj?.length ?? 0) + (vj?.length ?? 0),
  };
}

module.exports = { recortesEvidencia, zonaInferior, conMargen, RETENCION_MS, POR_DEFECTO };
