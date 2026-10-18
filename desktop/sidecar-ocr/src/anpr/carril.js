/**
 * Un carril del ANPR (Sprint 10, tarea 4): une movimiento → detector → seguimiento → OCR → consenso para UNA cámara.
 *
 * Por cada fotograma (JPEG):
 *  1. Ritmo: si llegó antes de lo que pide el detector de movimiento, se descarta sin decodificar (1 fps en reposo).
 *  2. Movimiento en el ROI. El detector de vehículos corre a fps ACTIVO si hay movimiento (o se está confirmando) o queda alguna
 *     pista sin decidir (un carro que se detiene en la talanquera deja de «moverse» pero su placa todavía se está leyendo); en
 *     «vigilancia» (pistas ya decididas, sin movimiento: un carro detenido) corre al fps de REPOSO hasta que esas pistas terminen,
 *     así una pista no queda viva para siempre si el vehículo se fue entre dos cuadros; sin pistas ni movimiento no corre.
 *  3. Seguimiento: de cada cuadro en que se ve una pista (SIGUIENDO o LEYENDO) se guarda el recorte como candidato con su puntaje
 *     de calidad (se conservan los `maxCandidatos` mejores). La pista pasa a LEYENDO —y empieza a correr su tiempo máximo de
 *     lectura— con el primer recorte ÚTIL: un vehículo que entra tocando el borde del cuadro no gasta ese tiempo esperando.
 *  4. OCR: como mucho UNA lectura por cuadro (acota la latencia del cuadro), del mejor candidato aún no leído. La primera lectura de
 *     una pista usa la parte baja del vehículo; cuando ya se ubicó la placa, las siguientes recortan alrededor de ella (más rápido).
 *  5. Consenso: confirmada → `tracker.confirmar` (una decisión por pista, enfriamiento por placa); ilegible → `marcarIlegible`.
 *     Si al agotarse el tiempo (o al irse el vehículo) el consenso era confirmable pero solo con una corrección, el tracker lo
 *     cierra CONFIRMADO vía `alCerrarLectura` y la decisión sale con `requiere_verificacion`.
 *     Cada decisión sale con su evidencia (recorte de placa y de la parte baja del vehículo).
 *
 * El OCR es el MISMO de la captura por clic (`server.js::recognize`), inyectado como función.
 */
'use strict';

const { performance } = require('node:perf_hooks');
const { DetectorMovimiento } = require('./movimiento');
const { Tracker, ESTADOS } = require('./tracker');
const { Consenso, calidadRecorte, lecturaDeOcr, configurar: configurarConsenso } = require('./consenso');
const { recortesEvidencia, zonaInferior, conMargen } = require('./evidencia');
const { cargar, grisReducido, recortar, aJpeg, grisDe, varianzaLaplaciano } = require('./imagen');
const { normalizarPoligono } = require('./roi');
const { Ritmo } = require('./reloj');

const POR_DEFECTO = Object.freeze({
  anchoMovimiento: 160,
  maxCandidatos: 5,
  /** Ancho máximo del recorte que va al OCR (la placa sigue teniendo ≥ 40 px con vehículos a tamaño de carril). */
  maxAnchoOcr: 640,
  /** Margen alrededor de la placa ya ubicada para las lecturas siguientes. */
  margenRelectura: 0.6,
  /** Ancho mínimo del recorte de una relectura alrededor de la placa (se amplía si es menor). */
  minAnchoRelectura: 240,
  /** Margen a los lados de la caja del vehículo para la zona de lectura (ver `evidencia.zonaInferior`). */
  margenVehiculo: 0.12,
});

const r1 = (v) => Math.round(v * 10) / 10;

