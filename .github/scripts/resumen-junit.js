#!/usr/bin/env node
/**
 * Resumen en Markdown de los reportes JUnit (jest-junit) para $GITHUB_STEP_SUMMARY.
 * Uso: node .github/scripts/resumen-junit.js backend/reports >> "$GITHUB_STEP_SUMMARY"
 */
const fs = require('fs');
const path = require('path');

const dir = process.argv[2] || 'backend/reports';
const archivos = [['integracion.xml', 'Integración'], ['regresion.xml', 'Regresión']];
const attr = (s, k) => (s.match(new RegExp(`\\b${k}="([^"]*)"`)) || [])[1];
const desescapar = s => String(s || '').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&#10;/g, '\n').replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16))).replace(/&amp;/g, '&');

let total = 0, fallos = 0;
const filas = [];
const detalle = [];

for (const [archivo, nombre] of archivos) {
  const ruta = path.join(dir, archivo);
  if (!fs.existsSync(ruta)) { filas.push(`| ${nombre} | — | — | — | sin reporte |`); continue; }
  const xml = fs.readFileSync(ruta, 'utf8');
  const raiz = xml.match(/<testsuites[^>]*>/)[0];
  const tests = parseInt(attr(raiz, 'tests') || '0', 10);
  const fall = parseInt(attr(raiz, 'failures') || '0', 10) + parseInt(attr(raiz, 'errors') || '0', 10);
  const tiempo = parseFloat(attr(raiz, 'time') || '0').toFixed(1);
  total += tests; fallos += fall;
  filas.push(`| ${nombre} | ${tests} | ${tests - fall} | ${fall} | ${tiempo} s |`);
  for (const m of xml.matchAll(/<testcase\b([^>]*?)>\s*<failure\b([^>]*)>([\s\S]*?)<\/failure>/g)) {
    const titulo = desescapar(attr(m[1], 'name'));
    const msg = desescapar(m[3]).split('\n').map(l => l.trim()).filter(Boolean).slice(0, 4).join(' · ');
    detalle.push(`- **${nombre}** › ${titulo}\n  - ${msg}`);
  }
}

console.log(`## ${fallos === 0 && total > 0 ? '✅' : '❌'} Pruebas de integración y regresión\n`);
console.log('| Suite | Pruebas | Pasan | Fallan | Tiempo |\n|---|---:|---:|---:|---:|');
console.log(filas.join('\n'));
console.log(`\n**Total:** ${total} pruebas, ${fallos} con fallo.\n`);
if (detalle.length) console.log(`### Pruebas que fallan\n\n${detalle.join('\n')}\n`);
