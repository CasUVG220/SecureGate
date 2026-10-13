'use strict';
// T4: extractor del DPI. Funciones puras sobre las líneas del OCR (sin modelos), más una prueba de punta a punta que
// se omite si los modelos no están descargados. TODOS los datos son inventados.
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  extraerDpi, agruparLineas, corregirCui, validarCui, corregirNombre, esEtiqueta, pareceNombre, formato454,
} = require('./dpi');

const it = (texto, confianza, x, y, w = 200, h = 40) => ({ texto, confianza, box: { x, y, w, h } });

/** Documento ficticio bien leído: encabezado, CUI, apellidos, nombres. */
const base = (over = {}) => [
  it('REPUBLICA DE GUATEMALA', 0.98, 170, 60, 470),
  it('CUI', 0.97, 430, 185, 48, 25),
  it(over.cui ?? '1234 56789 0101', over.confCui ?? 0.99, 430, 215, 480, 50),
  it('APELLIDOS / SURNAME', 0.99, 430, 295, 220, 25),
  it(over.apellidos ?? 'LOPEZ GARCIA', over.confApe ?? 0.97, 430, 325, 400, 40),
  it('NOMBRES / GIVEN NAMES', 0.98, 430, 392, 250, 25),
  it(over.nombres ?? 'ANA MARIA', over.confNom ?? 0.97, 430, 423, 260, 40),
  it('NACIONALIDAD / NATIONALITY', 0.98, 430, 491, 290, 25),
  it('GUATEMALTECA', 0.97, 430, 517, 240, 29),
];

test('lectura limpia: CUI, apellidos y nombres, sin revisión obligatoria', () => {
  const r = extraerDpi(base());
  assert.equal(r.cui, '1234567890101');
  assert.equal(r.cui_con_formato, '1234 56789 0101');
  assert.equal(r.cui_valido, true);
  assert.equal(r.departamento, 1);
  assert.equal(r.municipio, 1);
  assert.equal(r.apellidos, 'LOPEZ GARCIA');
  assert.equal(r.nombres, 'ANA MARIA');
  assert.deepEqual(r.correcciones, []);
  assert.equal(r.revision_obligatoria, false);
  assert.deepEqual(r.motivos, []);
  assert.ok(r.confianza.cui > 0.9 && r.confianza.nombres > 0.9 && r.confianza.apellidos > 0.9);
});

test('no inventa el dígito verificador: se declara no verificado', () => {
  assert.equal(extraerDpi(base()).verificador, 'no_verificado');
  assert.equal(validarCui('1234567890101').verificador, 'no_verificado');
});

test('el resultado no trae el texto crudo del documento ni la imagen', () => {
  const r = extraerDpi(base());
  assert.ok(!('texto' in r) && !('texto_completo' in r) && !('items' in r) && !('image' in r));
});

// ── Correcciones por posición en el CUI ──
for (const [leido, esperado, que] of [
  ['1234 56789 O1O1', '1234567890101', 'O→0'],
  ['1234 56789 0I0I', '1234567890101', 'I→1'],
  ['1234 56789 0l0l', '1234567890101', 'l→1'],
  ['B234 56789 0101', '8234567890101', 'B→8'],
  ['1234 S6789 0101', '1234567890101'.replace('5', '5'), 'S→5'],
  ['1234 56789 0Z01', '1234567890201', 'Z→2'],
  ['1234 5G789 0101', '1234567890101'.replace('6', '6'), 'G→6'],
]) {
  test(`corrección ${que}: «${leido}» → ${esperado} y exige revisión`, () => {
    const r = extraerDpi(base({ cui: leido }));
    assert.equal(r.cui, esperado);
    assert.ok(r.correcciones.some((c) => c.campo === 'cui'));
    assert.equal(r.revision_obligatoria, true);
    assert.ok(r.motivos.includes('cui_corregido'));
    assert.ok(r.confianza.cui < 0.99, 'la confianza se rebaja por corregir');
  });
}

test('corregirCui informa la posición, el carácter leído y el dígito', () => {
  const r = corregirCui('12O4 56789 0101');
  assert.deepEqual(r.correcciones, [{ campo: 'cui', posicion: 3, de: 'O', a: '0' }]);
  assert.equal(r.digitos, '1204567890101');
});

test('una palabra no es un CUI (letras que no son confusiones conocidas, o demasiadas correcciones)', () => {
  assert.equal(corregirCui('GUATEMALTECA'), null);
  assert.equal(corregirCui('SOSOSOSOSOSO'), null);
  assert.equal(corregirCui('12345'), null);
});

test('CUI en fragmentos separados por el OCR (4 · 5 · 4): se unen y salen con formato', () => {
  const items = base().filter((i) => !/\d{4} \d{5}/.test(i.texto));
  items.push(it('1234', 0.99, 432, 216, 135, 47), it('56789', 0.98, 589, 217, 165, 47), it('0101', 0.99, 775, 221, 136, 47));
  const r = extraerDpi(items);
  assert.equal(r.cui, '1234567890101');
  assert.equal(r.confianza.cui, 0.98, 'la confianza del CUI es la del fragmento más dudoso');
  assert.equal(agruparLineas(items).length >= 1, true);
});

// ── Validación ──
test('13 dígitos exactos: 12 o 14 son inválidos y piden revisión', () => {
  for (const cui of ['1234 56789 010', '1234 56789 01011']) {
    const r = extraerDpi(base({ cui }));
    assert.equal(r.cui_valido, false);
    assert.ok(r.cui_problemas.includes('longitud'));
    assert.ok(r.motivos.includes('cui_invalido'));
    assert.equal(r.revision_obligatoria, true);
  }
});