class Carril {
  /**
   * @param {{id: string, config?: object, reloj: {ahora(): number}, detector: {detectar: Function}, ocr: (jpeg: Buffer) => Promise<{texto: string, items: Array}>}} p
   */
  constructor({ id, config = {}, reloj, detector, ocr }) {
    if (!id || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) throw new Error('Id de carril inválido');
    if (!reloj || !detector || typeof ocr !== 'function') throw new Error('El carril necesita reloj, detector y OCR');
    this.id = id;
    this.reloj = reloj;
    this.detector = detector;
    this.ocr = ocr;
    this.configurar(config);
  }

  /** (Re)configura el carril. Olvida pistas, lecturas y enfriamientos. Lanza si la configuración no sirve. */
  configurar(config = {}) {
    const roi = normalizarPoligono(config.roi);
    this.cfg = { ...POR_DEFECTO, ...(config.carril ?? {}), roi };
    this.cfgConsenso = configurarConsenso(config.consenso);
    this.cfgEvidencia = config.evidencia ?? {};
    this.movimiento = new DetectorMovimiento({ ...(config.movimiento ?? {}), roi }, this.reloj);
    this.tracker = new Tracker(config.tracker ?? {}, this.reloj, this.id);
    this.tracker.alCerrarLectura = (id) => {
      const r = this.lecturas.get(id)?.consenso.cerrar();
      return r?.estado === 'confirmada' ? r.placa : null;
    };
    this.ritmo = new Ritmo(this.reloj);
    /** track_id → estado de lectura. */
    this.lecturas = new Map();
    this.fpsDeseado = this.movimiento.cfg.fpsReposo;
    this.ultimoTamano = null;
  }

