'use strict';
// Tarea 1 (Sprint 10): detección de movimiento en el ROI con fotogramas SINTÉTICOS y reloj falso (sin esperas reales).
const test = require('node:test');
const assert = require('node:assert/strict');

const { DetectorMovimiento, configurar, suavizar } = require('./movimiento');
const { RelojFalso, Ritmo, RelojSistema } = require('./reloj');
const { normalizarPoligono, puntoEnPoligono, mascara, fraccionDentro, CUADRO_COMPLETO } = require('./roi');
const { rgbaAGris, varianzaLaplaciano, acotarCaja } = require('./imagen');

const W = 160;
const H = 90;

/** Generador pseudoaleatorio determinista (mulberry32): el «ruido de sensor» es el mismo en cada corrida. */
function prng(semilla) {
  let a = semilla >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Cuadro de 160×90: fondo gris con un degradado (asfalto), ruido de ±`ruido` y los rectángulos `objetos` ({x,y,w,h,v}).
 * `brillo` suma a todo el cuadro (cambio de exposición).
 */
function cuadro({ objetos = [], ruido = 6, semilla = 1, brillo = 0 } = {}) {
  const r = prng(semilla);
  const gris = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let v = 90 + Math.round((y / H) * 40) + brillo + Math.round((r() * 2 - 1) * ruido);
      for (const o of objetos) if (x >= o.x && x < o.x + o.w && y >= o.y && y < o.y + o.h) v = o.v + brillo + Math.round((r() * 2 - 1) * ruido);
      gris[y * W + x] = Math.max(0, Math.min(255, v));
    }
  }
  return { ancho: W, alto: H, gris };
}

/** Pasa `n` cuadros por el detector avanzando el reloj al ritmo de `fps`; devuelve todos los eventos. */
function correr(det, reloj, cuadros, fps = 5) {
  const eventos = [];
  for (const c of cuadros) {
    eventos.push(...det.procesar(c).eventos);
    reloj.avanzar(1000 / fps);
  }
  return eventos;
}

/** Un vehículo (rectángulo oscuro de 40×24) que cruza el cuadro de izquierda a derecha en `pasos` cuadros, en la franja `y`. */
function cruce({ pasos = 30, y = 50, semilla0 = 100, x0 = -45, x1 = W + 5 } = {}) {
  return Array.from({ length: pasos }, (_, i) => cuadro({
    objetos: [{ x: Math.round(x0 + ((x1 - x0) * i) / (pasos - 1)), y, w: 40, h: 24, v: 30 }],
    semilla: semilla0 + i,
  }));
}

const quieto = (n, semilla0 = 1) => Array.from({ length: n }, (_, i) => cuadro({ semilla: semilla0 + i }));

test('video sin movimiento: cero eventos, siempre a fps de reposo', () => {
  const reloj = new RelojFalso();
  const det = new DetectorMovimiento({}, reloj);
  let maxCambio = 0;
  for (const c of quieto(600)) {
    const r = det.procesar(c);
    assert.equal(r.eventos.length, 0);
    assert.equal(r.fpsDeseado, 1, 'en reposo solo 1 fps');
    maxCambio = Math.max(maxCambio, r.cambio);
    reloj.avanzar(1000);
  }
  assert.ok(maxCambio < 0.015, `el ruido del sensor no supera el umbral (máx ${maxCambio})`);
});

test('un vehículo que cruza el ROI produce UN inicio y UN fin, con la hora del reloj inyectado', () => {
  const reloj = new RelojFalso(1_000_000);
  const det = new DetectorMovimiento({}, reloj);
  const eventos = correr(det, reloj, [...quieto(5), ...cruce(), ...quieto(15, 500)]);
  assert.deepEqual(eventos.map(e => e.tipo), ['movimiento_inicio', 'movimiento_fin']);
  const [inicio, fin] = eventos;
  // 5 cuadros quietos y el carro asoma en el 6.º: con 3 cuadros de confirmación el inicio cae antes del 10.º (2 s a 5 fps).
  assert.ok(inicio.ts >= 1_000_000 + 5 * 200 && inicio.ts < 1_000_000 + 10 * 200, `inicio poco después de que entra (${inicio.ts})`);
  assert.ok(fin.ts > inicio.ts);
  assert.equal(fin.duracion_ms, fin.ts - inicio.ts);
});

test('con movimiento pide fps activos y vuelve a reposo al terminar', () => {
  const reloj = new RelojFalso();
  const det = new DetectorMovimiento({ fpsActivo: 4, fpsReposo: 0.5 }, reloj);
  const fps = [];
  for (const c of [...quieto(3), ...cruce(), ...quieto(10, 700)]) { fps.push(det.procesar(c).fpsDeseado); reloj.avanzar(250); }
  assert.equal(fps[0], 0.5);
  assert.ok(fps.includes(4));
  assert.equal(fps.at(-1), 0.5);
});

