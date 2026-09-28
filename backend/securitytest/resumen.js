'use strict';
// Resume results/*.json (suites 01-09) en una tabla por suite y lista las fallas agrupadas.
// Uso: node resumen.js [--fallas]
const fs = require('fs'), path = require('path');
const dir = path.join(__dirname, 'results');
const suites = fs.readdirSync(dir).filter(f => /^\d\d-.*\.json$/.test(f)).sort();
let tot = 0, tf = 0;
for (const f of suites) {
  const s = JSON.parse(fs.readFileSync(path.join(dir, f)));
  const c = { OK: 0, FALLA: 0, INFO: 0 };
  s.items.forEach(i => c[i.resultado] = (c[i.resultado] || 0) + 1);
  tot += s.items.length; tf += c.FALLA;
  console.log(`${s.id.padEnd(18)} ${String(s.items.length).padStart(4)} pruebas  ok ${String(c.OK).padStart(4)}  falla ${String(c.FALLA).padStart(4)}  info ${c.INFO}`);
  if (process.argv.includes('--fallas'))
    for (const i of s.items.filter(i => i.resultado === 'FALLA').slice(0, 400))
      console.log(`     [${i.severidad || '-'}] ${i.id} → ${i.real.status}`);
}
console.log(`TOTAL ${tot} pruebas, ${tf} fallas`);
