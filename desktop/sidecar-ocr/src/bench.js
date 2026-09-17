/**
 * Mide el tiempo de inferencia por imagen del OCR de placas, en el mismo
 * proceso y con la misma configuración que usa el sidecar. Sirve para
 * comparar contra el hardware mínimo objetivo (6-8 GB RAM, PRODUCT.md).
 *
 *   node src/bench.js [carpeta-o-imagen ...]   (por defecto: test-assets/)
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const os = require('node:os');
const { createService, recognize, resolveModels } = require('./server');

async function main() {
  const inputs = process.argv.slice(2);
  const targets = inputs.length ? inputs : [path.join(__dirname, '..', 'test-assets')];
  const files = targets.flatMap(t => fs.statSync(t).isDirectory()
    ? fs.readdirSync(t).filter(f => /\.(jpe?g|png)$/i.test(f)).map(f => path.join(t, f))
    : [t]);

  const t0 = performance.now();
  const service = createService(resolveModels(path.join(__dirname, '..', 'models')));
  await service.initialize();
  const msCarga = Math.round(performance.now() - t0);

  console.log(`CPU: ${os.cpus()[0].model} × ${os.cpus().length} | RAM: ${(os.totalmem() / 2 ** 30).toFixed(1)} GB | node ${process.version}`);
  console.log(`Carga de modelos: ${msCarga} ms\n`);

  const tiempos = [];
  for (const f of files) {
    const b64 = fs.readFileSync(f).toString('base64');
    // Primera pasada "caliente": la 1.ª inferencia paga inicialización de ORT.
    const runs = [];
    for (let i = 0; i < 3; i++) {
      const r = await recognize(service, b64);
      runs.push(r);
    }
    const last = runs[runs.length - 1];
    tiempos.push(...runs.slice(1).map(r => r.ms_inferencia));
    console.log(`${path.basename(f).padEnd(30)} texto="${last.texto.replace(/\n/g, ' | ')}"  conf=${last.confianza}  ` +
      `inferencia: ${runs.map(r => r.ms_inferencia + 'ms').join(' / ')}  (1.ª = fría)`);
  }
  const mem = process.memoryUsage();
  tiempos.sort((a, b) => a - b);
  const p = q => tiempos[Math.min(tiempos.length - 1, Math.floor(q * tiempos.length))];
  console.log(`\nInferencia caliente (n=${tiempos.length}): mediana ${p(0.5)} ms, p90 ${p(0.9)} ms, máx ${tiempos[tiempos.length - 1]} ms`);
  console.log(`RSS del proceso tras el bench: ${(mem.rss / 2 ** 20).toFixed(0)} MB`);
  await service.destroy();
}

main().catch(err => { console.error(err); process.exit(1); });
