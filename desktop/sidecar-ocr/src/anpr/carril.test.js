'use strict';
// Tarea 4 (Sprint 10): el carril completo (movimiento → detector → seguimiento → OCR → consenso → evidencia) con detector, OCR y
// reloj FALSOS sobre fotogramas JPEG sintéticos. Sin modelos: corre en cualquier máquina.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createCanvas, loadImage } = require('@napi-rs/canvas');

const { Carril } = require('./carril');
const { RelojFalso } = require('./reloj');
const { RETENCION_MS, zonaInferior, recortesEvidencia } = require('./evidencia');

const W = 640;
const H = 360;

/** Fotograma: asfalto gris y, si hay `caja`, un «vehículo» oscuro con una placa clara en la parte baja. */
function fotograma(caja, semilla = 0) {
  const c = createCanvas(W, H);
  const g = c.getContext('2d');
  g.fillStyle = '#707070';
  g.fillRect(0, 0, W, H);
  g.fillStyle = '#6a6a6a';
  for (let i = 0; i < 40; i++) g.fillRect((i * 97 + semilla * 13) % W, (i * 53 + semilla * 7) % H, 3, 3);
  if (caja) {
    g.fillStyle = '#1d2a3a';
    g.fillRect(caja.x, caja.y, caja.w, caja.h);
    g.fillStyle = '#eeeeee';
    g.fillRect(caja.x + caja.w * 0.4, caja.y + caja.h * 0.7, caja.w * 0.2, caja.h * 0.12);
    g.fillStyle = '#000';
    for (let x = 0; x < 6; x++) g.fillRect(caja.x + caja.w * (0.41 + x * 0.03), caja.y + caja.h * 0.73, 3, caja.h * 0.06);
  }
  return c.toBuffer('image/jpeg', 90);
}

/** Detector falso: devuelve la caja que el guion dice para el cuadro actual (si hay). */
function detectorFalso() {
  const d = {
    llamadas: 0,
    actual: null,
    async detectar() {
      d.llamadas++;
      return { cajas: d.actual ? [{ clase: 'carro', confianza: 0.9, bbox: d.actual, en_roi: 1 }] : [], ms: 1 };
    },
  };
  return d;
}

/** OCR falso: cada llamada saca la siguiente respuesta de la lista (la última se repite). Las cajas son del recorte recibido. */
function ocrFalso(textos) {
  const f = async (jpeg) => {
    f.llamadas++;
    f.recortes.push(jpeg);
    const t = textos[Math.min(f.llamadas - 1, textos.length - 1)];
    if (t instanceof Error) throw t;
    if (!t) return { texto: '', items: [] };
    return { texto: t, items: [{ texto: 'GUATEMALA', confianza: 0.99, box: { x: 5, y: 2, w: 40, h: 6 } }, { texto: t, confianza: 0.97, box: { x: 10, y: 10, w: 60, h: 14 } }] };
  };
  f.llamadas = 0;
  f.recortes = [];
  return f;
}

/** Un vehículo que entra (se mueve 12 cuadros) y se queda detenido `quieto` cuadros; nunca toca el borde. */
const guion = (quieto = 20) => [
  ...Array.from({ length: 12 }, (_, i) => ({ x: 180 - i * 4, y: 150 - i * 5, w: 260 + i * 4, h: 150 + i * 2 })),
  ...Array.from({ length: quieto }, () => ({ x: 136, y: 95, w: 304, h: 172 })),
];

/** Corre el guion (más cuadros vacíos antes y después) avanzando el reloj 200 ms por cuadro (5 fps). */
async function correr(carril, det, reloj, cajas, { antes = 3, despues = 15 } = {}) {
  const eventos = [];
  const respuestas = [];
  const todo = [...Array(antes).fill(null), ...cajas, ...Array(despues).fill(null)];
  for (let i = 0; i < todo.length; i++) {
    det.actual = todo[i];
    const r = await carril.procesar(fotograma(todo[i], i));
    respuestas.push(r);
    eventos.push(...r.eventos);
    reloj.avanzar(200);
  }
  return { eventos, respuestas, decisiones: eventos.filter(e => e.tipo === 'decision') };
}

/** Configuración de prueba: todo el cuadro como ROI y 5 fps también en reposo (cada cuadro cuenta). */
const CFG = { movimiento: { fpsReposo: 5, fpsActivo: 5 } };

const esJpeg = (b64) => typeof b64 === 'string' && Buffer.from(b64, 'base64').subarray(0, 2).equals(Buffer.from([0xff, 0xd8]));

