'use strict';
// T4: estimación de la inclinación del documento (en memoria, con una imagen dibujada en la prueba).
const test = require('node:test');
const assert = require('node:assert/strict');
const { createCanvas } = require('@napi-rs/canvas');
const { estimarInclinacion, rotar } = require('./enderezar');

function documento(grados) {
  const c = createCanvas(640, 360);
  const g = c.getContext('2d');
  g.fillStyle = '#3b3f45'; g.fillRect(0, 0, 640, 360);
  g.translate(320, 180); g.rotate((grados * Math.PI) / 180);
  g.fillStyle = '#e8eef4'; g.fillRect(-250, -150, 500, 300);
  g.fillStyle = '#111'; g.font = 'bold 30px sans-serif';
  ['REPUBLICA DE GUATEMALA', '1234 56789 0101', 'LOPEZ GARCIA', 'ANA MARIA'].forEach((t, i) => g.fillText(t, -220, -90 + i * 55));
  return c.toBuffer('image/jpeg', 92);
}

test('un documento derecho no se toca', async () => {
  assert.equal((await estimarInclinacion(documento(0))).grados, 0);
});

for (const g of [-12, -6, 8, 14]) {
  test(`documento girado ${g}°: devuelve el giro que lo endereza (±1°)`, async () => {
    const r = await estimarInclinacion(documento(g));
    assert.ok(Math.abs(r.grados + g) <= 1, `estimó ${r.grados} para ${g}`);
  });
}

test('rotar devuelve un JPEG del mismo tamaño y no escribe archivos', async () => {
  const out = await rotar(documento(10), -10);
  assert.ok(out.length > 1000);
  assert.equal(out[0], 0xff); assert.equal(out[1], 0xd8);
});