test('en reposo (1 fps) el primer cuadro con cambio sube el ritmo para confirmar rápido', () => {
  const reloj = new RelojFalso();
  const det = new DetectorMovimiento({}, reloj);
  const fps = [];
  for (const c of [...quieto(3), ...cruce()]) { const r = det.procesar(c); fps.push(r.fpsDeseado); reloj.avanzar(1000 / r.fpsDeseado); }
  const primero = fps.findIndex(f => f === 5);
  assert.ok(primero > 0 && primero <= 6, `sube a 5 fps en cuanto asoma el carro (cuadro ${primero})`);
  assert.equal(fps.at(-1), 5);
  // El tiempo total hasta el inicio, con el ritmo que pidió el detector, es corto aunque arrancó a 1 fps.
  const reloj2 = new RelojFalso();
  const det2 = new DetectorMovimiento({}, reloj2);
  let inicio = null;
  for (const c of [...quieto(3), ...cruce()]) {
    const r = det2.procesar(c);
    if (r.eventos.length && inicio == null) inicio = reloj2.ahora();
    reloj2.avanzar(1000 / r.fpsDeseado);
  }
  assert.ok(inicio != null && inicio <= 3000 + 2 * 1000 + 3 * 200, `inicio a los ${inicio} ms`);
});

test('movimiento FUERA del ROI no dispara', () => {
  const reloj = new RelojFalso();
  // ROI: solo la mitad izquierda del cuadro. El vehículo cruza por la mitad derecha.
  const det = new DetectorMovimiento({ roi: [[0, 0], [0.45, 0], [0.45, 1], [0, 1]] }, reloj);
  const fuera = Array.from({ length: 25 }, (_, i) => cuadro({ objetos: [{ x: 80 + i * 3, y: 20 + i, w: 30, h: 20, v: 25 }], semilla: 300 + i }));
  assert.deepEqual(correr(det, reloj, [...quieto(3), ...fuera, ...quieto(10, 50)]), []);
  // El mismo objeto dentro del ROI sí dispara (la prueba no pasa por un ROI mal construido).
  const det2 = new DetectorMovimiento({ roi: [[0, 0], [0.45, 0], [0.45, 1], [0, 1]] }, reloj);
  const dentro = Array.from({ length: 25 }, (_, i) => cuadro({ objetos: [{ x: i * 2, y: 20 + i, w: 30, h: 20, v: 25 }], semilla: 300 + i }));
  assert.deepEqual(correr(det2, reloj, [...quieto(3), ...dentro, ...quieto(10, 50)]).map(e => e.tipo), ['movimiento_inicio', 'movimiento_fin']);
});

test('un cambio de brillo de todo el cuadro (exposición, nube) no cuenta como movimiento', () => {
  const reloj = new RelojFalso();
  const det = new DetectorMovimiento({}, reloj);
  const cuadros = [];
  for (let i = 0; i < 20; i++) cuadros.push(cuadro({ semilla: i, brillo: i < 10 ? 0 : 35 }));
  assert.deepEqual(correr(det, reloj, cuadros), []);
});

test('histéresis: un parpadeo de un solo cuadro no despierta; una pausa corta no corta el evento', () => {
  const reloj = new RelojFalso();
  const det = new DetectorMovimiento({ framesActivar: 3, framesDesactivar: 4 }, reloj);
  const blip = cuadro({ objetos: [{ x: 60, y: 30, w: 40, h: 30, v: 230 }], semilla: 9 });
  assert.deepEqual(correr(det, reloj, [...quieto(3), blip, ...quieto(6, 40)]), [], 'un cuadro aislado no basta');

  // Vehículo que avanza, se detiene 2 cuadros (sin cambio) y sigue: un solo evento.
  const det2 = new DetectorMovimiento({ framesActivar: 3, framesDesactivar: 4 }, reloj);
  const pos = [0, 8, 16, 24, 32, 32, 32, 40, 48, 56, 64, 72, 80, 88, 96, 104, 112, 120, 128, 136, 144, 152, 165];
  const cuadros = pos.map((x, i) => cuadro({ objetos: [{ x, y: 40, w: 40, h: 24, v: 30 }], semilla: 2000 + i }));
  const ev = correr(det2, reloj, [...quieto(3), ...cuadros, ...quieto(8, 70)]);
  assert.deepEqual(ev.map(e => e.tipo), ['movimiento_inicio', 'movimiento_fin']);
});

test('dos vehículos separados por un rato quieto son dos eventos', () => {
  const reloj = new RelojFalso();
  const det = new DetectorMovimiento({}, reloj);
  const ev = correr(det, reloj, [...quieto(3), ...cruce(), ...quieto(12, 900), ...cruce({ semilla0: 4000, y: 30 }), ...quieto(12, 950)]);
  assert.deepEqual(ev.map(e => e.tipo), ['movimiento_inicio', 'movimiento_fin', 'movimiento_inicio', 'movimiento_fin']);
});

