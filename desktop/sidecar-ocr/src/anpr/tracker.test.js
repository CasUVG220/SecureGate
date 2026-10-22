'use strict';
// Tarea 3 (Sprint 10): seguimiento y máquina de estados con trayectorias SINTÉTICAS y reloj falso. Los casos (a)–(e) son los
// criterios de aceptación del sprint.
const test = require('node:test');
const assert = require('node:assert/strict');

const { Tracker, ESTADOS, configurar } = require('./tracker');
const { RelojFalso } = require('./reloj');

const W = 960;
const H = 540;
const FPS = 5;
const PASO_MS = 1000 / FPS;

const caja = (x, y, w = 300, h = 180) => ({ clase: 'carro', confianza: 0.9, bbox: { x, y, w, h } });

/**
 * Conductor mínimo, como el carril: cada pista que llega a SIGUIENDO empieza a leerse; `lectura(pista, n)` dice qué placa sale
 * del consenso en el cuadro `n` de lectura (o null si aún no). Devuelve las decisiones emitidas y todos los eventos.
 */
function correr(tracker, reloj, cuadros, lectura = () => 'P123ABC') {
  const decisiones = [];
  const eventos = [];
  const leidos = new Map();
  for (const dets of cuadros) {
    const ev = tracker.actualizar(dets, W, H);
    eventos.push(...ev);
    for (const e of ev) if (e.tipo === 'decision') decisiones.push({ id: e.id, resultado: e.resultado, motivo: e.motivo });
    for (const p of tracker.activas()) {
      if (p.estado === ESTADOS.SIGUIENDO) tracker.marcarLeyendo(p.id);
      if (tracker.obtener(p.id).estado === ESTADOS.LEYENDO) {
        const n = (leidos.get(p.id) ?? 0) + 1;
        leidos.set(p.id, n);
        const placa = lectura(p, n);
        if (placa) {
          const r = tracker.confirmar(p.id, placa);
          if (r.emitir) decisiones.push({ id: p.id, resultado: 'confirmada', placa });
          else eventos.push({ tipo: 'ignorada', id: p.id, motivo: r.motivo });
        }
      }
    }
    reloj.avanzar(PASO_MS);
  }
  return { decisiones, eventos };
}

/** Un vehículo que entra por abajo y sale por arriba a la izquierda en `n` cuadros (se mueve ~20 px por cuadro). */
const cruzando = (n = 30, x0 = 330, y0 = 360) => Array.from({ length: n }, (_, i) => [caja(x0 - i * 8, y0 - i * 10)]);
const vacios = (n) => Array.from({ length: n }, () => []);
const lecturaEn = (k, placa = 'P123ABC') => (_p, n) => (n >= k ? placa : null);

test('(a) un carro cruzando = una pista y un evento; al irse la pista termina en PASO', () => {
  const reloj = new RelojFalso();
  const t = new Tracker({}, reloj, 'c1');
  const { decisiones, eventos } = correr(t, reloj, [...vacios(3), ...cruzando(), ...vacios(12)], lecturaEn(4));
  assert.deepEqual(decisiones.map(d => d.resultado), ['confirmada']);
  const nuevas = eventos.filter(e => e.evento === 'nueva');
  assert.equal(nuevas.length, 1);
  const fin = eventos.find(e => e.evento === 'fin');
  assert.equal(fin.estado, ESTADOS.PASO);
  assert.match(nuevas[0].id, /^c1-/);
  // El recorrido de estados es el de la máquina: DETECTADO → SIGUIENDO → LEYENDO → CONFIRMADO → PASO.
  const estados = eventos.filter(e => e.evento === 'estado').map(e => e.estado);
  assert.deepEqual(estados, [ESTADOS.SIGUIENDO, ESTADOS.LEYENDO, ESTADOS.CONFIRMADO, ESTADOS.PASO]);
  assert.equal(t.activas().length, 0);
});

test('(b) un carro detenido 2 minutos en el ROI = un evento, aunque el detector lo pierda a ratos', () => {
  const reloj = new RelojFalso();
  const t = new Tracker({}, reloj);
  const cuadros = [...cruzando(10)];
  // 2 min a 5 fps = 600 cuadros quieto; cada 40 cuadros el detector lo pierde 3 cuadros (menos que framesPerdida).
  for (let i = 0; i < 600; i++) cuadros.push(i % 40 < 3 && i > 10 ? [] : [caja(250, 260)]);
  const { decisiones, eventos } = correr(t, reloj, [...cuadros, ...vacios(12)], lecturaEn(3));
  assert.equal(decisiones.length, 1);
  assert.equal(eventos.filter(e => e.evento === 'nueva').length, 1);
  assert.equal(eventos.filter(e => e.tipo === 'ignorada').length, 0, 'ni siquiera intenta decidir otra vez');
});