test('placa confirmada por consenso: UNA decisión con evidencia (placa y parte baja del vehículo) y caducidad a 7 días', async () => {
  const reloj = new RelojFalso(1_700_000_000_000);
  const det = detectorFalso();
  const ocr = ocrFalso(['P 123ABC']);
  const carril = new Carril({ id: 'entrada', config: CFG, reloj, detector: det, ocr });
  const { decisiones, eventos } = await correr(carril, det, reloj, guion());
  assert.equal(decisiones.length, 1);
  const d = decisiones[0];
  assert.equal(d.resultado, 'confirmada');
  assert.equal(d.placa, 'P123ABC');
  assert.equal(d.carril, 'entrada');
  assert.match(d.track_id, /^entrada-/);
  assert.equal(d.votos, 3);
  assert.equal(d.lecturas.length, 3);
  assert.equal(d.requiere_verificacion, false);
  assert.equal(d.alguna_correccion, false);
  assert.equal(d.confianza, 0.97);
  assert.ok(d.ms_desde_legible >= 0, 'latencia desde la primera lectura válida');
  assert.ok(esJpeg(d.evidencia.placa_jpeg) && esJpeg(d.evidencia.vehiculo_jpeg));
  assert.equal(d.evidencia.expira_ms, d.ts + RETENCION_MS);
  assert.equal(ocr.llamadas, 3, 'con el consenso alcanzado no se lee más');
  // Movimiento y pistas también se informan (para la superposición de la pantalla).
  assert.ok(eventos.some(e => e.tipo === 'movimiento_inicio' && e.carril === 'entrada'));
  assert.ok(eventos.some(e => e.tipo === 'pista' && e.evento === 'fin' && e.estado === 'PASO'));
});

test('las lecturas siguientes recortan alrededor de la placa ya ubicada (recortes más chicos que el primero)', async () => {
  const reloj = new RelojFalso();
  const det = detectorFalso();
  const ocr = ocrFalso(['P 123ABC']);
  const carril = new Carril({ id: 'c1', config: CFG, reloj, detector: det, ocr });
  await correr(carril, det, reloj, guion());
  const [primero, ...resto] = await Promise.all(ocr.recortes.map(b => loadImage(b)));
  for (const r of resto) assert.ok(r.width * r.height < primero.width * primero.height / 2, `${r.width}×${r.height} vs ${primero.width}×${primero.height}`);
});

test('lecturas divergentes → decisión ILEGIBLE con requiere_verificacion y la evidencia del vehículo', async () => {
  const reloj = new RelojFalso();
  const det = detectorFalso();
  const ocr = ocrFalso(['P 123ABC', 'P 128ABC', 'P 723ABC', 'C 123ABC', 'P 123ABC']);
  const carril = new Carril({ id: 'c1', config: CFG, reloj, detector: det, ocr });
  const { decisiones } = await correr(carril, det, reloj, guion());
  assert.equal(decisiones.length, 1);
  const d = decisiones[0];
  assert.deepEqual([d.resultado, d.placa, d.motivo, d.requiere_verificacion], ['ilegible', null, 'lecturas_divergentes', true]);
  assert.ok(esJpeg(d.evidencia.vehiculo_jpeg));
  assert.ok(ocr.llamadas <= 5);
});

test('corrección por posición necesaria para el consenso → confirmada pero requiere verificación del agente', async () => {
  const reloj = new RelojFalso();
  const det = detectorFalso();
  const ocr = ocrFalso(['P 123A8C', 'P 123ABC', 'P 123A8C']);
  const carril = new Carril({ id: 'c1', config: CFG, reloj, detector: det, ocr });
  const { decisiones } = await correr(carril, det, reloj, guion());
  assert.equal(decisiones.length, 1);
  const d = decisiones[0];
  assert.deepEqual([d.resultado, d.placa, d.requiere_verificacion, d.alguna_correccion], ['confirmada', 'P123ABC', true, true]);
  assert.deepEqual(d.lecturas.map(l => l.correcciones), [1, 0, 1]);
});

test('sin movimiento el detector no corre y el carril pide el fps de reposo', async () => {
  const reloj = new RelojFalso();
  const det = detectorFalso();
  const carril = new Carril({ id: 'c1', config: { movimiento: { fpsReposo: 5, fpsActivo: 5 } }, reloj, detector: det, ocr: ocrFalso([]) });
  const { decisiones, respuestas } = await correr(carril, det, reloj, [], { antes: 20, despues: 0 });
  assert.equal(det.llamadas, 0);
  assert.equal(decisiones.length, 0);
  assert.ok(respuestas.every(r => r.procesado && r.eventos.length === 0));

  const carril2 = new Carril({ id: 'c2', config: {}, reloj, detector: det, ocr: ocrFalso([]) });
  const r2 = await correr(carril2, det, reloj, [], { antes: 25, despues: 0 });
  assert.equal(r2.respuestas.filter(r => r.procesado).length, 5, 'a 1 fps en reposo, 5 de 25 cuadros de 200 ms');
  assert.equal(r2.respuestas[0].fps_deseado, 1);
});

