'use strict';
// Caracterización del camino LOCAL del DPI (Sprint 10, OCR 100 % local, tarea 1). Fija lo que hoy hacen las reglas de
// lectura del DPI y el OCR local con DPI SINTÉTICOS (ficticios), para que retirar el OCR remoto no degrade nada. Ver
// docs/ocr_local_decision.md. Si una regla cambia A PROPÓSITO, se vuelve a grabar con `node fixtures-dpi/caracterizar.mjs`.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { extraerDpi } = require('./dpi');

const GRABADO = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures-dpi', 'caracterizacion.json'), 'utf8'));
const fijados = (r) => ({
  cui: r.cui, cui_valido: r.cui_valido, nombres: r.nombres, apellidos: r.apellidos,
  revision_obligatoria: r.revision_obligatoria, motivos: r.motivos, correcciones: r.correcciones.length,
});

test('reglas del DPI: con las mismas líneas del OCR, la extracción es EXACTAMENTE la grabada (12 DPI sintéticos)', () => {
  assert.equal(GRABADO.casos.length, 12);
  for (const c of GRABADO.casos) {
    assert.deepEqual(fijados(extraerDpi(c.items)), c.esperado, `${c.archivo} (${c.verdad.variante})`);
  }
});

test('lo grabado cubre los dos caminos: lecturas que pasan solas y lecturas que van a revisión, nunca un CUI malo sin marcar', () => {
  const casos = GRABADO.casos;
  assert.ok(casos.some(c => !c.esperado.revision_obligatoria && c.esperado.cui === c.verdad.cui), 'hay lecturas limpias');
  assert.ok(casos.some(c => c.esperado.revision_obligatoria), 'hay lecturas que van a revisión');
  for (const c of casos) {
    if (c.esperado.cui && c.esperado.cui !== c.verdad.cui) assert.equal(c.esperado.revision_obligatoria, true, `${c.archivo}: CUI malo sin revisión`);
  }
});

// ── Punta a punta con el OCR real (se omite sin modelos) ──
const modelos = path.join(__dirname, '..', 'models', 'SHA256SUMS');

test('punta a punta (enderezado + OCR local + reglas) sobre los mismos 12 DPI: cero errores silenciosos y la exactitud grabada', { skip: !fs.existsSync(modelos) }, async () => {
  const { generarConjunto, resumir } = await import('../fixtures-dpi/caracterizar.mjs');
  const sc = require('./server');
  const { dir, filas } = generarConjunto(GRABADO.semilla, GRABADO.documentos);
  const service = sc.createService(sc.resolveModels(path.join(__dirname, '..', 'models')));
  await service.initialize();
  try {
    const pares = [];
    for (const v of filas) {
      const r = await sc.reconocerDpi(service, fs.readFileSync(path.join(dir, v.archivo)).toString('base64'));
      assert.ok(!('texto' in r) && !('texto_completo' in r), 'el resultado nunca trae el texto crudo del documento');
      pares.push({ verdad: v, r });
    }
    const hoy = resumir(pares);
    const antes = GRABADO.punta_a_punta;
    assert.equal(hoy.errores_silenciosos, 0, `errores silenciosos: ${JSON.stringify(hoy)}`);
    // Un documento de margen: la inferencia en otra CPU puede mover un carácter dudoso (que entonces va a revisión).
    assert.ok(hoy.cui_exactos >= antes.cui_exactos - 1, `CUI exactos ${hoy.cui_exactos} < grabados ${antes.cui_exactos} − 1`);
    assert.ok(hoy.a_revision <= antes.a_revision + 1, `a revisión ${hoy.a_revision} > grabados ${antes.a_revision} + 1`);
  } finally {
    await service.destroy();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
