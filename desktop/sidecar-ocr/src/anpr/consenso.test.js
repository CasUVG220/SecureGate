'use strict';
// Tarea 4 (Sprint 10): consenso de lecturas con lecturas SIMULADAS (sin OCR): exacto, divergentes, corrección por posición.
const test = require('node:test');
const assert = require('node:assert/strict');

const { Consenso, configurar, calidadRecorte, cajaDePlaca, lecturaDeOcr, esqueleto } = require('./consenso');
const { mejorCandidato, formatear, esValida, normalizar, candidatosDe } = require('./placa');

/** Lectura ya interpretada, como la que produce `lecturaDeOcr`. */
const L = (placa, confianza = 0.96, correcciones = 0, prefijo = true) => ({
  placa, texto: placa ?? 'XX', valida: !!placa, correcciones, prefijo_conocido: prefijo, confianza,
});

test('consenso exacto: 3 lecturas iguales y confiables confirman la placa', () => {
  const c = new Consenso();
  assert.equal(c.agregar(L('P123ABC')).estado, 'pendiente');
  assert.equal(c.agregar(L('P123ABC', 0.94)).estado, 'pendiente');
  const r = c.agregar(L('P123ABC', 0.98));
  assert.equal(r.estado, 'confirmada');
  assert.equal(r.placa, 'P123ABC');
  assert.equal(r.votos, 3);
  assert.equal(r.confianza, 0.96);
  assert.equal(r.requiere_verificacion, false);
  assert.equal(r.alguna_correccion, false);
  assert.equal(c.abierto, false);
});

test('lecturas divergentes → ilegible (y se deja de leer en cuanto ya no se puede llegar)', () => {
  const c = new Consenso();
  c.agregar(L('P123ABC'));
  c.agregar(L('P128ABC'));
  c.agregar(L('P723ABC'));
  const r = c.agregar(L('C123ABC'));
  // 4 lecturas, la mejor tiene 1 voto y queda 1: ni con ella se llega a 3.
  assert.equal(r.estado, 'ilegible');
  assert.equal(r.motivo, 'lecturas_divergentes');
  assert.equal(r.total, 4, 'no esperó a la quinta');
});

test('una sola discrepancia válida impide abrir con el umbral por defecto (conservador): 3 de 4 no alcanza 0,90', () => {
  const c = new Consenso();
  c.agregar(L('P123ABC', 0.97));
  c.agregar(L('P123ABC', 0.97));
  c.agregar(L('P128ABC', 0.9));
  const r = c.agregar(L('P123ABC', 0.97));
  assert.equal(r.votos, 3);
  assert.ok(r.confianza < 0.9, `0.97 × 3/4 = ${r.confianza}`);
  assert.equal(r.estado, 'ilegible', 'ni la quinta lectura llevaría a 0,90: (2,91 + 1) / 5 = 0,78');
  // Con un umbral menor (configurable) la misma secuencia sí confirma.
  const flexible = new Consenso({ confianzaMin: 0.7 });
  for (const l of [L('P123ABC', 0.97), L('P123ABC', 0.97), L('P128ABC', 0.9), L('P123ABC', 0.97)]) flexible.agregar(l);
  assert.equal(flexible.resultado().estado, 'confirmada');
});

test('corrección por posición: si el consenso NECESITA una lectura corregida, requiere verificación', () => {
  const c = new Consenso();
  c.agregar(L('P123ABC'));
  c.agregar(L('P123ABC', 0.95, 1)); // «P123A8C» corregida a P123ABC
  const r = c.agregar(L('P123ABC'));
  assert.equal(r.estado, 'confirmada');
  assert.equal(r.requiere_verificacion, true, 'solo 2 lecturas literales: la corrección fue necesaria');
  assert.equal(r.alguna_correccion, true);

  // Tres literales + una corregida que coincide: la corrección no hace falta para el consenso.
  const c2 = new Consenso();
  for (const l of [L('P123ABC'), L('P123ABC', 0.95, 2), L('P123ABC'), L('P123ABC')]) c2.agregar(l);
  const r2 = c2.resultado();
  assert.equal(r2.estado, 'confirmada');
  assert.equal(r2.requiere_verificacion, false);
  assert.equal(r2.alguna_correccion, true, 'igual queda registrado que hubo una corrección');
});

