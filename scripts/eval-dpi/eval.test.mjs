// T3: lógica de métricas del evaluador de DPI (sin OCR ni red). Correr con: node --test scripts/eval-dpi/
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizar, estricto, soloDigitos, percentil, leerCsv, resumir, reporteMarkdown } from './index.mjs';

test('percentil por rango más cercano', () => {
  assert.equal(percentil([], 50), null);
  assert.equal(percentil([10], 95), 10);
  const v = Array.from({ length: 100 }, (_, i) => i + 1);
  assert.equal(percentil(v, 50), 50);
  assert.equal(percentil(v, 95), 95);
  assert.equal(percentil([5, 1, 3], 50), 3);
});

test('normalizar quita tildes, pasa a mayúsculas y colapsa espacios; estricto conserva las tildes', () => {
  assert.equal(normalizar('  josé   MUÑOZ '), 'JOSE MUNOZ');
  assert.equal(estricto('  josé   muñoz '), 'JOSÉ MUÑOZ');
  assert.equal(soloDigitos('7093 67348 1002'), '7093673481002');
});

test('leerCsv', () => {
  const filas = leerCsv('archivo,cui,nombres,apellidos\nimg_1.jpg,1234567890101,ANA,LOPEZ GARCIA\n');
  assert.deepEqual(filas, [{ archivo: 'img_1.jpg', cui: '1234567890101', nombres: 'ANA', apellidos: 'LOPEZ GARCIA' }]);
});

const d = (over) => ({ archivo: 'a', variante: 'limpia', error: null, cui_ok: true, nombres_ok: true, apellidos_ok: true, nombre_completo_ok: true,
  nombres_estricto: true, apellidos_estricto: true, requiere_revision: false, ms: 100, ms_inferencia: 80, nota: null, ...over });

test('resumir: exactitud, revisión, errores silenciosos y tiempos', () => {
  const r = resumir([
    d({}), d({ ms: 200 }),
    d({ cui_ok: false, requiere_revision: true, variante: 'ruido' }),     // mal pero marcado: no es silencioso
    d({ cui_ok: false, requiere_revision: false, variante: 'ruido' }),    // mal y sin marcar: silencioso
    d({ requiere_revision: true }),                                       // bien pero marcado: revisión innecesaria
  ]);
  assert.equal(r.n, 5);
  assert.equal(r.cui.aciertos, 3);
  assert.equal(r.cui.pct, 60);
  assert.equal(r.revision.tasa_pct, 40);
  assert.equal(r.revision.errores_silenciosos, 1);
  assert.equal(r.revision.revisiones_innecesarias, 1);
  assert.deepEqual(r.por_variante.ruido, { n: 2, cui_ok: 0, cui_pct: 0 });
  assert.equal(r.tiempo_ms.p50, 100);
  assert.equal(r.meta_rnf03_5s, true);
});

test('resumir: un motor que no informa nombres ni revisión (Vision) queda en n/d, sin inventar', () => {
  const r = resumir([d({ nombres_ok: null, apellidos_ok: null, nombres_estricto: null, apellidos_estricto: null, requiere_revision: null })]);
  assert.equal(r.nombres.n, 0);
  assert.equal(r.revision.informada, false);
});

test('la meta de 5 s se incumple si el p95 la pasa', () => {
  assert.equal(resumir([d({ ms: 6000 })]).meta_rnf03_5s, false);
});

test('el reporte advierte que un conjunto sintético no es evidencia', () => {
  const md = reporteMarkdown([{ motor: 'local', extractor: 'x', resumen: resumir([d({})]) }], { fecha: 'hoy', dir: 'x', n: 1, origen: 'local', sintetico: true });
  assert.match(md, /SINTÉTICO/);
  assert.match(md, /NO es evidencia/);
  assert.match(md, /Exactitud del CUI/);
});