test('(b′) detenido y tapado MÁS que la tolerancia: no hay segundo evento (con placa, el enfriamiento; sin placa, se reabre la pista)', () => {
  const quieto = (n, x = 250, y = 260) => Array.from({ length: n }, () => [caja(x, y)]);
  const cuadros = [...cruzando(10), ...quieto(30), ...vacios(12), ...quieto(30, 252, 258), ...vacios(10)];
  // Con la placa ya confirmada: pista nueva que vuelve a leer la misma placa → «ignorada» por enfriamiento.
  const reloj = new RelojFalso();
  const t = new Tracker({ framesPerdida: 5 }, reloj);
  const r = correr(t, reloj, cuadros, lecturaEn(3));
  assert.equal(r.decisiones.length, 1);
  assert.equal(r.eventos.filter(e => e.evento === 'reabierta').length, 0);
  assert.deepEqual(r.eventos.filter(e => e.tipo === 'ignorada').map(e => e.motivo), ['enfriamiento']);
  // Ilegible (sin placa): la pista se reabre con el mismo id y no hay un segundo «ilegible».
  const reloj2 = new RelojFalso();
  const t2 = new Tracker({ framesPerdida: 5, tiempoMaxLectura_ms: 2000 }, reloj2);
  const r2 = correr(t2, reloj2, cuadros, () => null);
  assert.deepEqual(r2.decisiones.map(d => [d.resultado, d.motivo]), [['ilegible', 'tiempo_max_lectura']]);
  assert.equal(r2.eventos.filter(e => e.evento === 'nueva').length, 1);
  assert.equal(r2.eventos.filter(e => e.evento === 'reabierta').length, 1);
});

test('cola en la talanquera: otro carro llega al lugar donde se perdió el anterior (ya decidido) a los pocos segundos y tiene SU decisión', () => {
  // Caso de la medición (tarea 7): P123ABC se pierde casi quieto frente a la talanquera y P555TRK aparece ahí 4–5 s después.
  // Antes heredaba la pista ya decidida y pasaba sin evento.
  const reloj = new RelojFalso();
  const t = new Tracker({ framesPerdida: 5 }, reloj);
  const placas = ['P123ABC', 'P555TRK'];
  const ids = [];
  const lectura = (p, k) => { if (!ids.includes(p.id)) ids.push(p.id); return k >= 3 ? placas[ids.indexOf(p.id)] : null; };
  const quieto = Array.from({ length: 20 }, () => [caja(250, 260)]);
  const { decisiones, eventos } = correr(t, reloj, [...cruzando(8), ...quieto, ...vacios(15), ...Array.from({ length: 20 }, () => [caja(256, 262)]), ...vacios(10)], lectura);
  assert.deepEqual(decisiones.map(d => d.placa), ['P123ABC', 'P555TRK']);
  assert.equal(eventos.filter(e => e.evento === 'reabierta').length, 0);
});

test('(c) dos carros seguidos = dos pistas y dos eventos', () => {
  const reloj = new RelojFalso();
  const t = new Tracker({}, reloj);
  const placas = ['P555TRK', 'U318BCD'];
  let n = 0;
  const lectura = (p, k) => (k >= 3 ? placas[[...new Set(lecturaIds)].indexOf(p.id)] : null);
  const lecturaIds = [];
  const envoltorio = (p, k) => { lecturaIds.push(p.id); n++; return lectura(p, k); };
  const { decisiones } = correr(t, reloj, [...vacios(3), ...cruzando(30), ...vacios(10), ...cruzando(30), ...vacios(12)], envoltorio);
  assert.deepEqual(decisiones.map(d => d.placa), placas);
  assert.notEqual(decisiones[0].id, decisiones[1].id);
  assert.ok(n > 0);
});