test('prefijo desconocido: aunque haya consenso, requiere verificación', () => {
  const c = new Consenso();
  for (let i = 0; i < 3; i++) c.agregar(L('XQ123ABC', 0.97, 0, false));
  const r = c.resultado();
  assert.equal(r.estado, 'confirmada');
  assert.equal(r.requiere_verificacion, true);
});

test('las lecturas inválidas no votan; sin ninguna válida → ilegible «sin_lectura_valida»', () => {
  const c = new Consenso();
  c.agregar(L(null, 0.5));
  c.agregar(L('P123ABC'));
  c.agregar(L(null, 0.4));
  c.agregar(L('P123ABC'));
  assert.equal(c.resultado().estado, 'pendiente', '2 votos y queda 1 lectura');
  assert.equal(c.agregar(L('P123ABC')).estado, 'confirmada');
  const vacio = new Consenso({ maxLecturas: 3, maxIntentos: 3 });
  vacio.agregar(L(null)); vacio.agregar(L(null));
  const r = vacio.agregar(L(null));
  assert.deepEqual([r.estado, r.motivo, r.placa], ['ilegible', 'sin_lectura_valida', null]);
});

test('las lecturas sin forma de placa no gastan el cupo de las válidas, pero sí el de intentos', () => {
  // Caso real (clip «dos_seguidos» con la máquina cargada): una válida entre tres sin forma de placa. Antes era ilegible ahí.
  const c = new Consenso();
  for (const l of [L(null, 0.93), L('P555TRK'), L(null, 0.67), L(null, 0.94)]) c.agregar(l);
  assert.equal(c.resultado().estado, 'pendiente', '1 válida + quedan 4 intentos');
  c.agregar(L('P555TRK'));
  assert.equal(c.agregar(L('P555TRK')).estado, 'confirmada');
  // Con 8 intentos sin consenso, ilegible aunque queden válidas por gastar.
  const t = new Consenso();
  for (let i = 0; i < 7; i++) t.agregar(L(null));
  assert.equal(t.agregar(L('P123ABC')).estado, 'ilegible');
});

test('confianza baja: tres lecturas iguales a 0,80 no confirman y se declara ilegible sin gastar más', () => {
  const c = new Consenso();
  c.agregar(L('P123ABC', 0.8));
  assert.equal(c.agregar(L('P123ABC', 0.8)).estado, 'pendiente', 'con tres lecturas perfectas más llegaría a (1,6 + 3) / 5 = 0,92');
  const r = c.agregar(L('P123ABC', 0.8));
  assert.equal(r.votos, 3);
  assert.equal(r.estado, 'ilegible', 'ni con dos lecturas perfectas más: (2,4 + 2) / 5 = 0,88 < 0,90');
  assert.equal(r.total, 3);
});

test('configuración del consenso: valores por defecto y errores claros', () => {
  assert.deepEqual([configurar().minCoincidencias, configurar().confianzaMin, configurar().maxLecturas, configurar().maxIntentos], [3, 0.9, 5, 8]);
  assert.equal(configurar({ maxLecturas: 10, maxIntentos: 4 }).maxIntentos, 10, 'nunca menos intentos que lecturas válidas');
  assert.throws(() => configurar({ confianzaMin: 0.2 }), /confianzaMin/);
  assert.throws(() => configurar({ minCoincidencias: 4, maxLecturas: 3 }), /maxLecturas/);
});

test('de la salida del OCR a una lectura: placa canónica, correcciones y caja de la placa', () => {
  const ocr = {
    texto: 'GUATEMALA P 123ABC',
    items: [
      { texto: 'GUATEMALA', confianza: 0.99, box: { x: 30, y: 5, w: 60, h: 10 } },
      { texto: 'P 123ABC', confianza: 0.97, box: { x: 20, y: 20, w: 90, h: 25 } },
    ],
  };
  const l = lecturaDeOcr(ocr);
  assert.deepEqual([l.placa, l.valida, l.correcciones, l.prefijo_conocido, l.confianza], ['P123ABC', true, 0, true, 0.97]);
  assert.deepEqual(l.caja_placa, { x: 20, y: 20, w: 90, h: 25 });
  const conO = lecturaDeOcr({ items: [{ texto: 'P 12OABC', confianza: 0.9, box: { x: 0, y: 0, w: 10, h: 10 } }] });
  assert.deepEqual([conO.placa, conO.correcciones], ['P120ABC', 1]);
  const nada = lecturaDeOcr({ texto: '', items: [] });
  assert.deepEqual([nada.placa, nada.valida, nada.caja_placa], [null, false, null]);
});

