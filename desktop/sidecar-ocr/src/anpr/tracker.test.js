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

test('(b′) detenido y tapado MÁS que la tolerancia: la pista se reabre con el mismo id y no hay segundo evento', () => {
  const reloj = new RelojFalso();
  const t = new Tracker({ framesPerdida: 5 }, reloj);
  const cuadros = [...cruzando(10), ...Array.from({ length: 30 }, () => [caja(250, 260)]), ...vacios(12), ...Array.from({ length: 30 }, () => [caja(252, 258)])];
  const { decisiones, eventos } = correr(t, reloj, [...cuadros, ...vacios(10)], lecturaEn(3));
  assert.equal(decisiones.length, 1);
  assert.equal(eventos.filter(e => e.evento === 'nueva').length, 1);
  assert.equal(eventos.filter(e => e.evento === 'reabierta').length, 1);
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

test('configuración inválida y reloj obligatorio', () => {
  assert.throws(() => configurar({ iouMin: 0 }), /iouMin/);
  assert.throws(() => configurar({ tiempoMaxLectura_ms: 100 }), /tiempoMaxLectura_ms/);
  assert.equal(configurar({ enfriamiento_ms: null }).enfriamiento_ms, 60_000);
  assert.throws(() => new Tracker({}), /reloj/);
});
