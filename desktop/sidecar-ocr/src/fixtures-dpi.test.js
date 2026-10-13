'use strict';
// T3: el generador del conjunto SINTÉTICO de DPI es reproducible y solo produce datos ficticios con el formato esperado.
const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const generador = path.join(__dirname, '..', 'fixtures-dpi', 'generar.mjs');
const generar = (semilla, n = 8) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dpi-sint-'));
  execFileSync(process.execPath, [generador, '--out', dir, '--n', String(n), '--seed', String(semilla)], { stdio: 'pipe' });
  const csv = fs.readFileSync(path.join(dir, 'verdad_terreno.csv'), 'utf8');
  const imagenes = fs.readdirSync(dir).filter(f => f.endsWith('.jpg'));
  fs.rmSync(dir, { recursive: true, force: true });
  return { csv, imagenes };
};

test('misma semilla → mismo CSV de verdad terreno; otra semilla → otros datos', () => {
  const a = generar(7), b = generar(7), c = generar(8);
  assert.equal(a.csv, b.csv);
  assert.notEqual(a.csv, c.csv);
});

test('cada fila: CUI de 13 dígitos con departamento 01-22 y municipio válido, nombres en mayúsculas, imagen existente', () => {
  const { csv, imagenes } = generar(11, 14);
  const filas = csv.trim().split('\n').slice(1).map(l => l.split(','));
  assert.equal(filas.length, 14);
  assert.equal(imagenes.length, 14);
  for (const [archivo, cui, nombres, apellidos, variante] of filas) {
    assert.match(archivo, /^img_\d{4}\.jpg$/);
    assert.match(cui, /^\d{13}$/);
    const depto = Number(cui.slice(9, 11)), muni = Number(cui.slice(11));
    assert.ok(depto >= 1 && depto <= 22, `depto ${depto}`);
    assert.ok(muni >= 1 && muni <= 17, `muni ${muni}`);
    assert.match(nombres, /^[A-ZÁÉÍÓÚÑ ]+$/);
    assert.match(apellidos, /^[A-ZÁÉÍÓÚÑ ]+ [A-ZÁÉÍÓÚÑ ]+$/);
    assert.ok(['limpia', 'luz_baja', 'luz_alta', 'angulo', 'ruido', 'desenfoque', 'mixta'].includes(variante));
  }
});

test('cubre todas las variantes de captura', () => {
  const { csv } = generar(3, 7);
  const variantes = new Set(csv.trim().split('\n').slice(1).map(l => l.split(',')[4]));
  assert.equal(variantes.size, 7);
});