test('caja de la placa con fragmentos partidos y sin los textos ajenos', () => {
  const items = [
    { texto: 'GUATEMALA', box: { x: 0, y: 0, w: 100, h: 10 } },
    { texto: 'P', box: { x: 10, y: 20, w: 10, h: 20 } },
    { texto: '123ABC', box: { x: 25, y: 22, w: 70, h: 20 } },
    { texto: 'TOYOTA', box: { x: 0, y: 60, w: 50, h: 10 } },
  ];
  assert.deepEqual(cajaDePlaca(items, 'P123ABC'), { x: 10, y: 20, w: 85, h: 22 }, 'la «P» suelta, pegada y en la misma línea, se suma');
  assert.equal(cajaDePlaca([{ texto: 'P', box: { x: 10, y: 20, w: 10, h: 20 } }], 'P123ABC'), null, 'una sola letra no basta para ubicarla');
  const lejos = [{ texto: '123ABC', box: { x: 100, y: 20, w: 70, h: 20 } }, { texto: 'P', box: { x: 0, y: 25, w: 8, h: 10 } }];
  assert.deepEqual(cajaDePlaca(lejos, 'P123ABC'), { x: 100, y: 20, w: 70, h: 20 }, 'una letra lejos (un logo) no se suma');
  assert.deepEqual(cajaDePlaca([{ texto: 'P 12OABC', box: { x: 1, y: 2, w: 3, h: 4 } }], 'P120ABC'), { x: 1, y: 2, w: 3, h: 4 }, 'con la confusión O/0');
  assert.equal(cajaDePlaca([{ texto: 'GUATEMALA', box: { x: 0, y: 0, w: 1, h: 1 } }], 'P123ABC'), null);
  assert.equal(esqueleto('p-12oabc'), esqueleto('P120ABC'), 'el esqueleto ignora las confusiones O/0');
});

test('calidad del recorte: grande, nítido y centrado gana; tocando el borde vale 0', () => {
  const base = { ancho: 960, alto: 540 };
  const grande = calidadRecorte({ ...base, bbox: { x: 200, y: 100, w: 560, h: 300 }, nitidez: 900 });
  const chico = calidadRecorte({ ...base, bbox: { x: 400, y: 100, w: 160, h: 90 }, nitidez: 900 });
  const borroso = calidadRecorte({ ...base, bbox: { x: 200, y: 100, w: 560, h: 300 }, nitidez: 5 });
  const lateral = calidadRecorte({ ...base, bbox: { x: 700, y: 100, w: 200, h: 120 }, nitidez: 900 });
  const centrado = calidadRecorte({ ...base, bbox: { x: 380, y: 100, w: 200, h: 120 }, nitidez: 900 });
  assert.ok(grande > chico && grande > borroso, `${grande} ${chico} ${borroso}`);
  assert.ok(centrado > lateral);
  assert.equal(calidadRecorte({ ...base, bbox: { x: 0, y: 100, w: 500, h: 300 }, nitidez: 900 }), 0);
  assert.equal(calidadRecorte({ ...base, bbox: { x: 100, y: 300, w: 500, h: 240 }, nitidez: 900 }), 0, 'cortado por abajo');
});

test('placa.js (copia de desktop/src/lib/placa.ts): formato, validación y mejor candidato', () => {
  assert.equal(normalizar('p-123 abc'), 'P123ABC');
  assert.equal(formatear('p123abc'), 'P-123ABC');
  assert.equal(formatear('xx'), 'XX');
  assert.equal(esValida('C-458DFG'), true);
  assert.equal(esValida('P12ABC'), false);
  assert.ok(candidatosDe('P123ABC', 0.9).some(c => c.placa === 'P123ABC' && c.correcciones === 0));
  const m = mejorCandidato([{ texto: 'GUATEMALA', confianza: 0.99 }, { texto: 'P', confianza: 0.98 }, { texto: '123ABC', confianza: 0.97 }]);
  assert.deepEqual([m.placa, m.valida, m.correcciones], ['P123ABC', true, 0]);
  const crudo = mejorCandidato([{ texto: 'HOLA', confianza: 0.5 }], 'xx');
  assert.deepEqual([crudo.valida, crudo.placa, crudo.requiereRevision], [false, 'HOLA', true]);
});
