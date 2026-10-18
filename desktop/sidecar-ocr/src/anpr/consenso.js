/**
 * Consenso de lecturas por pista (Sprint 10, tarea 4).
 *
 * Una sola lectura del OCR no basta para abrir una barrera: un reflejo o un cuadro movido convierten `P123ABC` en `P123A8C`.
 * Por cada pista se leen varios recortes (los de mejor calidad) y la placa se CONFIRMA solo cuando:
 *  - al menos `minCoincidencias` (3) lecturas válidas dan exactamente la misma placa, y
 *  - la confianza agregada ≥ `confianzaMin` (0,90). Confianza agregada = media de la confianza del OCR en las lecturas que
 *    coinciden × la fracción de lecturas válidas que coinciden. Una lectura discrepante baja el agregado: es conservador a
 *    propósito (ante la duda, verificación del agente).
 * Si con las lecturas que quedan ya no se puede llegar al mínimo, la pista es ILEGIBLE sin esperar más. Hay dos cupos: `maxLecturas`
 * (5) lecturas VÁLIDAS y `maxIntentos` (8) lecturas en total: una lectura sin forma de placa (un recorte movido, el texto
 * «GUATEMALA» pegado a la placa) no es evidencia de OTRA placa, así que no gasta el cupo de las válidas, pero sí el total.
 *
 * Corrección por posición: una lectura corregida (O→0, B→8…) vota, pero si el consenso NECESITA alguna corrección —menos de
 * `minCoincidencias` lecturas LITERALES (sin corregir) en el grupo ganador— o el prefijo no es uno conocido, el resultado lleva
 * `requiere_verificacion = true` y **nunca** abre solo. Tres lecturas literales iguales más una corregida que coincide no
 * necesitan la corrección: no se marca. Se registra además si ALGUNA lectura (ganadora o no) se corrigió.
 */
'use strict';

const { mejorCandidato, normalizar } = require('./placa');
const { varianzaLaplaciano } = require('./imagen');

const POR_DEFECTO = Object.freeze({
  minCoincidencias: 3,
  confianzaMin: 0.9,
  maxLecturas: 5,
  maxIntentos: 8,
  /** Calidad mínima (0–1) de un recorte para gastar una lectura en él. */
  calidadMin: 0.25,
});

function configurar(cfg = {}) {
  const c = { ...POR_DEFECTO, ...Object.fromEntries(Object.entries(cfg).filter(([, v]) => v !== undefined && v !== null)) };
  const rango = (k, min, max) => {
    if (!Number.isFinite(c[k]) || c[k] < min || c[k] > max) throw new Error(`Configuración del consenso inválida: ${k}=${c[k]} (entre ${min} y ${max})`);
  };
  rango('minCoincidencias', 1, 10);
  rango('confianzaMin', 0.5, 1);
  rango('maxLecturas', 1, 20);
  rango('maxIntentos', 1, 40);
  rango('calidadMin', 0, 1);
  c.minCoincidencias = Math.round(c.minCoincidencias);
  c.maxLecturas = Math.round(c.maxLecturas);
  c.maxIntentos = Math.max(Math.round(c.maxIntentos), c.maxLecturas);
  if (c.maxLecturas < c.minCoincidencias) throw new Error('Configuración del consenso inválida: maxLecturas debe ser ≥ minCoincidencias');
  return c;
}

/**
 * Calidad (0–1) de un recorte para leer la placa: tamaño del vehículo en el cuadro (más grande = placa con más píxeles), nitidez
 * (varianza del Laplaciano de la zona baja del vehículo, donde va la placa) y posición (centrado y completo: una caja que toca el
 * borde puede tener la placa cortada y vale 0).
 * @param {{bbox: {x,y,w,h}, ancho: number, alto: number, nitidez: number}} r  `nitidez` = varianza del Laplaciano
 */
function calidadRecorte({ bbox, ancho, alto, nitidez }) {
  const margen = 2;
  if (bbox.x <= margen || bbox.y <= margen || bbox.x + bbox.w >= ancho - margen || bbox.y + bbox.h >= alto - margen) return 0;
  const tam = Math.min(1, bbox.w / ancho / 0.6);
  // log10(1 + var): ~1 un recorte casi liso, ~3 uno con bordes nítidos.
  const nit = Math.min(1, Math.log10(1 + Math.max(0, nitidez)) / 3);
  const cx = (bbox.x + bbox.w / 2) / ancho;
  const pos = 1 - Math.min(1, Math.abs(cx - 0.5) * 2);
  return Math.round((0.45 * tam + 0.4 * nit + 0.15 * pos) * 1000) / 1000;
}

/** Nitidez de un cuadro en gris (re-export para el carril). */
const nitidez = (cuadro) => varianzaLaplaciano(cuadro.gris, cuadro.ancho, cuadro.alto);

/** Forma «esqueleto» de un texto: las letras que el OCR confunde con dígitos pasan a su dígito (para ubicar los fragmentos). */
const ESQUELETO = { O: '0', D: '0', Q: '0', I: '1', L: '1', Z: '2', S: '5', B: '8', G: '6', T: '7', A: '4' };
const esqueleto = (s) => normalizar(s).replace(/[ODQILZSBGTA]/g, (c) => ESQUELETO[c]);

