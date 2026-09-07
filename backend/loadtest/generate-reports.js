// Genera reportes HTML estáticos y autocontenidos a partir de los JSON que
// produce "artillery run --output". Reemplaza a "artillery report", que fue
// deprecado en Artillery 2.x en favor de subir los datos a Artillery Cloud
// (no aplicable aquí: es un entregable académico con datos locales).
//
// Uso: node loadtest/generate-reports.js

const fs = require('fs');
const path = require('path');

const RESULTS_DIR = path.join(__dirname, 'results');
const TEAL = '#0F766E';
const TEAL_LIGHT = '#CCFBF1';
const RED = '#B91C1C';

const files = fs.readdirSync(RESULTS_DIR).filter(f => f.endsWith('.json'));

function fmt(n) {
  if (n === undefined || n === null || Number.isNaN(n)) return '—';
  return typeof n === 'number' ? (Number.isInteger(n) ? n : n.toFixed(1)) : n;
}

function buildPhaseRows(data) {
  const intermediate = data.intermediate || [];
  return intermediate.map(period => {
    const rt = period.summaries?.['http.response_time'];
    const requests = period.counters?.['http.requests'] || 0;
    const failed = period.counters?.['vusers.failed'] || 0;
    const errorKeys = Object.keys(period.counters || {}).filter(k => k.startsWith('errors.'));
    const errorCount = errorKeys.reduce((s, k) => s + period.counters[k], 0);
    const rate = requests > 0 ? (errorCount / (requests + errorCount)) * 100 : 0;
    return {
      ts: new Date(period.lastCounterAt || period.lastMetricAt).toLocaleTimeString('es-GT'),
      requests,
      failed,
      errorRate: rate,
      p95: rt?.p95,
      p99: rt?.p99,
    };
  });
}

function renderPhaseTable(rows) {
  if (!rows.length) return '';
  return `
    <table>
      <thead><tr><th>Hora</th><th>Requests</th><th>Fallidos</th><th>Tasa de error</th><th>p95 (ms)</th><th>p99 (ms)</th></tr></thead>
      <tbody>
        ${rows.map(r => `
          <tr class="${r.errorRate > 5 ? 'row-bad' : ''}">
            <td>${r.ts}</td>
            <td>${fmt(r.requests)}</td>
            <td>${fmt(r.failed)}</td>
            <td>${fmt(r.errorRate)}%</td>
            <td>${fmt(r.p95)}</td>
            <td>${fmt(r.p99)}</td>
          </tr>`).join('')}
      </tbody>
    </table>`;
}

function renderErrorChart(rows) {
  if (!rows.length) return '';
  const w = 760, h = 220, pad = 30;
  const barW = (w - pad * 2) / rows.length - 6;
  const bars = rows.map((r, i) => {
    const x = pad + i * ((w - pad * 2) / rows.length);
    const barH = Math.max(1, (r.errorRate / 100) * (h - pad * 2));
    const y = h - pad - barH;
    const color = r.errorRate > 50 ? RED : (r.errorRate > 5 ? '#D97706' : TEAL);
    return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${barH.toFixed(1)}" fill="${color}" rx="2"/>`;
  }).join('');
  return `
    <svg viewBox="0 0 ${w} ${h}" role="img" aria-label="Tasa de error por ventana de tiempo">
      <line x1="${pad}" y1="${h - pad}" x2="${w - pad}" y2="${h - pad}" stroke="var(--border)" />
      ${bars}
    </svg>`;
}

let indexRows = [];