test('(c′) el segundo carro llega a la talanquera poco después de que el primero se fue: NO hereda la pista del primero', () => {
  const reloj = new RelojFalso();
  const t = new Tracker({}, reloj);
  const placas = new Map();
  const lectura = (p, k) => { if (!placas.has(p.id)) placas.set(p.id, placas.size ? 'U318BCD' : 'P555TRK'); return k >= 3 ? placas.get(p.id) : null; };
  // El primero se detiene en (250,260) y luego sale rápido hacia arriba a la izquierda; el segundo llega al mismo punto 1 s después.
  const primero = [...cruzando(10), ...Array.from({ length: 10 }, () => [caja(250, 260)]), ...Array.from({ length: 12 }, (_, i) => [caja(250 - i * 25, 260 - i * 22)])];
  const segundo = [...Array.from({ length: 10 }, (_, i) => [caja(330 - i * 8, 360 - i * 10)]), ...Array.from({ length: 10 }, () => [caja(250, 260)])];
  const { decisiones } = correr(t, reloj, [...primero, ...vacios(5), ...segundo, ...vacios(12)], lectura);
  assert.deepEqual(decisiones.map(d => d.placa), ['P555TRK', 'U318BCD']);
});

test('(d) una oclusión corta no parte la pista en dos', () => {
  const reloj = new RelojFalso();
  const t = new Tracker({ framesPerdida: 8 }, reloj);
  const tray = cruzando(30);
  for (let i = 12; i < 17; i++) tray[i] = []; // 5 cuadros (1 s) sin detección: alguien pasa por delante
  const { decisiones, eventos } = correr(t, reloj, [...vacios(2), ...tray, ...vacios(12)], lecturaEn(20));
  assert.equal(eventos.filter(e => e.evento === 'nueva').length, 1);
  assert.equal(decisiones.length, 1);
});

test('(e) la misma placa dentro de 60 s se ignora; pasado el enfriamiento vuelve a decidirse', () => {
  const reloj = new RelojFalso();
  const t = new Tracker({}, reloj);
  const ida = [...vacios(2), ...cruzando(30), ...vacios(12)];
  const r1 = correr(t, reloj, ida, lecturaEn(3));
  assert.equal(r1.decisiones.length, 1);
  reloj.avanzar(20_000); // ~30 s después de verla por última vez
  const r2 = correr(t, reloj, ida, lecturaEn(3));
  assert.equal(r2.decisiones.length, 0, 'misma placa dentro de los 60 s');
  assert.deepEqual(r2.eventos.filter(e => e.tipo === 'ignorada').map(e => e.motivo), ['enfriamiento']);
  reloj.avanzar(61_000);
  const r3 = correr(t, reloj, ida, lecturaEn(3));
  assert.equal(r3.decisiones.length, 1, 'pasado el enfriamiento sí');
  // Otra placa dentro de los 60 s no se frena.
  const r4 = correr(t, reloj, ida, lecturaEn(3, 'C458DFG'));
  assert.equal(r4.decisiones.length, 1);
});

test('tiempo máximo de lectura: sin consenso en 4 s la pista queda ILEGIBLE con UNA decisión', () => {
  const reloj = new RelojFalso();
  const t = new Tracker({ tiempoMaxLectura_ms: 4000 }, reloj);
  const quieto = Array.from({ length: 60 }, () => [caja(250, 260)]);
  const { decisiones, eventos } = correr(t, reloj, [...quieto, ...vacios(12)], () => null);
  assert.deepEqual(decisiones, [{ id: decisiones[0].id, resultado: 'ilegible', motivo: 'tiempo_max_lectura' }]);
  const aIlegible = eventos.find(e => e.estado === ESTADOS.ILEGIBLE);
  const aLeyendo = eventos.find(e => e.estado === ESTADOS.LEYENDO);
  assert.ok(aIlegible.ts - aLeyendo.ts >= 4000 && aIlegible.ts - aLeyendo.ts < 4000 + 2 * PASO_MS);
  assert.equal(eventos.find(e => e.evento === 'fin').estado, ESTADOS.PASO);
});

test('se va mientras se leía: ILEGIBLE (el agente debe saber que pasó un vehículo) y la pista termina en PASO', () => {
  const reloj = new RelojFalso();
  const t = new Tracker({}, reloj);
  const { decisiones, eventos } = correr(t, reloj, [...cruzando(8), ...vacios(12)], () => null);
  assert.deepEqual(decisiones.map(d => [d.resultado, d.motivo]), [['ilegible', 'se_fue_sin_lectura']]);
  assert.equal(eventos.find(e => e.evento === 'fin').estado, ESTADOS.PASO);
});