const union = (cajas) => {
  const x0 = Math.min(...cajas.map((b) => b.x));
  const y0 = Math.min(...cajas.map((b) => b.y));
  const x1 = Math.max(...cajas.map((b) => b.x + b.w));
  const y1 = Math.max(...cajas.map((b) => b.y + b.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
};

/**
 * Caja (en píxeles del recorte leído) de los fragmentos del OCR que forman la placa: la unión de los que son parte de ella. `null`
 * si no se puede ubicar (el recorte de evidencia de la placa cae entonces en la parte baja del vehículo).
 *
 * Primero los fragmentos de 2 o más caracteres que están en la placa; después se suman los de UN carácter que están en la misma
 * línea y pegados a ellos (el detector suele separar el prefijo: `P` + `123ABC`; sin esto la relectura recortaba la placa sin
 * su `P`). Un carácter suelto lejos de la placa (un logo) no cuenta.
 */
function cajaDePlaca(items, placa) {
  const p = esqueleto(placa);
  const conCaja = items.filter((i) => i.box && esqueleto(i.texto).length >= 1 && p.includes(esqueleto(i.texto)));
  const largos = items.filter((i) => i.box && esqueleto(i.texto).length >= 2 && (p.includes(esqueleto(i.texto)) || esqueleto(i.texto).includes(p)));
  if (!largos.length) return null;
  let caja = union(largos.map((i) => i.box));
  for (const i of conCaja) {
    if (largos.includes(i)) continue;
    const b = i.box;
    const cy = b.y + b.h / 2;
    const mismaLinea = cy >= caja.y && cy <= caja.y + caja.h;
    const hueco = b.x > caja.x + caja.w ? b.x - (caja.x + caja.w) : caja.x - (b.x + b.w);
    if (mismaLinea && hueco <= caja.h * 1.5) caja = union([caja, b]);
  }
  return caja;
}

/** Pasa la salida del OCR (`{texto, items}`) a una lectura de placa con sus banderas. */
function lecturaDeOcr(ocr) {
  const c = mejorCandidato(ocr.items || [], ocr.texto || '');
  return {
    placa: c.valida ? c.placa : null,
    texto: c.valida ? c.placa : c.placa.slice(0, 20),
    valida: c.valida,
    correcciones: c.correcciones,
    prefijo_conocido: c.prefijoConocido,
    confianza: Math.round(c.confianza * 10000) / 10000,
    caja_placa: c.valida ? cajaDePlaca(ocr.items || [], c.placa) : null,
  };
}

class Consenso {
  constructor(cfg = {}) {
    this.cfg = configurar(cfg);
    this.lecturas = [];
  }

  /** Agrega una lectura (salida de `lecturaDeOcr`) y devuelve el resultado actualizado. */
  agregar(lectura) {
    this.lecturas.push(lectura);
    return this.resultado();
  }

  get cantidad() {
    return this.lecturas.length;
  }

  /** ¿Se pueden pedir más lecturas? */
  get abierto() {
    return this.resultado().estado === 'pendiente';
  }

  /**
   * @returns {{estado: 'pendiente'|'confirmada'|'ilegible', placa: string|null, confianza: number, votos: number, validas: number,
   *            total: number, requiere_verificacion: boolean, alguna_correccion: boolean, motivo?: string}}
   */
  resultado() {
    const { minCoincidencias, confianzaMin, maxLecturas, maxIntentos } = this.cfg;
    const validas = this.lecturas.filter((l) => l.valida && l.placa);
    const grupos = new Map();
    for (const l of validas) {
      const g = grupos.get(l.placa) ?? [];
      g.push(l);
      grupos.set(l.placa, g);
    }
    const media = (g) => g.reduce((a, l) => a + l.confianza, 0) / g.length;
    const ordenados = [...grupos.entries()].sort((a, b) => b[1].length - a[1].length || media(b[1]) - media(a[1]));
    const [placa, ganadoras] = ordenados[0] ?? [null, []];
    const votos = ganadoras.length;
    const confianza = votos ? Math.round(media(ganadoras) * (votos / validas.length) * 10000) / 10000 : 0;
    const base = {
      placa,
      confianza,
      votos,
      validas: validas.length,
      total: this.lecturas.length,
      requiere_verificacion: votos > 0
        && (ganadoras.filter((l) => l.correcciones === 0).length < minCoincidencias || ganadoras.some((l) => !l.prefijo_conocido)),
      alguna_correccion: this.lecturas.some((l) => l.correcciones > 0),
    };
    if (votos >= minCoincidencias && confianza >= confianzaMin) return { estado: 'confirmada', ...base };
    // Lecturas válidas que todavía pueden llegar: lo que queda del cupo de válidas, sin pasarse del cupo total de intentos.
    const quedan = Math.max(0, Math.min(maxLecturas - validas.length, maxIntentos - this.lecturas.length));
    if (quedan <= 0) return { estado: 'ilegible', ...base, motivo: votos ? 'lecturas_divergentes' : 'sin_lectura_valida' };
    // Cota optimista: todas las que quedan coinciden con confianza 1. Si ni así se llega, no se gasta más OCR.
    const suma = ganadoras.reduce((a, l) => a + l.confianza, 0);
    const alcanzable = votos ? (suma + quedan) / (validas.length + quedan) : 1;
    if (votos + quedan < minCoincidencias || alcanzable < confianzaMin) {
      return { estado: 'ilegible', ...base, motivo: votos ? 'lecturas_divergentes' : 'sin_lectura_valida' };
    }
    return { estado: 'pendiente', ...base };
  }
}

module.exports = { Consenso, configurar, calidadRecorte, nitidez, cajaDePlaca, lecturaDeOcr, esqueleto, POR_DEFECTO };
