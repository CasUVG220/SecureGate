// Tarea 7 (Sprint 10): partes puras del medidor del ANPR (sin procesos). Correr con: node --test desktop/scripts/
import test from 'node:test';
import assert from 'node:assert/strict';
import { ejecutableDePruebas, medicionDe, mitigaciones, OBJETIVOS, percentiles, reporteMarkdown } from './medir-anpr.mjs';

test('encuentra el ejecutable de pruebas de la biblioteca en la salida JSON de cargo', () => {
  const salida = [
    'Compiling …',
    JSON.stringify({ reason: 'compiler-artifact', target: { name: 'securegate_garita_lib' }, profile: { test: false }, executable: null }),
    JSON.stringify({ reason: 'compiler-artifact', target: { name: 'otro' }, profile: { test: true }, executable: '/x/otro' }),
    JSON.stringify({ reason: 'compiler-artifact', target: { name: 'securegate_garita_lib' }, profile: { test: true }, executable: '/t/deps/securegate_garita_lib-abc' }),
    '{roto',
  ].join('\n');
  assert.equal(ejecutableDePruebas(salida), '/t/deps/securegate_garita_lib-abc');
  assert.equal(ejecutableDePruebas('nada'), null);
});

test('lee la línea MEDICION_ANPR de la prueba', () => {
  assert.deepEqual(medicionDe('running 1 test\nANPR_LISTO\nMEDICION_ANPR {"carriles":2}\ntest ok'), { carriles: 2 });
  assert.equal(medicionDe('sin medición'), null);
});

test('percentiles', () => {
  assert.deepEqual(percentiles([]), { n: 0, p50: null, p95: null, max: null });
  assert.deepEqual(percentiles([300, 100, 200]), { n: 3, p50: 200, p95: 300, max: 300 });
});

test('mitigación solo cuando algo pasa de los objetivos, y dice qué hacer', () => {
  const bien = { latenciaTotal: { p95: 900 }, rust: { cpuTotalPct: 1, ramPicoMB: 40 }, sidecar: { cpuTotalPct: 20, ramPicoMB: 400 } };
  assert.deepEqual(mitigaciones(bien, 4), []);
  const mal = { latenciaTotal: { p95: OBJETIVOS.latenciaMs + 1 }, rust: { cpuTotalPct: 5, ramPicoMB: 100 }, sidecar: { cpuTotalPct: 50, ramPicoMB: 1500 } };
  const m = mitigaciones(mal, 4);
  assert.equal(m.length, 3);
  assert.match(m[0], /Cuadros por segundo con movimiento/);
  assert.match(m[1], /55\.0 %/);
  assert.match(m[2], /1600 MB/);
});

test('el reporte deja «—» donde no hay dato (no inventa números)', () => {
  const md = reporteMarkdown({
    modo: 'pipeline', perfil: 'debug',
    equipo: { cpu: 'CPU de prueba', nucleos: 4, ramTotalGB: 8, sistema: 'Linux', fecha: '2026-10-22T00:00:00Z' },
    escenarios: [{ nombre: 'Vacío', rust: null, sidecar: null, medicion: null, latenciaTotal: { p95: null } }],
  });
  assert.match(md, /\| Vacío \| — \| — \| — \| — \| 0\.0 \| — \|/);
  assert.match(md, /sin mitigación/);
});