test('al cerrar sin consenso, si el carril ya tenía una placa confirmable (alCerrarLectura) la pista sale CONFIRMADA y entra al enfriamiento', () => {
  const reloj = new RelojFalso();
  const t = new Tracker({ tiempoMaxLectura_ms: 4000 }, reloj);
  const consultadas = [];
  t.alCerrarLectura = (id) => { consultadas.push(id); return 'P123ABC'; };
  const quieto = Array.from({ length: 30 }, () => [caja(250, 260)]);
  const primero = correr(t, reloj, [...quieto, ...vacios(12)], () => null);
  const dec = primero.eventos.filter(e => e.tipo === 'decision');
  assert.deepEqual(dec.map(e => [e.resultado, e.placa, e.motivo, e.enfriamiento]), [['confirmada', 'P123ABC', 'tiempo_max_lectura', false]]);
  assert.equal(consultadas.length, 1);
  assert.ok(primero.eventos.some(e => e.estado === ESTADOS.CONFIRMADO));
  assert.equal(primero.eventos.find(e => e.evento === 'fin').estado, ESTADOS.PASO);

  // La misma placa poco después (pasada la ventana de reapertura, dentro de los 60 s), ahora cerrando porque se va: sale
  // marcada en enfriamiento (el carril no la decide otra vez).
  reloj.avanzar(10_000);
  const segundo = correr(t, reloj, [...cruzando(8), ...vacios(12)], () => null);
  assert.deepEqual(segundo.eventos.filter(e => e.tipo === 'decision').map(e => [e.resultado, e.motivo, e.enfriamiento]),
    [['confirmada', 'se_fue_sin_lectura', true]]);

  // Sin placa confirmable (null) todo sigue como antes: ILEGIBLE. Y a una pista que nunca se leyó no se le pregunta.
  const t2 = new Tracker({}, reloj);
  t2.alCerrarLectura = () => null;
  const r2 = correr(t2, reloj, [...cruzando(8), ...vacios(12)], () => null);
  assert.deepEqual(r2.decisiones.map(d => [d.resultado, d.motivo]), [['ilegible', 'se_fue_sin_lectura']]);
  const t3 = new Tracker({}, reloj);
  let preguntas = 0;
  t3.alCerrarLectura = () => { preguntas++; return 'P123ABC'; };
  const ev3 = [];
  for (const dets of [...cruzando(6), ...vacios(12)]) { ev3.push(...t3.actualizar(dets, W, H)); reloj.avanzar(PASO_MS); }
  assert.deepEqual(ev3.filter(e => e.tipo === 'decision').map(e => [e.resultado, e.motivo]), [['ilegible', 'sin_recorte_util']]);
  assert.equal(preguntas, 0);
});

test('un vehículo seguido varios cuadros del que nunca hubo un recorte útil también sale ILEGIBLE (sin_recorte_util)', () => {
  const reloj = new RelojFalso();
  const t = new Tracker({}, reloj);
  const eventos = [];
  // Nadie llama a marcarLeyendo: el carril nunca encontró un recorte útil (p. ej. siempre tocando el borde).
  for (const dets of [...cruzando(6), ...vacios(12)]) { eventos.push(...t.actualizar(dets, W, H)); reloj.avanzar(PASO_MS); }
  assert.deepEqual(eventos.filter(e => e.tipo === 'decision').map(e => e.motivo), ['sin_recorte_util']);
  assert.equal(eventos.find(e => e.evento === 'fin').estado, ESTADOS.PASO);
});

test('una detección suelta (un cuadro) no llega a SIGUIENDO, no se lee y termina PERDIDA sin decisión', () => {
  const reloj = new RelojFalso();
  const t = new Tracker({}, reloj);
  const { decisiones, eventos } = correr(t, reloj, [[caja(100, 100)], ...vacios(12)]);
  assert.equal(decisiones.length, 0);
  assert.equal(eventos.find(e => e.evento === 'fin').estado, ESTADOS.PERDIDO);
});

