'use strict';
// Genera (en markdown) las tablas del reporte del Sprint 8 a partir de results/sprint8-*.json y
// results/recursos-*.csv. Uso: node loadtest/sprint8-resumen.js
const fs = require('fs'), path = require('path');
const dir = path.join(__dirname, 'results');
const ESC = [['activar', 'sprint8-activar'], ['heartbeat', 'sprint8-heartbeat'], ['sync', 'sprint8-sync-garita'], ['accesos-idcliente', 'sprint8-accesos-idcliente']];
const f1 = n => (n === undefined || n === null ? '—' : (Math.round(n * 10) / 10).toString());
const out = [];

out.push('### Resumen agregado\n');
out.push('| Escenario | VU creados | Peticiones | Duración | req/s medio | Códigos | Errores | p50 | p95 | p99 | p99.9 | máx |\n|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const [, n] of ESC) {
  const a = JSON.parse(fs.readFileSync(path.join(dir, `${n}.json`))).aggregate, c = a.counters, rt = a.summaries['http.response_time'];
  const codes = Object.entries(c).filter(([k]) => k.startsWith('http.codes.')).map(([k, v]) => `${k.slice(11)} ×${v}`).join(', ');
  const errs = Object.entries(c).filter(([k]) => k.startsWith('errors.')).reduce((s, [, v]) => s + v, 0);
  out.push(`| ${n.replace('sprint8-', '')} | ${c['vusers.created']} | ${c['http.requests']} | ${Math.round((a.lastMetricAt - a.firstMetricAt) / 1000)} s | ${Math.round(c['http.requests'] / ((a.lastMetricAt - a.firstMetricAt) / 1000))} | ${codes} | **${errs}** | ${rt.median} | ${rt.p95} | ${rt.p99} | ${rt.p999} | ${rt.max} |`);
}
out.push('\n### Recursos durante la carga\n');
out.push('| Escenario | Backend CPU (media / pico) | Backend memoria (pico) | Postgres CPU (media / pico) | Postgres memoria (pico) | Conexiones a Postgres (pico de 20) | Consultas activas (pico) |\n|---|---|---|---|---|---|---|');
for (const [e, n] of ESC) {
  const p = path.join(dir, `recursos-${e}.csv`); if (!fs.existsSync(p)) continue;
  const rows = fs.readFileSync(p, 'utf8').trim().split('\n').slice(1).map(l => l.split(',').map(x => (x.includes('*') ? eval(x) : Number(x))));
  const carga = rows.filter(r => r[1] > 15);            // muestras con carga real (CPU del backend > 15 %)
  const S = a => (a.length ? a : [0]);
  const avg = a => S(a).reduce((s, x) => s + x, 0) / S(a).length, max = a => Math.max(...S(a));
  const col = i => carga.map(r => r[i]);
  out.push(`| ${e} | ${f1(avg(col(1)))} % / **${f1(max(col(1)))} %** | ${f1(max(rows.map(r => r[2])))} MiB | ${f1(avg(col(3)))} % / ${f1(max(col(3)))} % | ${f1(max(rows.map(r => r[4])))} MiB | **${max(rows.map(r => r[5]))}** | ${max(rows.map(r => r[6]))} |`);
}
for (const [e, n] of ESC) {
  const j = JSON.parse(fs.readFileSync(path.join(dir, `${n}.json`)));
  out.push(`\n#### ${e}: ventanas de 10 s\n`);
  out.push('| Ventana | req/s | p50 | p95 | p99 | máx | errores |\n|---|---|---|---|---|---|---|');
  j.intermediate.forEach((p, i) => {
    const s = p.summaries && p.summaries['http.response_time'], req = p.counters['http.requests'] || 0;
    if (!s || req < 20) return;
    const er = Object.entries(p.counters).filter(([k]) => k.startsWith('errors.')).reduce((a, [, v]) => a + v, 0);
    out.push(`| ${i * 10}–${i * 10 + 10} s | ${Math.round(req / 10)} | ${s.median} | ${s.p95} | ${s.p99} | ${s.max} | ${er} |`);
  });
}
console.log(out.join('\n'));
