/**
 * Reloj inyectable del ANPR (Sprint 10).
 *
 * Todo lo que en el ANPR depende del tiempo (histéresis, ritmo de fotogramas, pérdida de pistas, enfriamiento de placas,
 * tiempo máximo de lectura) pregunta la hora a un `Reloj` y nunca a `Date.now()` directamente: así las pruebas avanzan el
 * tiempo a mano, sin esperas reales, y un carro «detenido dos minutos» se prueba en milisegundos.
 */
'use strict';

/** Hora real del sistema, en milisegundos. */
class RelojSistema {
  ahora() { return Date.now(); }
}

/** Reloj de prueba: no avanza solo. */
class RelojFalso {
  constructor(inicio = 0) { this.t = inicio; }
  ahora() { return this.t; }
  avanzar(ms) { this.t += ms; return this.t; }
}

/**
 * Deja pasar un fotograma como mucho cada `1000 / fps` ms. Lo usa el carril para no procesar más de lo que pide el detector
 * de movimiento (1 fps en reposo, ~5 fps con movimiento) aunque la cámara entregue más.
 */
class Ritmo {
  constructor(reloj) {
    this.reloj = reloj;
    this.ultimo = -Infinity;
  }

  /** ¿Ya toca procesar otro fotograma a este fps? Si sí, lo cuenta como procesado. */
  listo(fps) {
    const ahora = this.reloj.ahora();
    // Un poco de holgura (5 %): una cámara a 5 fps exactos no debe perder uno de cada dos por milisegundos de diferencia.
    if (ahora - this.ultimo < (1000 / fps) * 0.95) return false;
    this.ultimo = ahora;
    return true;
  }
}

module.exports = { RelojSistema, RelojFalso, Ritmo };