test('confirmar/marcarIlegible: una sola decisión por pista y solo desde LEYENDO', () => {
  const reloj = new RelojFalso();
  const t = new Tracker({ framesConfirmar: 1 }, reloj);
  t.actualizar([caja(100, 100)], W, H);
  const [p] = t.activas();
  assert.equal(p.estado, ESTADOS.SIGUIENDO, 'framesConfirmar=1 pasa directo a SIGUIENDO');
  assert.deepEqual(t.confirmar(p.id, 'P123ABC'), { emitir: false, motivo: 'no_leyendo' });
  assert.equal(t.marcarIlegible(p.id), false);
  assert.equal(t.marcarLeyendo(p.id), true);
  assert.equal(t.marcarLeyendo(p.id), false, 'idempotente');
  assert.equal(t.hayPendientes(), true);
  assert.deepEqual(t.confirmar(p.id, 'P123ABC'), { emitir: true });
  assert.deepEqual(t.confirmar(p.id, 'P123ABC'), { emitir: false, motivo: 'ya_decidida' });
  assert.equal(t.marcarIlegible(p.id), false);
  assert.equal(t.hayPendientes(), false);
  assert.deepEqual(t.confirmar('no-existe', 'X'), { emitir: false, motivo: 'no_leyendo' });
  t.reiniciar();
  assert.equal(t.activas().length, 0);
});

test('asociación: por IoU primero; por centroide si el salto es grande pero el tamaño parecido; nunca moto con bus', () => {
  const reloj = new RelojFalso();
  const t = new Tracker({}, reloj);
  t.actualizar([caja(100, 100, 200, 120)], W, H);
  const id = t.activas()[0].id;
  t.actualizar([caja(190, 150, 200, 120)], W, H); // IoU bajo (0.13) pero centroide cerca: misma pista
  assert.deepEqual(t.activas().map(p => p.id), [id]);
  t.actualizar([{ clase: 'moto', confianza: 0.9, bbox: { x: 230, y: 180, w: 60, h: 40 } }], W, H); // tamaño muy distinto
  assert.equal(t.activas().length, 2);
});

test('una caja extra dentro del vehículo que ya se sigue (su mitad trasera) no abre una segunda pista: un vehículo, un evento', () => {
  const reloj = new RelojFalso();
  const t = new Tracker({}, reloj);
  // Caso real (clip «entrada_c458dfg»): el carro y, a ratos, una caja débil sobre su mitad trasera (contenida ~70 %).
  const cuadros = Array.from({ length: 30 }, (_, i) => {
    const carro = caja(130 - i * 2, 320 - i * 3, 620, 218);
    const mitad = { clase: 'carro', confianza: 0.4, bbox: { x: carro.bbox.x + 300, y: carro.bbox.y - 6, w: 396, h: 189 } };
    return i % 3 === 0 ? [carro] : [carro, mitad];
  });
  const { decisiones, eventos } = correr(t, reloj, [...cuadros, ...vacios(12)], lecturaEn(3));
  assert.equal(eventos.filter(e => e.evento === 'nueva').length, 1);
  assert.equal(decisiones.length, 1);
  // Un segundo vehículo de verdad al lado (fuera de la caja del primero) sí abre su pista, y una moto delante del carro también.
  const t2 = new Tracker({}, reloj);
  const moto = { clase: 'moto', confianza: 0.8, bbox: { x: 150, y: 350, w: 80, h: 100 } };
  const dos = Array.from({ length: 6 }, () => [caja(100, 300, 300, 180), caja(500, 300, 300, 180), moto]);
  const r2 = correr(t2, reloj, dos, () => null);
  assert.equal(r2.eventos.filter(e => e.evento === 'nueva').length, 3);
});

test('una pista vieja y chica NO se pega a un vehículo grande que llega al mismo lugar aunque se solapen', () => {
  // Caso real del clip «dos_seguidos»: la pista del primero (ya decidida) quedó a la izquierda y el segundo llegó solapándola
  // (IoU 0,23) con el doble y medio de área. Antes la heredaba y el segundo vehículo pasaba sin decisión.
  const reloj = new RelojFalso();
  const t = new Tracker({ framesConfirmar: 1, perdida_ms: 60_000, framesPerdida: 50 }, reloj);
  t.actualizar([caja(10, 253, 377, 206)], W, H);
  const viejo = t.activas()[0].id;
  t.marcarLeyendo(viejo);
  t.confirmar(viejo, 'P555TRK');
  reloj.avanzar(200);
  t.actualizar([], W, H);
  reloj.avanzar(200);
  t.actualizar([caja(53, 296, 831, 244)], W, H);
  const ids = t.activas().map(p => p.id);
  assert.equal(ids.length, 2, 'una pista nueva para el vehículo que llega');
  assert.ok(ids.includes(viejo));
});

