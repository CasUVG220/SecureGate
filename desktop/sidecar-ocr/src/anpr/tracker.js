/**
 * Seguimiento de vehículos y máquina de estados por pista (Sprint 10, tarea 3).
 *
 * Cada vehículo que aparece en el ROI recibe un `track_id` y lo conserva mientras se vea: así un carro que avanza, frena en la
 * talanquera o queda tapado un momento produce UNA sola decisión, no una por fotograma.
 *
 *   DETECTADO ──(framesConfirmar seguidos)──▶ SIGUIENDO ──(empieza a leerse)──▶ LEYENDO ──▶ CONFIRMADO (placa por consenso)
 *       │                                         │                              └──────▶ ILEGIBLE (4 s sin consenso o se fue)
 *       └──(se pierde)──▶ PERDIDO                 └──(se pierde)──▶ PERDIDO       CONFIRMADO / ILEGIBLE ──(se va)──▶ PASO
 *
 * Asociación por cuadro: primero por IoU (mayor primero, ≥ `iouMin`); lo que queda, por distancia de centroides (≤ `distanciaMax`
 * de la diagonal del cuadro y tamaño parecido). Una pista que deja de verse aguanta `framesPerdida` cuadros; después termina, pero
 * durante `ventanaReapertura_ms` una detección en el mismo lugar la **reabre** con el mismo id (oclusión larga de un vehículo
 * DETENIDO: un camión pasa por delante) en vez de crear una pista nueva. Solo se reabre una pista que estaba casi quieta y no
 * tocaba el borde del cuadro: la de un vehículo que se iba no se reabre, para que el SIGUIENTE vehículo que llega al mismo lugar
 * no herede su decisión.
 *
 * Una sola decisión por pista (`decidida`). Enfriamiento por placa: una placa confirmada no vuelve a decidirse hasta
 * `enfriamiento_ms` (60 s) después de la ÚLTIMA vez que se vio su vehículo; un carro estacionado que se re-detecta no genera
 * otro evento. Todos los tiempos salen del reloj inyectado.
 */
'use strict';

const { iou } = require('./detector');

const ESTADOS = Object.freeze({
  DETECTADO: 'DETECTADO',
  SIGUIENDO: 'SIGUIENDO',
  LEYENDO: 'LEYENDO',
  CONFIRMADO: 'CONFIRMADO',
  ILEGIBLE: 'ILEGIBLE',
  PASO: 'PASO',
  PERDIDO: 'PERDIDO',
});

const POR_DEFECTO = Object.freeze({
  iouMin: 0.2,
  /** Fracción de la diagonal del cuadro. */
  distanciaMax: 0.12,
  framesConfirmar: 2,
  framesPerdida: 8,
  ventanaReapertura_ms: 5000,
  tiempoMaxLectura_ms: 4000,
  enfriamiento_ms: 60_000,
});

function configurar(cfg = {}) {
  const c = { ...POR_DEFECTO, ...Object.fromEntries(Object.entries(cfg).filter(([, v]) => v !== undefined && v !== null)) };
  const rango = (k, min, max) => {
    if (!Number.isFinite(c[k]) || c[k] < min || c[k] > max) throw new Error(`Configuración del seguimiento inválida: ${k}=${c[k]} (entre ${min} y ${max})`);
  };
  rango('iouMin', 0.01, 0.99);
  rango('distanciaMax', 0.01, 1);
  rango('framesConfirmar', 1, 30);
  rango('framesPerdida', 1, 300);
  rango('ventanaReapertura_ms', 0, 120_000);
  rango('tiempoMaxLectura_ms', 500, 60_000);
  rango('enfriamiento_ms', 0, 3_600_000);
  return c;
}

const centro = (b) => [b.x + b.w / 2, b.y + b.h / 2];
const ACTIVOS = new Set([ESTADOS.DETECTADO, ESTADOS.SIGUIENDO, ESTADOS.LEYENDO, ESTADOS.CONFIRMADO, ESTADOS.ILEGIBLE]);

