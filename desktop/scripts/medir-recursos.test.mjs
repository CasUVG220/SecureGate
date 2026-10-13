// T9: partes puras del medidor de recursos (sin procesos ni red). Correr con: node --test desktop/scripts/
import test from 'node:test';
import assert from 'node:assert/strict';
import { cpuAsegundos, parsearPs, parsearWindows, arbol, resumirMuestras, reporteMarkdown } from './medir-recursos.mjs';

test('el tiempo de CPU de ps se convierte a segundos en todos sus formatos', () => {
  assert.equal(cpuAsegundos('0:01.50'), 1.5);
  assert.equal(cpuAsegundos('01:30'), 90);
  assert.equal(cpuAsegundos('1:02:03'), 3723);
  assert.equal(cpuAsegundos('2-01:00:00'), 2 * 86400 + 3600);
  assert.equal(cpuAsegundos('basura'), 0);
});

test('parsea la salida de ps', () => {
  const p = parsearPs('  100     1  2048  0:00.10\n  200   100 51200 00:12.50\nlinea rara\n');
  assert.deepEqual(p, [{ pid: 100, ppid: 1, rssKB: 2048, cpuS: 0.1 }, { pid: 200, ppid: 100, rssKB: 51200, cpuS: 12.5 }]);
});

test('parsea la salida CSV de PowerShell (Windows): memoria en bytes y tiempos en unidades de 100 ns', () => {
  const csv = '"ProcessId","ParentProcessId","WorkingSetSize","KernelModeTime","UserModeTime"\r\n"4321","1000","104857600","10000000","20000000"\r\n"4400","4321","52428800","0","5000000"\r\n';
  const p = parsearWindows(csv);
  assert.equal(p.length, 2);
  assert.deepEqual(p[0], { pid: 4321, ppid: 1000, rssKB: 102400, cpuS: 3 });
  assert.equal(p[1].cpuS, 0.5);
  assert.deepEqual(parsearWindows(''), []);
});

test('el árbol incluye a la raíz y a todos sus descendientes, y a nadie más', () => {
  const ps = [{ pid: 1, ppid: 0 }, { pid: 10, ppid: 1 }, { pid: 11, ppid: 10 }, { pid: 12, ppid: 10 }, { pid: 20, ppid: 1 }, { pid: 99, ppid: 98 }].map(p => ({ ...p, rssKB: 0, cpuS: 0 }));
  assert.deepEqual(arbol(ps, 10).map(p => p.pid).sort((a, b) => a - b), [10, 11, 12]);
  assert.deepEqual(arbol(ps, 777), []);
});

test('CPU como % de un núcleo y del total, y RAM pico y promedio', () => {
  const m = [{ t: 0, cpuS: 10, rssKB: 40 * 1024 }, { t: 10, cpuS: 11, rssKB: 60 * 1024 }, { t: 20, cpuS: 12, rssKB: 50 * 1024 }];
  const r = resumirMuestras(m, 4);
  assert.equal(r.cpuNucleoPct, 10);                 // 2 s de CPU en 20 s
  assert.equal(r.cpuTotalPct, 2.5);                 // entre 4 núcleos
  assert.equal(r.ramPicoMB, 60);
  assert.equal(r.ramPromMB, 50);
  assert.deepEqual(resumirMuestras([{ t: 0, cpuS: 0, rssKB: 1 }], 4).cpuNucleoPct, 0);
});

test('un contador que se reinicia (un proceso termina) no da CPU negativa', () => {
  assert.equal(resumirMuestras([{ t: 0, cpuS: 50, rssKB: 1024 }, { t: 10, cpuS: 5, rssKB: 1024 }], 2).cpuNucleoPct, 0);
});

test('el reporte avisa si el equipo no es de 6 a 8 GB', () => {
  const rep = { modo: 'puente', equipo: { cpu: 'X', nucleos: 4, ramTotalGB: 16, sistema: 'Linux', fecha: 'hoy' }, camaras: 'sim', escenarios: [{ nombre: '1 flujo', cpuNucleoPct: 5, cpuTotalPct: 1.2, ramPicoMB: 40, ramPromMB: 39, procesos: 1, fps: 9.8 }] };
  const md = reporteMarkdown(rep);
  assert.match(md, /objetivo es de \*\*6 a 8 GB\*\*/);
  assert.match(md, /\| 1 flujo \| 5 \| 1\.2 \| 40 \| 39 \| 1 \| 9\.8 \|/);
  assert.doesNotMatch(reporteMarkdown({ ...rep, equipo: { ...rep.equipo, ramTotalGB: 8 } }), /objetivo es de/);
});