test('pérdida por tiempo: a 1 fps (vigilancia) una pista que no se ve por más de 2 s termina, sin esperar 8 cuadros', () => {
  const reloj = new RelojFalso();
  const t = new Tracker({ framesConfirmar: 1 }, reloj);
  t.actualizar([caja(300, 200)], W, H);
  const eventos = [];
  for (let i = 0; i < 3; i++) { reloj.avanzar(1000); eventos.push(...t.actualizar([], W, H)); }
  assert.equal(eventos.filter(e => e.evento === 'fin').length, 1);
  assert.equal(t.activas().length, 0);
});

test('un vehículo que sale por el borde del cuadro termina a los 2 cuadros sin verlo y no se reabre', () => {
  const reloj = new RelojFalso();
  const t = new Tracker({ framesConfirmar: 1 }, reloj);
  t.actualizar([caja(0, 250, 300, 180)], W, H);
  reloj.avanzar(200);
  t.actualizar([], W, H);
  assert.equal(t.activas().length, 1);
  reloj.avanzar(200);
  const ev = t.actualizar([], W, H);
  assert.deepEqual(ev.filter(e => e.evento === 'fin').map(e => e.motivo), ['salio_del_cuadro']);
  reloj.avanzar(200);
  t.actualizar([caja(0, 250, 300, 180)], W, H);
  assert.equal(t.activas()[0].cuadros, 1, 'pista nueva, no reabierta');
});

/**
 * Tres vehículos a la vez (seguimiento del Sprint 10, tarea 4). A y B entran al mismo tiempo y se CRUZAN (A de izquierda a
 * derecha, B al revés, B por delante —más abajo en el cuadro—: A queda tapado en parte y unos cuadros del todo); C llega 3 s después (< 5 s) desde abajo
 * y se detiene en la talanquera mientras A y B todavía están en el cuadro. Las cajas son las que vería el detector: la parte
 * visible del vehículo tapado o ninguna. La placa que «lee» cada pista es la del vehículo cuya caja tiene en ESE cuadro: si una
 * pista saltara de un vehículo a otro, se notaría.
 */
function tresALaVez() {
  const ANCHO = 240;
  const ALTO = 140;
  const cuadros = [];
  for (let i = 0; i < 48; i++) {
    const dets = [];
    const xA = 40 + i * 24;
    const xB = 680 - i * 24;
    const visibleA = (() => {
      if (i >= 30) return null; // A ya salió por la derecha
      const solape = ANCHO - Math.abs(xA - xB);
      if (i >= 29 || solape <= 0) return { x: xA, w: ANCHO };
      if (solape > ANCHO * 0.55) return null; // B lo tapa casi entero
      // B tapa el lado de A que tiene enfrente: queda visible la parte del otro lado.
      return xA < xB ? { x: xA, w: xB - xA } : { x: xB + ANCHO, w: xA + ANCHO - (xB + ANCHO) };
    })();
    if (visibleA && i < 30) dets.push({ vehiculo: 'A', clase: 'carro', confianza: 0.9, bbox: { x: visibleA.x, y: 250, w: visibleA.w, h: ALTO } });
    if (i < 29) dets.push({ vehiculo: 'B', clase: 'carro', confianza: 0.92, bbox: { x: xB, y: 300, w: ANCHO, h: ALTO } });
    if (i >= 15) {
      const k = i - 15;
      const y = Math.max(150, 390 - k * 24); // sube y se detiene en y=150 (la talanquera)
      dets.push({ vehiculo: 'C', clase: 'carro', confianza: 0.95, bbox: { x: 360, y, w: 250, h: 150 } });
    }
    // El orden de las cajas no debe importar.
    cuadros.push(i % 2 ? dets.reverse() : dets);
  }
  return cuadros;
}

const PLACAS_TRES = { A: 'P111AAA', B: 'C222BBB', C: 'M333CCC' };