class Tracker {
  /**
   * @param {object} cfg  ver `POR_DEFECTO`
   * @param {{ahora(): number}} reloj
   * @param {string} prefijo  se antepone a los id de pista (el carril)
   */
  constructor(cfg, reloj, prefijo = 'p') {
    if (!reloj || typeof reloj.ahora !== 'function') throw new Error('Tracker necesita un reloj');
    this.cfg = configurar(cfg);
    this.reloj = reloj;
    this.prefijo = prefijo;
    this.secuencia = 0;
    /** Pistas vivas, por id. */
    this.pistas = new Map();
    /** Pistas terminadas que aún pueden reabrirse. */
    this.terminadas = [];
    /** placa → última vez (ms) que se vio un vehículo con esa placa confirmada. */
    this.placasVistas = new Map();
    /** Eventos producidos y aún no entregados (también los de `marcarLeyendo`/`confirmar`/`marcarIlegible`). */
    this.cola = [];
  }

  /** Entrega (y vacía) los eventos pendientes. `actualizar` ya los incluye; esto sirve justo después de confirmar. */
  tomarEventos() {
    return this.cola.splice(0);
  }

  /** Pistas vivas (copias superficiales, para mostrar). */
  activas() {
    return [...this.pistas.values()].map(p => ({ ...p }));
  }

  /** ¿Queda alguna pista que todavía no tiene decisión? El carril mantiene despierto el detector mientras sí. */
  hayPendientes() {
    for (const p of this.pistas.values()) if (!p.decidida) return true;
    return false;
  }

  obtener(id) {
    return this.pistas.get(id) ?? null;
  }