test('la misma placa dentro de 60 s: el segundo paso no decide (evento «ignorada» por enfriamiento)', async () => {
  const reloj = new RelojFalso();
  const det = detectorFalso();
  const carril = new Carril({ id: 'c1', config: CFG, reloj, detector: det, ocr: ocrFalso(['P 123ABC']) });
  const primero = await correr(carril, det, reloj, guion(8));
  reloj.avanzar(10_000);
  const segundo = await correr(carril, det, reloj, guion(8));
  assert.equal(primero.decisiones.length, 1);
  assert.equal(segundo.decisiones.length, 0);
  assert.deepEqual(segundo.eventos.filter(e => e.tipo === 'ignorada').map(e => [e.placa, e.motivo]), [['P123ABC', 'enfriamiento']]);
});

test('el OCR que falla cuenta como lectura sin placa: la pista termina ILEGIBLE, nunca con una placa inventada', async () => {
  const reloj = new RelojFalso();
  const det = detectorFalso();
  const carril = new Carril({ id: 'c1', config: CFG, reloj, detector: det, ocr: ocrFalso([new Error('OCR caído')]) });
  const { decisiones } = await correr(carril, det, reloj, guion(30));
  assert.deepEqual(decisiones.map(d => [d.resultado, d.placa, d.motivo]), [['ilegible', null, 'sin_lectura_valida']]);
});

test('un vehículo que se va antes de leerse por completo sale ILEGIBLE con motivo y evidencia', async () => {
  const reloj = new RelojFalso();
  const det = detectorFalso();
  // El vehículo se ve 3 cuadros: el primero solo lo detecta, en los otros dos se lee (una lectura por cuadro): 2 < 3, sin consenso.
  const carril = new Carril({ id: 'c1', config: CFG, reloj, detector: det, ocr: ocrFalso(['P 123ABC']) });
  const { decisiones } = await correr(carril, det, reloj, guion(0).slice(0, 3));
  assert.equal(decisiones.length, 1);
  assert.deepEqual([decisiones[0].resultado, decisiones[0].motivo], ['ilegible', 'se_fue_sin_lectura']);
  assert.ok(decisiones[0].lecturas.length >= 1 && decisiones[0].placa_probable === 'P123ABC');
});

test('configuración: id válido, dependencias obligatorias y ROI validado; reconfigurar olvida las pistas', async () => {
  const reloj = new RelojFalso();
  const det = detectorFalso();
  assert.throws(() => new Carril({ id: 'mal id!', reloj, detector: det, ocr: ocrFalso([]) }), /Id de carril/);
  assert.throws(() => new Carril({ id: 'c1', reloj, detector: det }), /necesita/);
  assert.throws(() => new Carril({ id: 'c1', config: { roi: [[0, 0]] }, reloj, detector: det, ocr: ocrFalso([]) }), /ROI/);
  const carril = new Carril({ id: 'c1', config: CFG, reloj, detector: det, ocr: ocrFalso([null]) });
  await correr(carril, det, reloj, guion(3), { despues: 0 });
  assert.ok(carril.tracker.activas().length > 0);
  carril.configurar(CFG);
  assert.equal(carril.tracker.activas().length, 0);
});

test('evidencia: el recorte del vehículo deja fuera la cabina (de 45 % hacia abajo) y se reduce a 480 px', async () => {
  const caja = { x: 0, y: 0, w: 1000, h: 400 };
  assert.deepEqual(zonaInferior(caja), { x: 0, y: 180, w: 1000, h: 220 });
  const conMargen = zonaInferior({ x: 100, y: 0, w: 1000, h: 400 }, 0.45, 0.1);
  assert.deepEqual([conMargen.x, conMargen.w, Math.round(conMargen.h)], [0, 1200, 240], '10 % a cada lado y 5 % abajo');
  const img = createCanvas(1200, 600);
  const ev = recortesEvidencia(img, { x: 50, y: 50, w: 1000, h: 400 }, { x: 500, y: 350, w: 100, h: 50 }, { ts: 0, margenVehiculo: 0 });
  const veh = await loadImage(Buffer.from(ev.vehiculo_jpeg, 'base64'));
  const pla = await loadImage(Buffer.from(ev.placa_jpeg, 'base64'));
  assert.equal(veh.width, 480);
  assert.equal(veh.height, Math.round(220 * 0.48));
  assert.deepEqual([pla.width, pla.height], [140, 70], 'placa con 20 % de margen');
  assert.equal(ev.expira_ms, RETENCION_MS);
  assert.ok(ev.bytes > 0);
  const sinPlaca = recortesEvidencia(img, { x: 50, y: 50, w: 1000, h: 400 }, null, { ts: 5 });
  assert.equal(sinPlaca.placa_jpeg, null);
});