/** Corre `tresALaVez` con el conductor del carril; `lecturasPara[v]` = cuántas lecturas necesita el vehículo v para confirmar. */
function correrTres(lecturasPara = { A: 3, B: 3, C: 3 }) {
  const reloj = new RelojFalso();
  const t = new Tracker({}, reloj, 'c1');
  const PLACAS = PLACAS_TRES;
  const cuadros = [...vacios(2), ...tresALaVez(), ...vacios(12)];
  // Qué vehículo tiene cada pista en cada cuadro (por la caja que le asignó el tracker).
  const seguidos = new Map();
  let deEsteCuadro = new Map();
  const lectura = (p, n) => {
    const v = deEsteCuadro.get(p.bbox);
    if (!v) return null;
    if (!seguidos.has(p.id)) seguidos.set(p.id, new Set());
    seguidos.get(p.id).add(v);
    return n >= lecturasPara[v] ? PLACAS[v] : null;
  };
  const decisiones = [];
  const eventos = [];
  const leidos = new Map();
  for (const dets of cuadros) {
    deEsteCuadro = new Map(dets.map(d => [d.bbox, d.vehiculo]));
    const ev = t.actualizar(dets, W, H);
    eventos.push(...ev);
    for (const e of ev) if (e.tipo === 'decision') decisiones.push({ id: e.id, resultado: e.resultado });
    // Lo que el tracker siguió en este cuadro también cuenta para las pistas que no se leen (ya decididas).
    for (const p of t.activas()) {
      const v = deEsteCuadro.get(p.bbox);
      if (v && p.ultima_ts === reloj.ahora()) { if (!seguidos.has(p.id)) seguidos.set(p.id, new Set()); seguidos.get(p.id).add(v); }
      if (p.estado === ESTADOS.SIGUIENDO) t.marcarLeyendo(p.id);
      if (t.obtener(p.id)?.estado === ESTADOS.LEYENDO && p.ultima_ts === reloj.ahora()) {
        const n = (leidos.get(p.id) ?? 0) + 1;
        leidos.set(p.id, n);
        const placa = lectura(t.obtener(p.id), n);
        if (placa) {
          const r = t.confirmar(p.id, placa);
          if (r.emitir) decisiones.push({ id: p.id, resultado: 'confirmada', placa });
          else eventos.push({ tipo: 'ignorada', id: p.id, motivo: r.motivo });
        }
      }
    }
    reloj.avanzar(PASO_MS);
  }
  return { t, decisiones, eventos, seguidos };
}

function verificarTres({ t, decisiones, eventos, seguidos }) {
  const PLACAS = PLACAS_TRES;
  // Cada pista siguió UN solo vehículo (nunca saltó al que la cruzaba): ninguna decisión heredada.
  for (const [id, vs] of seguidos) assert.equal(vs.size, 1, `la pista ${id} siguió a ${[...vs].join(' y ')}`);
  // Un evento por vehículo, cada uno con su placa y su pista; ni duplicados ni lecturas cruzadas.
  assert.deepEqual(decisiones.map(d => d.placa).sort(), Object.values(PLACAS).sort());
  assert.equal(new Set(decisiones.map(d => d.id)).size, 3);
  for (const d of decisiones) assert.deepEqual([...seguidos.get(d.id)], [Object.keys(PLACAS).find(k => PLACAS[k] === d.placa)]);
  assert.equal(eventos.filter(e => e.tipo === 'ignorada').length, 0);
  assert.equal(eventos.filter(e => e.evento === 'reabierta').length, 0);
  // Las tres pistas llegaron a estar vivas a la vez.
  assert.ok(eventos.filter(e => e.evento === 'nueva').length >= 3);
  assert.equal(t.activas().length, 0, 'al final todas terminaron');
  assert.equal(seguidos.size, 3, 'tres pistas, ni una más (el tapado no abre otra al reaparecer)');
}

test('(f) tres vehículos en el mismo cuadro, cruzándose y tapándose: una pista, una lectura y un evento por vehículo', () => {
  verificarTres(correrTres());
});

test('(f′) el vehículo tapado todavía no tenía placa: al reaparecer sigue SU pista y su lectura (sin «ilegible» de más)', () => {
  // A necesita 12 lecturas: se tapa a la mitad de su lectura y la termina del otro lado del que lo tapaba.
  const r = correrTres({ A: 12, B: 3, C: 3 });
  verificarTres(r);
  assert.equal(r.decisiones.filter(d => d.resultado === 'ilegible').length, 0);
});

test('configuración inválida y reloj obligatorio', () => {
  assert.throws(() => configurar({ iouMin: 0 }), /iouMin/);
  assert.throws(() => configurar({ tiempoMaxLectura_ms: 100 }), /tiempoMaxLectura_ms/);
  assert.equal(configurar({ enfriamiento_ms: null }).enfriamiento_ms, 60_000);
  assert.throws(() => new Tracker({}), /reloj/);
});