  /**
   * Procesa las detecciones (ya filtradas por ROI) de un cuadro de `ancho`×`alto`.
   * @returns {Array<object>} eventos: `{tipo: 'pista', evento: 'nueva'|'estado'|'reabierta'|'fin', ...}` y
   *          `{tipo: 'decision', resultado: 'ilegible', id, motivo}` cuando una pista se queda sin lectura (más los pendientes
   *          de llamadas anteriores, en orden).
   */
  actualizar(detecciones, ancho, alto) {
    const ts = this.reloj.ahora();
    const eventos = this.cola;
    const diag = Math.hypot(ancho, alto);
    const vivas = [...this.pistas.values()];
    const libresP = new Set(vivas.map(p => p.id));
    const libresD = new Set(detecciones.map((_, i) => i));
    const asignar = (p, d) => {
      libresP.delete(p.id);
      libresD.delete(d);
      this.#vista(p, detecciones[d], ts, eventos);
    };

    // 1) IoU, de mayor a menor.
    const pares = [];
    for (const p of vivas) {
      detecciones.forEach((d, i) => {
        const v = iou(p.bbox, d.bbox);
        if (v >= this.cfg.iouMin) pares.push([v, p, i]);
      });
    }
    pares.sort((a, b) => b[0] - a[0]);
    for (const [, p, i] of pares) if (libresP.has(p.id) && libresD.has(i)) asignar(p, i);

    // 2) Distancia de centroides para lo que quedó (movimiento rápido entre cuadros, caja que cambia de tamaño).
    for (const p of vivas.filter(x => libresP.has(x.id))) {
      let mejor = -1;
      let mejorDist = Infinity;
      for (const i of libresD) {
        const dist = this.#distancia(p.bbox, detecciones[i].bbox);
        if (dist <= this.cfg.distanciaMax * diag && dist < mejorDist && tamanoParecido(p.bbox, detecciones[i].bbox)) { mejor = i; mejorDist = dist; }
      }
      if (mejor >= 0) asignar(p, mejor);
    }

    // 3) Detecciones sin pista: reabrir una terminada hace poco en el mismo lugar, o pista nueva.
    this.terminadas = this.terminadas.filter(p => p.reabrible && ts - p.fin_ts <= this.cfg.ventanaReapertura_ms);
    for (const i of libresD) {
      const d = detecciones[i];
      const k = this.terminadas.findIndex(p => iou(p.bbox, d.bbox) >= this.cfg.iouMin
        || (this.#distancia(p.bbox, d.bbox) <= this.cfg.distanciaMax * diag && tamanoParecido(p.bbox, d.bbox)));
      if (k >= 0) {
        const p = this.terminadas.splice(k, 1)[0];
        p.estado = p.estadoAntesDeTerminar;
        delete p.fin_ts;
        delete p.estadoAntesDeTerminar;
        delete p.reabrible;
        this.pistas.set(p.id, p);
        eventos.push({ tipo: 'pista', evento: 'reabierta', id: p.id, estado: p.estado, bbox: d.bbox, ts });
        this.#vista(p, d, ts, eventos);
        continue;
      }
      const p = {
        id: `${this.prefijo}-${ts.toString(36)}-${++this.secuencia}`,
        estado: ESTADOS.DETECTADO,
        clase: d.clase,
        confianza: d.confianza,
        bbox: d.bbox,
        creada_ts: ts,
        ultima_ts: ts,
        cuadros: 1,
        seguidos: 1,
        perdidos: 0,
        decidida: false,
        placa: null,
        lectura_inicio_ts: null,
        historial: [centro(d.bbox)],
      };
      this.pistas.set(p.id, p);
      eventos.push({ tipo: 'pista', evento: 'nueva', id: p.id, estado: p.estado, bbox: p.bbox, clase: p.clase, ts });
      if (this.cfg.framesConfirmar <= 1) this.#cambiar(p, ESTADOS.SIGUIENDO, ts, eventos);
    }

    // 4) Pistas que no se vieron en este cuadro.
    for (const id of libresP) {
      const p = this.pistas.get(id);
      p.perdidos++;
      p.seguidos = 0;
      if (p.perdidos > this.cfg.framesPerdida) this.#terminar(p, ts, eventos, 'se_fue', ancho, alto);
    }

    // 5) Tiempo máximo de lectura.
    for (const p of this.pistas.values()) {
      if (p.estado === ESTADOS.LEYENDO && ts - p.lectura_inicio_ts >= this.cfg.tiempoMaxLectura_ms) {
        this.#cambiar(p, ESTADOS.ILEGIBLE, ts, eventos);
        p.decidida = true;
        eventos.push({ tipo: 'decision', resultado: 'ilegible', id: p.id, motivo: 'tiempo_max_lectura', ts });
      }
    }
    return this.tomarEventos();
  }

  /** SIGUIENDO → LEYENDO (el carril mandó la primera lectura). Idempotente. */
  marcarLeyendo(id) {
    const p = this.pistas.get(id);
    if (!p || p.estado !== ESTADOS.SIGUIENDO) return false;
    p.lectura_inicio_ts = this.reloj.ahora();
    this.#cambiar(p, ESTADOS.LEYENDO, p.lectura_inicio_ts, this.cola);
    return true;
  }

  /**
   * LEYENDO → CONFIRMADO con la placa del consenso. Devuelve si corresponde emitir la decisión: no, si la pista ya tenía una o
   * si la misma placa se vio hace menos de `enfriamiento_ms`.
   * @returns {{emitir: boolean, motivo?: 'ya_decidida'|'enfriamiento'|'no_leyendo'}}
   */
  confirmar(id, placa) {
    const p = this.pistas.get(id);
    if (!p) return { emitir: false, motivo: 'no_leyendo' };
    if (p.decidida) return { emitir: false, motivo: 'ya_decidida' };
    if (p.estado !== ESTADOS.LEYENDO) return { emitir: false, motivo: 'no_leyendo' };
    const ts = this.reloj.ahora();
    const vista = this.placasVistas.get(placa);
    p.placa = placa;
    p.decidida = true;
    this.#cambiar(p, ESTADOS.CONFIRMADO, ts, this.cola);
    this.placasVistas.set(placa, ts);
    if (vista != null && ts - vista < this.cfg.enfriamiento_ms) return { emitir: false, motivo: 'enfriamiento' };
    return { emitir: true };
  }

  /** LEYENDO → ILEGIBLE porque las lecturas no llegaron a consenso. Devuelve si corresponde emitir la decisión. */
  marcarIlegible(id) {
    const p = this.pistas.get(id);
    if (!p || p.decidida || p.estado !== ESTADOS.LEYENDO) return false;
    p.decidida = true;
    this.#cambiar(p, ESTADOS.ILEGIBLE, this.reloj.ahora(), this.cola);
    return true;
  }

  /** Olvida pistas y enfriamientos (al reconfigurar o pausar el carril). */
  reiniciar() {
    this.pistas.clear();
    this.terminadas = [];
    this.placasVistas.clear();
    this.cola = [];
  }

  #vista(p, d, ts, eventos) {
    p.bbox = d.bbox;
    p.clase = d.clase;
    p.confianza = d.confianza;
    p.ultima_ts = ts;
    p.cuadros++;
    p.seguidos++;
    p.perdidos = 0;
    p.historial.push(centro(d.bbox));
    if (p.historial.length > 4) p.historial.shift();
    if (p.placa) this.placasVistas.set(p.placa, ts);
    if (p.estado === ESTADOS.DETECTADO && p.seguidos >= this.cfg.framesConfirmar) this.#cambiar(p, ESTADOS.SIGUIENDO, ts, eventos);
  }

  #terminar(p, ts, eventos, motivo, ancho, alto) {
    this.pistas.delete(p.id);
    // ¿Se podrá reabrir? Solo si estaba casi quieta (≤ 1 % de la diagonal por cuadro) y lejos del borde del cuadro.
    const h = p.historial;
    const velocidad = h.length > 1 ? Math.hypot(h[h.length - 1][0] - h[0][0], h[h.length - 1][1] - h[0][1]) / (h.length - 1) : 0;
    const b = p.bbox;
    const enBorde = b.x <= 2 || b.y <= 2 || b.x + b.w >= ancho - 2 || b.y + b.h >= alto - 2;
    p.reabrible = velocidad <= 0.01 * Math.hypot(ancho, alto) && !enBorde;
    // Se fue mientras se leía: el agente debe saber que pasó un vehículo sin placa leída.
    if (p.estado === ESTADOS.LEYENDO && !p.decidida) {
      p.decidida = true;
      this.#cambiar(p, ESTADOS.ILEGIBLE, ts, eventos);
      eventos.push({ tipo: 'decision', resultado: 'ilegible', id: p.id, motivo: 'se_fue_sin_lectura', ts });
    }
    p.estadoAntesDeTerminar = p.estado;
    p.fin_ts = ts;
    const final = p.decidida ? ESTADOS.PASO : ESTADOS.PERDIDO;
    this.#cambiar(p, final, ts, eventos);
    eventos.push({ tipo: 'pista', evento: 'fin', id: p.id, estado: final, motivo, ts });
    this.terminadas.push(p);
  }

  #cambiar(p, estado, ts, eventos) {
    if (p.estado === estado) return;
    const anterior = p.estado;
    p.estado = estado;
    eventos.push({ tipo: 'pista', evento: 'estado', id: p.id, anterior, estado, ts });
  }

  #distancia(a, b) {
    const [ax, ay] = centro(a);
    const [bx, by] = centro(b);
    return Math.hypot(ax - bx, ay - by);
  }
}

/** Dos cajas de tamaño parecido (área entre la mitad y el doble): evita pegar una moto a la pista de un bus. */
function tamanoParecido(a, b) {
  const r = (a.w * a.h) / Math.max(1, b.w * b.h);
  return r >= 0.5 && r <= 2;
}

module.exports = { Tracker, ESTADOS, ACTIVOS, configurar, POR_DEFECTO };