  /**
   * Procesa un fotograma JPEG.
   * @returns {Promise<{procesado: boolean, fps_deseado: number, eventos: object[], pistas?: object[], tamano?: number[], ms?: object}>}
   */
  async procesar(jpeg) {
    if (!this.ritmo.listo(this.fpsDeseado)) return { procesado: false, fps_deseado: this.fpsDeseado, eventos: [] };
    const ms = { decodificar: 0, movimiento: 0, detector: 0, tracker: 0, ocr: 0, total: 0 };
    const t0 = performance.now();
    const img = await cargar(jpeg);
    const t1 = performance.now();
    ms.decodificar = r1(t1 - t0);
    this.ultimoTamano = [img.width, img.height];

    const mov = this.movimiento.procesar(grisReducido(img, this.cfg.anchoMovimiento));
    ms.movimiento = r1(performance.now() - t1);
    const eventos = mov.eventos.map(e => ({ ...e, carril: this.id }));

    const activo = this.movimiento.cfg.fpsActivo;
    const despierto = mov.activo || mov.sospecha || this.tracker.hayPendientes();
    const vigilancia = !despierto && this.tracker.activas().length > 0;
    if (despierto || vigilancia) {
      const det = await this.detector.detectar(img, { roi: this.cfg.roi });
      ms.detector = det.ms ?? 0;
      const t2 = performance.now();
      const evTracker = this.tracker.actualizar(det.cajas, img.width, img.height);
      const ahora = this.reloj.ahora();
      for (const p of this.tracker.activas()) {
        if ((p.estado !== ESTADOS.SIGUIENDO && p.estado !== ESTADOS.LEYENDO) || p.ultima_ts !== ahora) continue;
        if (this.#candidato(p, img) && p.estado === ESTADOS.SIGUIENDO) this.tracker.marcarLeyendo(p.id);
      }
      ms.tracker = r1(performance.now() - t2);
      eventos.push(...(await this.#entregar(evTracker)));

      const t3 = performance.now();
      eventos.push(...(await this.#leerUno()));
      ms.ocr = r1(performance.now() - t3);
      eventos.push(...(await this.#entregar(this.tracker.tomarEventos())));
    }
    this.fpsDeseado = despierto || this.tracker.hayPendientes() ? activo : mov.fpsDeseado;
    ms.total = r1(performance.now() - t0);
    return {
      procesado: true,
      fps_deseado: this.fpsDeseado,
      eventos,
      pistas: this.tracker.activas().map(p => ({ id: p.id, estado: p.estado, bbox: p.bbox, clase: p.clase, placa: p.placa })),
      tamano: this.ultimoTamano,
      movimiento: { activo: mov.activo, cambio: mov.cambio },
      ms,
    };
  }

  /** Guarda el recorte de este cuadro como candidato a lectura si vale la pena. Devuelve si lo guardó (recorte útil). */
  #candidato(p, img) {
    let l = this.lecturas.get(p.id);
    if (!l) {
      l = { consenso: new Consenso(this.cfgConsenso), candidatos: [], mejorPlaca: null, cajaRel: null, primeraValida: null, mejorVehiculo: null };
      this.lecturas.set(p.id, l);
    }
    const zona = recortar(img, zonaInferior(p.bbox, 0.45, this.cfg.margenVehiculo), 200);
    if (!zona) return false;
    const g = grisDe(zona.canvas);
    const calidad = calidadRecorte({ bbox: p.bbox, ancho: img.width, alto: img.height, nitidez: varianzaLaplaciano(g.gris, g.ancho, g.alto) });
    const cand = { img, bbox: { ...p.bbox }, calidad, ts: this.reloj.ahora() };
    // El mejor recorte visto (leído o no) sirve de evidencia del vehículo aunque nunca llegue a leerse.
    if (!l.mejorVehiculo || calidad > l.mejorVehiculo.calidad) l.mejorVehiculo = cand;
    if (calidad < this.cfgConsenso.calidadMin) return false;
    l.candidatos.push(cand);
    l.candidatos.sort((a, b) => b.calidad - a.calidad);
    l.candidatos.length = Math.min(l.candidatos.length, this.cfg.maxCandidatos);
    return true;
  }

  /** Lee con el OCR el mejor candidato pendiente (de cualquier pista que se esté leyendo) y aplica el consenso. */
  async #leerUno() {
    let elegido = null;
    for (const [id, l] of this.lecturas) {
      const p = this.tracker.obtener(id);
      if (!p || p.estado !== ESTADOS.LEYENDO || !l.candidatos.length || !l.consenso.abierto) continue;
      if (!elegido || l.candidatos[0].calidad > elegido.l.candidatos[0].calidad) elegido = { id, l };
    }
    if (!elegido) return [];
    const { id, l } = elegido;
    const cand = l.candidatos.shift();
    // Zona a leer: alrededor de la placa si ya se ubicó en una lectura anterior; si no, la parte baja del vehículo.
    const zonaPlaca = l.cajaRel && {
      x: cand.bbox.x + l.cajaRel.x * cand.bbox.w, y: cand.bbox.y + l.cajaRel.y * cand.bbox.h,
      w: l.cajaRel.w * cand.bbox.w, h: l.cajaRel.h * cand.bbox.h,
    };
    const zona = zonaPlaca
      ? recortar(cand.img, conMargen(zonaPlaca, this.cfg.margenRelectura), this.cfg.maxAnchoOcr, this.cfg.minAnchoRelectura)
      : recortar(cand.img, zonaInferior(cand.bbox, 0.3, this.cfg.margenVehiculo), this.cfg.maxAnchoOcr);
    if (!zona) return [];
    let ocr;
    try {
      ocr = await this.ocr(aJpeg(zona.canvas, 90));
    } catch {
      ocr = { texto: '', items: [] };
    }
    const lectura = lecturaDeOcr(ocr);
    const ts = this.reloj.ahora();
    if (lectura.caja_placa) {
      // Caja de la placa en píxeles del CUADRO (el recorte pudo reducirse).
      const esc = zona.ancho / zona.caja.w;
      const abs = {
        x: zona.caja.x + lectura.caja_placa.x / esc, y: zona.caja.y + lectura.caja_placa.y / esc,
        w: lectura.caja_placa.w / esc, h: lectura.caja_placa.h / esc,
      };
      l.cajaRel = { x: (abs.x - cand.bbox.x) / cand.bbox.w, y: (abs.y - cand.bbox.y) / cand.bbox.h, w: abs.w / cand.bbox.w, h: abs.h / cand.bbox.h };
      if (!l.mejorPlaca || lectura.confianza > l.mejorPlaca.confianza) l.mejorPlaca = { img: cand.img, bbox: cand.bbox, caja: abs, confianza: lectura.confianza };
    } else if (zonaPlaca) {
      l.cajaRel = null; // no se encontró donde se esperaba: la próxima vez, la parte baja completa
    }
    if (lectura.valida && l.primeraValida == null) l.primeraValida = ts;
    const r = l.consenso.agregar({ ...lectura, caja_placa: undefined });
    if (r.estado === 'confirmada') {
      const c = this.tracker.confirmar(id, r.placa);
      if (c.emitir) return [this.#decision(id, l, 'confirmada', r)];
      return [{ tipo: 'ignorada', carril: this.id, track_id: id, placa: r.placa, motivo: c.motivo, ts }];
    }
    if (r.estado === 'ilegible' && this.tracker.marcarIlegible(id)) return [this.#decision(id, l, 'ilegible', r)];
    return [];
  }

  /** Reenvía los eventos del tracker; las decisiones `ilegible` que él produce (tiempo, se fue) salen con su evidencia. */
  async #entregar(evTracker) {
    const out = [];
    for (const e of evTracker) {
      if (e.tipo === 'decision') {
        const l = this.lecturas.get(e.id) ?? { consenso: new Consenso(this.cfgConsenso) };
        if (e.resultado === 'confirmada') {
          // Confirmable que esperaba una lectura literal más: sale confirmada CON verificación (`cerrar`).
          if (e.enfriamiento) out.push({ tipo: 'ignorada', carril: this.id, track_id: e.id, placa: e.placa, motivo: 'enfriamiento', ts: e.ts });
          else out.push(this.#decision(e.id, l, 'confirmada', { ...l.consenso.cerrar(), motivo: e.motivo }));
        } else {
          out.push(this.#decision(e.id, l, 'ilegible', { ...l.consenso.resultado(), motivo: e.motivo }));
        }
      } else {
        const { id, ...resto } = e;
        out.push({ ...resto, track_id: id, carril: this.id });
        if (e.evento === 'fin') this.lecturas.delete(e.id);
      }
    }
    return out;
  }

  #decision(id, l, resultado, r) {
    const ts = this.reloj.ahora();
    const p = this.tracker.obtener(id);
    const fuente = l.mejorPlaca ?? l.mejorVehiculo ?? null;
    const evidencia = fuente
      ? recortesEvidencia(fuente.img, fuente.bbox, l.mejorPlaca ? l.mejorPlaca.caja : null, { ts, ...this.cfgEvidencia })
      : { placa_jpeg: null, vehiculo_jpeg: null, expira_ms: null, bytes: 0 };
    const decision = {
      tipo: 'decision',
      carril: this.id,
      track_id: id,
      resultado,
      placa: resultado === 'confirmada' ? r.placa : null,
      placa_probable: r.placa ?? null,
      confianza: r.confianza ?? 0,
      votos: r.votos ?? 0,
      lecturas: (l.consenso?.lecturas ?? []).map(x => ({ texto: x.texto, valida: x.valida, correcciones: x.correcciones, confianza: x.confianza })),
      requiere_verificacion: resultado !== 'confirmada' || !!r.requiere_verificacion,
      alguna_correccion: !!r.alguna_correccion,
      motivo: r.motivo ?? null,
      clase: p?.clase ?? null,
      ts,
      ms_desde_legible: l.primeraValida == null ? null : ts - l.primeraValida,
      evidencia,
    };
    // Las imágenes de los candidatos ya no hacen falta: se sueltan para no retener cuadros en memoria.
    if (l.candidatos) l.candidatos.length = 0;
    l.mejorVehiculo = null;
    l.mejorPlaca = null;
    return decision;
  }
}

module.exports = { Carril, POR_DEFECTO };
