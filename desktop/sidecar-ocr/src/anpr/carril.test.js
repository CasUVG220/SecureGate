'use strict';
// Tarea 4 (Sprint 10): el carril completo (movimiento → detector → seguimiento → OCR → consenso → evidencia) con detector, OCR y
// reloj FALSOS sobre fotogramas JPEG sintéticos. Sin modelos: corre en cualquier máquina.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createCanvas, loadImage } = require('@napi-rs/canvas');

const { Carril, tapada } = require('./carril');
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
  // A la tercera ya era confirmable, pero con una sola literal: se leyó una más por si salía literal (salió corregida otra vez).
  assert.deepEqual(d.lecturas.map(l => l.correcciones), [1, 0, 1, 1]);
});

test('una lectura literal más evita la verificación: corregida + 3 literales → confirmada sin verificación', async () => {
  const reloj = new RelojFalso();
  const det = detectorFalso();
  const ocr = ocrFalso(['P 123A8C', 'P 123ABC', 'P 123ABC', 'P 123ABC']);
  const carril = new Carril({ id: 'c1', config: CFG, reloj, detector: det, ocr });
  const { decisiones } = await correr(carril, det, reloj, guion());
  assert.equal(decisiones.length, 1);
  assert.deepEqual([decisiones[0].resultado, decisiones[0].placa, decisiones[0].requiere_verificacion], ['confirmada', 'P123ABC', false]);
  assert.deepEqual(decisiones[0].lecturas.map(l => l.correcciones), [1, 0, 0, 0]);
});