test('cambiar el tamaño del cuadro reinicia la referencia sin inventar movimiento', () => {
  const reloj = new RelojFalso();
  const det = new DetectorMovimiento({}, reloj);
  correr(det, reloj, quieto(3));
  const otro = { ancho: 80, alto: 45, gris: new Uint8Array(80 * 45).fill(100) };
  assert.deepEqual(det.procesar(otro).eventos, []);
  assert.deepEqual(det.procesar(otro).eventos, []);
  assert.throws(() => det.procesar({ ancho: 10, alto: 10, gris: new Uint8Array(5) }), /Cuadro inválido/);
});

test('costo en reposo: un cuadro de 160×90 se procesa en pocos milisegundos', () => {
  const reloj = new RelojFalso();
  const det = new DetectorMovimiento({}, reloj);
  const cuadros = quieto(50);
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < 200; i++) det.procesar(cuadros[i % 50]);
  const msPorCuadro = Number(process.hrtime.bigint() - t0) / 1e6 / 200;
  // A 1 fps en reposo esto es <1 % de un núcleo; el tope es holgado para no fallar en un runner lento.
  assert.ok(msPorCuadro < 15, `${msPorCuadro.toFixed(2)} ms por cuadro`);
});

test('configuración: valores por defecto, enteros y errores claros', () => {
  const c = configurar({ framesActivar: 2.4, umbralCambio: null });
  assert.equal(c.framesActivar, 2);
  assert.equal(c.umbralCambio, 0.015, 'null = valor por defecto');
  assert.deepEqual(c.roi, CUADRO_COMPLETO.map(p => [...p]));
  assert.throws(() => configurar({ umbralPixel: 0 }), /umbralPixel/);
  assert.throws(() => configurar({ fpsActivo: 100 }), /fpsActivo/);
  assert.throws(() => new DetectorMovimiento({}), /reloj/);
});

test('ROI: validación, punto en polígono, máscara y fracción de una caja', () => {
  assert.throws(() => normalizarPoligono([[0, 0], [1, 1]]), /al menos 3/);
  assert.throws(() => normalizarPoligono([[0, 0], [1.2, 0], [1, 1]]), /Punto 2/);
  assert.throws(() => normalizarPoligono(Array.from({ length: 33 }, () => [0, 0])), /32/);
  assert.deepEqual(normalizarPoligono([{ x: 0.1, y: 0.2 }, { x: 0.9, y: 0.2 }, { x: 0.5, y: 0.9 }]), [[0.1, 0.2], [0.9, 0.2], [0.5, 0.9]]);
  const tri = [[0, 0], [1, 0], [0, 1]];
  assert.equal(puntoEnPoligono(0.2, 0.2, tri), true);
  assert.equal(puntoEnPoligono(0.8, 0.8, tri), false);
  const m = mascara(tri, 10, 10);
  const dentro = m.reduce((a, b) => a + b, 0);
  assert.ok(dentro > 40 && dentro < 60, `la mitad del cuadro (${dentro})`);
  const izq = [[0, 0], [0.5, 0], [0.5, 1], [0, 1]];
  assert.equal(fraccionDentro({ x: 0, y: 0, w: 40, h: 90 }, izq, 160, 90), 1);
  assert.equal(fraccionDentro({ x: 100, y: 0, w: 40, h: 90 }, izq, 160, 90), 0);
  assert.ok(Math.abs(fraccionDentro({ x: 60, y: 0, w: 40, h: 90 }, izq, 160, 90) - 0.4) < 0.01);
});

test('reloj y ritmo: el ritmo deja pasar un cuadro por periodo, con holgura', () => {
  const reloj = new RelojFalso(0);
  const ritmo = new Ritmo(reloj);
  const pasan = [];
  for (let t = 0; t < 2000; t += 100) { pasan.push(ritmo.listo(5)); reloj.avanzar(100); }
  assert.equal(pasan.filter(Boolean).length, 10, '5 fps durante 2 s con cuadros cada 100 ms');
  assert.ok(Math.abs(new RelojSistema().ahora() - Date.now()) < 50);
});

test('utilidades de imagen: gris, nitidez y caja acotada', () => {
  const rgba = new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255]);
  assert.deepEqual([...rgbaAGris(rgba, 2, 1)], [255, 0]);
  const liso = new Uint8Array(20 * 20).fill(128);
  const bordes = Uint8Array.from({ length: 400 }, (_, i) => ((i % 20) + Math.floor(i / 20)) % 2 ? 255 : 0);
  assert.equal(varianzaLaplaciano(liso, 20, 20), 0);
  assert.ok(varianzaLaplaciano(bordes, 20, 20) > 1000, 'un patrón con bordes es «nítido»');
  assert.equal(varianzaLaplaciano(liso, 2, 2), 0);
  assert.deepEqual(acotarCaja({ x: -5, y: 10.4, w: 30, h: 100 }, 100, 50), { x: 0, y: 10, w: 25, h: 40 });
  assert.equal(acotarCaja({ x: 200, y: 0, w: 10, h: 10 }, 100, 50), null);
  assert.deepEqual([...suavizar(Uint8Array.from([0, 90, 0]), 3, 1, 0)], [0, 90, 0], 'radio 0 = copia');
});