test('departamento 01-22 y municipio válido', () => {
  assert.equal(validarCui('1234567890101').valido, true);
  assert.equal(validarCui('1234567892217').valido, true);
  assert.deepEqual(validarCui('1234567890001').problemas, ['departamento']);
  assert.deepEqual(validarCui('1234567892301').problemas, ['departamento']);
  assert.deepEqual(validarCui('1234567890100').problemas, ['municipio']);
  assert.deepEqual(validarCui('1234567890199').problemas, ['municipio']);
  assert.deepEqual(validarCui('abc').problemas, ['longitud']);
});

test('formato 4-5-4', () => {
  assert.equal(formato454('1234 56789 0101'), true);
  assert.equal(formato454('1234567890101'), false);
});

test('sin CUI legible: no se inventa y se pide revisión', () => {
  const r = extraerDpi(base().filter((i) => !/\d{4} \d{5}/.test(i.texto)));
  assert.equal(r.cui, '');
  assert.equal(r.cui_valido, false);
  assert.ok(r.motivos.includes('cui_no_encontrado'));
  assert.equal(r.revision_obligatoria, true);
});

// ── Nombres ──
test('un dígito dentro de un nombre es una letra mal leída: 0→O, 1→I, 5→S, 8→B, y exige revisión', () => {
  const r = extraerDpi(base({ nombres: 'J0SE LU1S', apellidos: 'G4RCIA' }));
  assert.equal(r.nombres, 'JOSE LUIS');
  assert.ok(r.correcciones.some((c) => c.campo === 'nombres' && c.de === '0' && c.a === 'O'));
  assert.ok(r.motivos.includes('nombres_corregido'));
  assert.equal(r.revision_obligatoria, true);
  assert.deepEqual(corregirNombre('5ARA 8LANCO').texto, 'SARA BLANCO');
});

test('las tildes y la Ñ se conservan si el OCR las entrega', () => {
  const r = extraerDpi(base({ apellidos: 'MUÑOZ NÚÑEZ', nombres: 'JOSÉ' }));
  assert.equal(r.apellidos, 'MUÑOZ NÚÑEZ');
  assert.equal(r.nombres, 'JOSÉ');
});

test('etiquetas torcidas por el OCR se reconocen igual', () => {
  assert.equal(esEtiqueta('APELLIDOS/SURNAME', 'apellidos'), true);
  assert.equal(esEtiqueta('APELLDOS / SURNAM', 'apellidos'), true);
  assert.equal(esEtiqueta('N O M B R E S', 'nombres'), true);
  assert.equal(esEtiqueta('NOMBRES / GIVEN NAMES', 'nombres'), true);
  assert.equal(esEtiqueta('GUATEMALTECA', 'nombres'), false);
  assert.equal(esEtiqueta('LOPEZ GARCIA', 'apellidos'), false);
});

test('qué parece nombre de persona y qué no', () => {
  assert.equal(pareceNombre('LOPEZ GARCIA'), true);
  assert.equal(pareceNombre('DE LEON'), true);
  assert.equal(pareceNombre('GUATEMALTECA'), false);
  assert.equal(pareceNombre('FECHA DE NACIMIENTO'), false);
  assert.equal(pareceNombre('25 ENE 2002'), false);
  assert.equal(pareceNombre('1234 56789 0101'), false);
});

test('sin etiquetas legibles: apellidos y nombres por orden, con confianza rebajada y revisión', () => {
  const items = base().filter((i) => !/SURNAME|GIVEN/.test(i.texto));
  const r = extraerDpi(items);
  assert.equal(r.apellidos, 'LOPEZ GARCIA');
  assert.equal(r.nombres, 'ANA MARIA');
  assert.ok(r.motivos.includes('apellidos_por_posicion') && r.motivos.includes('nombres_por_posicion'));
  assert.equal(r.revision_obligatoria, true);
  assert.ok(r.confianza.apellidos < 0.97);
});

test('confianza baja en un campo fuerza revisión aunque nada se haya corregido', () => {
  const r = extraerDpi(base({ confCui: 0.6 }));
  assert.ok(r.motivos.includes('cui_confianza_baja'));
  assert.equal(r.revision_obligatoria, true);
  const r2 = extraerDpi(base({ confNom: 0.4 }));
  assert.ok(r2.motivos.includes('nombres_confianza_baja'));
});

test('entrada vacía o basura no lanza', () => {
  assert.equal(extraerDpi([]).revision_obligatoria, true);
  assert.equal(extraerDpi(undefined).cui, '');
  assert.equal(extraerDpi([{ texto: '', confianza: 1 }, null, { texto: 5 }]).cui, '');
});

// ── Punta a punta con el OCR real (se omite sin modelos) ──
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const modelos = path.join(__dirname, '..', 'models', 'SHA256SUMS');

test('punta a punta con el OCR real sobre un DPI ficticio (se omite sin modelos)', { skip: !fs.existsSync(modelos) }, async () => {
  const sc = require('./server');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dpi-e2e-'));
  execFileSync(process.execPath, [path.join(__dirname, '..', 'fixtures-dpi', 'generar.mjs'), '--out', dir, '--n', '1', '--seed', '5'], { stdio: 'pipe' });
  const verdad = fs.readFileSync(path.join(dir, 'verdad_terreno.csv'), 'utf8').trim().split('\n')[1].split(',');
  const service = sc.createService(sc.resolveModels(path.join(__dirname, '..', 'models')));
  await service.initialize();
  try {
    const r = await sc.reconocerDpi(service, fs.readFileSync(path.join(dir, verdad[0])).toString('base64'));
    assert.equal(r.cui, verdad[1]);
    assert.ok(r.ms_total < 5000, `RNF-03: ${r.ms_total} ms`);
    assert.ok(!('texto' in r));
  } finally {
    await service.destroy();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