test('confirmable que esperaba otra literal y el vehículo se va: confirmada CON verificación (nunca abre sola) y con evidencia', async () => {
  const reloj = new RelojFalso();
  const det = detectorFalso();
  // Se ve 4 cuadros: el primero solo lo detecta y en los otros tres se lee (corregida, literal, literal).
  const ocr = ocrFalso(['P 123A8C', 'P 123ABC', 'P 123ABC']);
  const carril = new Carril({ id: 'c1', config: CFG, reloj, detector: det, ocr });
  const { decisiones } = await correr(carril, det, reloj, guion(0).slice(0, 4));
  assert.equal(decisiones.length, 1);
  const d = decisiones[0];
  assert.deepEqual([d.resultado, d.placa, d.requiere_verificacion, d.motivo], ['confirmada', 'P123ABC', true, 'se_fue_sin_lectura']);
  assert.ok(esJpeg(d.evidencia.placa_jpeg) && esJpeg(d.evidencia.vehiculo_jpeg));
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

// ── Varios vehículos a la vez (seguimiento del Sprint 10, tarea 4) ────────────────────────────────────────────────────────────

/**
 * Los tres vehículos sintéticos: color de carrocería, el tinte del fondo de SU placa (así el OCR falso sabe qué placa ve) y la
 * placa que «lee» en ella.
 */
const TRES = {
  A: { color: [150, 40, 40], tinte: '#ffc8c8', placa: 'P111AAA' },
  B: { color: [40, 130, 40], tinte: '#c8ffc8', placa: 'C222BBB' },
  C: { color: [40, 40, 150], tinte: '#c8c8ff', placa: 'M333CCC' },
};

/** Fotograma con varios vehículos de color (se pintan en orden: el último queda por delante). */
function fotogramaVarios(cajas, semilla = 0) {
  const c = createCanvas(W, H);
  const g = c.getContext('2d');
  g.fillStyle = '#707070';
  g.fillRect(0, 0, W, H);
  g.fillStyle = '#6a6a6a';
  for (let i = 0; i < 40; i++) g.fillRect((i * 97 + semilla * 13) % W, (i * 53 + semilla * 7) % H, 3, 3);
  for (const { v, caja } of cajas) {
    g.fillStyle = `rgb(${TRES[v].color.join(',')})`;
    g.fillRect(caja.x, caja.y, caja.w, caja.h);
    g.fillStyle = TRES[v].tinte;
    g.fillRect(caja.x + caja.w * 0.4, caja.y + caja.h * 0.7, caja.w * 0.2, caja.h * 0.12);
    g.fillStyle = '#000';
    for (let x = 0; x < 6; x++) g.fillRect(caja.x + caja.w * (0.41 + x * 0.03), caja.y + caja.h * 0.73, 3, caja.h * 0.06);
  }
  return c.toBuffer('image/jpeg', 90);
}

/**
 * OCR falso que lee la placa que se VE en el recorte, como uno de verdad: cuenta los píxeles del fondo de cada placa (por su
 * tinte) y devuelve la que más se ve; si ninguna se ve lo suficiente, no lee nada. Una placa tapada no se lee.
 */
function ocrPorPlaca() {
  const f = async (jpeg) => {
    f.llamadas++;
    const img = await loadImage(jpeg);
    const c = createCanvas(img.width, img.height);
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, img.width, img.height).data;
    const cuenta = [0, 0, 0];
    const cajas = [0, 1, 2].map(() => ({ x0: Infinity, y0: Infinity, x1: -1, y1: -1 }));
    for (let i = 0; i < d.length; i += 4) {
      const px = [d[i], d[i + 1], d[i + 2]];
      if (Math.min(...px) < 170 || Math.max(...px) - Math.min(...px) < 25) continue;
      const k = px.indexOf(Math.max(...px));
      cuenta[k]++;
      const x = (i / 4) % img.width;
      const y = Math.floor(i / 4 / img.width);
      const b = cajas[k];
      b.x0 = Math.min(b.x0, x); b.y0 = Math.min(b.y0, y); b.x1 = Math.max(b.x1, x); b.y1 = Math.max(b.y1, y);
    }
    const max = Math.max(...cuenta);
    if (max < 60) { f.leidas.push('-'); return { texto: '', items: [] }; }
    const k = cuenta.indexOf(max);
    const v = ['A', 'B', 'C'][k];
    f.leidas.push(v);
    const t = TRES[v].placa;
    // Dónde está la placa en el recorte (como la caja de texto de un OCR de verdad): el carril relee alrededor de ella.
    const b = cajas[k];
    const caja = { x: b.x0, y: b.y0, w: b.x1 - b.x0 + 1, h: b.y1 - b.y0 + 1 };
    return { texto: t, items: [{ texto: t, confianza: 0.97, box: caja }] };
  };
  f.llamadas = 0;
  f.leidas = [];
  return f;
}

/**
 * A y B entran juntos y se cruzan (B, más cerca de la cámara, pasa por delante de A: A se ve en parte y unos cuadros nada); C llega
 * 3 s después (< 5 s) desde abajo, pasa por detrás de los dos y se detiene en la talanquera mientras siguen en el cuadro. Cajas: lo
 * que vería el detector.
 */
function guionTres() {
  const AN = 160;
  const AL = 90;
  return Array.from({ length: 44 }, (_, i) => {
    const xA = 20 + i * 16;
    const xB = 460 - i * 16;
    const pintar = [];
    const dets = [];
    if (i < 28) {
      pintar.push({ v: 'A', caja: { x: xA, y: 165, w: AN, h: AL } });
      const solape = AN - Math.abs(xA - xB);
      const visible = i >= 27 || solape <= 0 ? { x: xA, w: AN } : solape > AN * 0.55 ? null
        : xA < xB ? { x: xA, w: xB - xA } : { x: xB + AN, w: xA - xB };
      if (visible) dets.push({ v: 'A', bbox: { x: visible.x, y: 165, w: visible.w, h: AL } });
    }
    if (i < 27) {
      pintar.push({ v: 'B', caja: { x: xB, y: 200, w: AN, h: AL } });
      dets.push({ v: 'B', bbox: { x: xB, y: 200, w: AN, h: AL } });
    }
    if (i >= 15) {
      const y = Math.max(60, 250 - (i - 15) * 16);
      const caja = { x: 250, y, w: 170, h: 100 };
      pintar.push({ v: 'C', caja });
      dets.push({ v: 'C', bbox: caja });
    }
    // Se pinta del más lejano al más cercano (el de caja más baja queda delante), como en la vida real.
    pintar.sort((a, b) => (a.caja.y + a.caja.h) - (b.caja.y + b.caja.h));
    return { pintar, dets };
  });
}

test('tres vehículos a la vez: cada uno su pista, su consenso y su decisión; nada heredado ni duplicado; el OCR no se recorta', async () => {
  const reloj = new RelojFalso(1_700_000_000_000);
  const det = { actual: [], async detectar() { return { cajas: det.actual.map(d => ({ clase: 'carro', confianza: 0.9, bbox: d.bbox, en_roi: 1 })), ms: 1 }; } };
  const ocr = ocrPorPlaca();
  const carril = new Carril({ id: 'entrada', config: CFG, reloj, detector: det, ocr });
  const cuadros = [...Array(3).fill({ pintar: [], dets: [] }), ...guionTres(), ...Array(20).fill({ pintar: [], dets: [] })];
  const eventos = [];
  let maxPistas = 0;
  for (let i = 0; i < cuadros.length; i++) {
    det.actual = cuadros[i].dets;
    const r = await carril.procesar(fotogramaVarios(cuadros[i].pintar, i));
    eventos.push(...r.eventos);
    maxPistas = Math.max(maxPistas, (r.pistas ?? []).length);
    reloj.avanzar(200);
  }
  const decisiones = eventos.filter(e => e.tipo === 'decision');
  const nuevas = eventos.filter(e => e.tipo === 'pista' && e.evento === 'nueva');
  assert.equal(maxPistas, 3, 'las tres pistas vivas en el mismo cuadro');
  assert.equal(nuevas.length, 3, 'una pista por vehículo (el tapado no abre otra al reaparecer)');
  assert.deepEqual(decisiones.map(d => [d.resultado, d.placa]).sort(), [['confirmada', 'C222BBB'], ['confirmada', 'M333CCC'], ['confirmada', 'P111AAA']]);
  assert.equal(new Set(decisiones.map(d => d.track_id)).size, 3);
  assert.deepEqual(new Set(decisiones.map(d => d.track_id)), new Set(nuevas.map(e => e.track_id)));
  assert.equal(eventos.filter(e => e.tipo === 'ignorada').length, 0, 'ninguna lectura de otro vehículo se coló como evento');
  for (const d of decisiones) {
    assert.equal(d.votos, 3, `${d.placa}: su propio consenso`);
    assert.equal(d.requiere_verificacion, false);
    assert.ok(esJpeg(d.evidencia.placa_jpeg) && esJpeg(d.evidencia.vehiculo_jpeg), `${d.placa}: evidencia propia`);
  }
  // El OCR no se recorta: corre una vez por cuadro sobre los mejores recortes de cada pista; tres lecturas por vehículo bastan.
  assert.equal(ocr.llamadas, 9);
});

test('cola en la talanquera: el de atrás tapado por el de adelante NO se lee con la placa ajena (sale ILEGIBLE; el otro, la suya)', async () => {
  // A está detenido en la talanquera; B, justo detrás y más cerca de la cámara (su caja termina más abajo), le tapa la placa y
  // deja la SUYA dentro del recorte de lectura de A. Sin la regla, A se confirmaba con la placa de B y el evento de B se perdía
  // por el enfriamiento.
  const reloj = new RelojFalso(1_700_000_000_000);
  const det = { actual: [], async detectar() { return { cajas: det.actual.map(d => ({ clase: 'carro', confianza: 0.9, bbox: d.bbox, en_roi: 1 })), ms: 1 }; } };
  const ocr = ocrPorPlaca();
  const carril = new Carril({ id: 'entrada', config: CFG, reloj, detector: det, ocr });
  const cuadros = Array.from({ length: 30 }, (_, i) => {
    const a = { x: 200, y: 100 - Math.min(i, 4), w: 200, h: 120 };
    const b = { x: 230, y: 124 - Math.min(i, 4), w: 160, h: 105 };
    return { pintar: [{ v: 'A', caja: a }, { v: 'B', caja: b }], dets: [{ v: 'A', bbox: a }, { v: 'B', bbox: b }] };
  });
  const todo = [...Array(3).fill({ pintar: [], dets: [] }), ...cuadros, ...Array(15).fill({ pintar: [], dets: [] })];
  const eventos = [];
  for (let i = 0; i < todo.length; i++) {
    det.actual = todo[i].dets;
    eventos.push(...(await carril.procesar(fotogramaVarios(todo[i].pintar, i))).eventos);
    reloj.avanzar(200);
  }
  const decisiones = eventos.filter(e => e.tipo === 'decision');
  assert.equal(decisiones.length, 2);
  assert.equal(new Set(decisiones.map(d => d.track_id)).size, 2);
  assert.deepEqual(decisiones.map(d => [d.resultado, d.placa]).sort(), [['confirmada', 'C222BBB'], ['ilegible', null]]);
  assert.equal(eventos.filter(e => e.tipo === 'ignorada').length, 0, 'el evento de B no se perdió por el enfriamiento');
});

test('tapada: solo cuenta otro vehículo DELANTE (caja más abajo) que cubre más de la fracción permitida de la zona de la placa', () => {
  const cfg = { margenVehiculo: 0.12, maxTapado: 0.2 };
  const a = { id: 'a', bbox: { x: 200, y: 100, w: 200, h: 120 } };
  const delante = { id: 'b', bbox: { x: 230, y: 124, w: 160, h: 105 } };
  const detras = { id: 'c', bbox: { x: 230, y: 40, w: 160, h: 100 } };
  const rozando = { id: 'd', bbox: { x: 380, y: 150, w: 120, h: 90 } };
  assert.equal(tapada(a, [a, delante], cfg), true);
  assert.equal(tapada(a, [a, detras], cfg), false, 'el de atrás no tapa (lo tapa él a ese)');
  assert.equal(tapada(a, [a, rozando], cfg), false, 'un roce en la orilla no descarta el recorte');
  assert.equal(tapada(a, [a], cfg), false);
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