for (const file of files) {
  const data = JSON.parse(fs.readFileSync(path.join(RESULTS_DIR, file), 'utf8'));
  const name = path.basename(file, '.json');
  const a = data.aggregate;
  const counters = a.counters || {};
  const codes = Object.entries(counters).filter(([k]) => k.startsWith('http.codes'));
  const errors = Object.entries(counters).filter(([k]) => k.startsWith('errors.'));
  const requests = counters['http.requests'] || 0;
  const failed = counters['vusers.failed'] || 0;
  const rt = a.summaries?.['http.response_time'] || {};
  const phaseRows = buildPhaseRows(data);
  // "http.requests" ya cuenta todos los intentos, incluyendo los que
  // terminaron en un error de red (timeout) sin código de respuesta HTTP.
  const totalReqIncludingErrors = requests;

  const html = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>Reporte de carga — ${name}</title>
<style>
  :root {
    --bg: #F6F8FA; --panel: #FFFFFF; --text: #1F2937; --muted: #6B7280;
    --border: #E2E8F0; --accent: ${TEAL}; --accent-bg: ${TEAL_LIGHT}; --bad: ${RED};
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--text); font-family: -apple-system, "Segoe UI", Roboto, sans-serif; padding: 32px; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .subtitle { color: var(--muted); font-size: 13px; margin-bottom: 24px; }
  .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; margin-bottom: 24px; }
  .card { background: var(--panel); border: 1px solid var(--border); border-radius: 10px; padding: 14px 16px; }
  .card .label { font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: .04em; }
  .card .value { font-size: 22px; font-weight: 600; margin-top: 4px; }
  .card .value.bad { color: var(--bad); }
  .card .value.ok { color: var(--accent); }
  section { background: var(--panel); border: 1px solid var(--border); border-radius: 10px; padding: 20px; margin-bottom: 20px; }
  section h2 { font-size: 14px; margin: 0 0 12px; }
  table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
  th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--border); }
  th { color: var(--muted); font-weight: 500; }
  tr.row-bad td { color: var(--bad); }
  svg { width: 100%; height: auto; }
  code { background: var(--accent-bg); padding: 1px 5px; border-radius: 4px; font-size: 12px; }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#0B1220; --panel:#111827; --text:#E5E7EB; --muted:#94A3B8; --border:#1F2A3C; --accent-bg:#134E4A; }
  }
</style>
</head>
<body>
  <h1>Reporte de carga — ${name}</h1>
  <div class="subtitle">SecureGate · Sprint 7 · generado ${new Date().toLocaleString('es-GT')}</div>

  <div class="cards">
    <div class="card"><div class="label">Requests totales</div><div class="value">${fmt(totalReqIncludingErrors)}</div></div>
    <div class="card"><div class="label">Exitosos</div><div class="value ok">${fmt(codes.reduce((s,[,v])=>s+v,0))}</div></div>
    <div class="card"><div class="label">Fallidos</div><div class="value ${failed > 0 ? 'bad' : ''}">${fmt(failed)}</div></div>
    <div class="card"><div class="label">p95 (ms)</div><div class="value">${fmt(rt.p95)}</div></div>
    <div class="card"><div class="label">p99 (ms)</div><div class="value">${fmt(rt.p99)}</div></div>
  </div>

  <section>
    <h2>Códigos de respuesta / errores de red</h2>
    <table>
      <thead><tr><th>Tipo</th><th>Cantidad</th></tr></thead>
      <tbody>
        ${codes.map(([k, v]) => `<tr><td>${k}</td><td>${fmt(v)}</td></tr>`).join('')}
        ${errors.map(([k, v]) => `<tr class="row-bad"><td>${k}</td><td>${fmt(v)}</td></tr>`).join('')}
      </tbody>
    </table>
  </section>

  ${phaseRows.length ? `
  <section>
    <h2>Tasa de error por ventana de ~10s (detecta el punto de quiebre)</h2>
    ${renderErrorChart(phaseRows)}
  </section>
  <section>
    <h2>Detalle por ventana de tiempo</h2>
    ${renderPhaseTable(phaseRows)}
  </section>` : ''}
</body>
</html>`;

  fs.writeFileSync(path.join(RESULTS_DIR, `${name}.html`), html);
  indexRows.push({ name, requests: totalReqIncludingErrors, failed, p95: rt.p95, p99: rt.p99 });
  console.log(`Generado: loadtest/results/${name}.html`);
}
