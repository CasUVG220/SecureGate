'use strict';
// Sustituye JWT y cabeceras Authorization por marcadores en TODOS los artefactos de results/
// (salvo fixtures.json y snap/, que están fuera de git). Uso: node redactar.js
const fs = require('fs'), path = require('path');
const JWT = /eyJ[A-Za-z0-9_-]{12,}(?:\.[A-Za-z0-9_-]*){0,2}/g;   // también los truncados por los logs
const BEARER = /(Bearer\s+)[A-Za-z0-9._-]{20,}/g;
let n = 0;
const recorrer = d => fs.readdirSync(d, { withFileTypes: true }).forEach(e => {
  const p = path.join(d, e.name);
  if (e.isDirectory()) { if (e.name !== 'snap') recorrer(p); return; }
  if (e.name === 'fixtures.json' || !/\.(json|log|txt|md|html|csv)$/.test(e.name)) return;
  const s = fs.readFileSync(p, 'utf8');
  const t = s.replace(BEARER, '$1<jwt-redactado>').replace(JWT, '<jwt-redactado>');
  if (t !== s) { fs.writeFileSync(p, t); n++; }
});
recorrer(path.join(__dirname, 'results'));
console.log(`redactados ${n} archivos`);
