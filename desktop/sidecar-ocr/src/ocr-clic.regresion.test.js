'use strict';
// Sprint 10, tarea 4: el ANPR NO cambia la captura por clic. `server.js` (el OCR por clic) no se tocó; esta prueba fija lo que
// devuelve hoy sobre las placas de test-assets/ —texto por fragmento, por el protocolo real de stdin/stdout— para que cualquier
// cambio futuro que lo altere (modelos, opciones del OCR, protocolo) salte aquí. Se omite sin modelos.
// Las confianzas se comparan con margen (pueden variar en el último decimal entre CPUs); los textos, exactos.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const modelos = path.join(__dirname, '..', 'models');
const hayModelos = fs.existsSync(path.join(modelos, 'SHA256SUMS'));

/** Lo que devolvía el OCR por clic antes del Sprint 10 (medido el 22/10/2026 con onnxruntime-node 1.30). */
const REFERENCIA = {
  'placa_c458dfg_blur.jpg': [['GUATEMALA', 0.9999], ['C', 0.952], ['458DFC', 0.952]],
  'placa_m771klm_rot.jpg': [['GUATEMALA', 0.999], ['M771KLN', 0.9402]],
  'placa_o004abc.jpg': [['GUATEMALA', 0.9998], ['D 004ABQ', 0.892]],
  'placa_p123abc.jpg': [['GUATEMALA', 0.9868], ['ID', 0.8281], ['123AB', 0.8281], ['', 0.8281]],
};

test('regresión del OCR por clic: mismo protocolo y mismo texto por fragmento que antes del ANPR', { skip: !hayModelos, timeout: 120_000 }, async () => {
  const hijo = spawn(process.execPath, [path.join(__dirname, 'server.js'), '--models', modelos], { stdio: ['pipe', 'pipe', 'pipe'] });
  let out = '';
  const esperar = (pred, ms = 60_000) => new Promise((resolve, reject) => {
    const t0 = Date.now();
    const iv = setInterval(() => {
      const l = out.split('\n').filter(Boolean).map(x => JSON.parse(x)).find(pred);
      if (l) { clearInterval(iv); resolve(l); } else if (Date.now() - t0 > ms) { clearInterval(iv); reject(new Error('sin respuesta')); }
    }, 20);
  });
  hijo.stdout.on('data', d => { out += d; });
  try {
    await esperar(l => l.evento === 'listo');
    let n = 0;
    for (const [archivo, esperado] of Object.entries(REFERENCIA)) {
      const id = String(++n);
      hijo.stdin.write(JSON.stringify({ id, op: 'recognize', image: fs.readFileSync(path.join(__dirname, '..', 'test-assets', archivo)).toString('base64') }) + '\n');
      const r = await esperar(l => l.id === id);
      assert.equal(r.ok, true);
      assert.deepEqual(Object.keys(r).sort(), ['confianza', 'id', 'items', 'ms_inferencia', 'ms_total', 'ok', 'texto'], 'mismos campos de respuesta');
      assert.deepEqual(r.items.map(i => i.texto), esperado.map(e => e[0]), `${archivo}: ${JSON.stringify(r.items)}`);
      r.items.forEach((it, i) => assert.ok(Math.abs(it.confianza - esperado[i][1]) < 0.02, `${archivo}: confianza ${it.confianza}`));
    }
  } finally {
    hijo.stdin.write(JSON.stringify({ op: 'shutdown' }) + '\n');
    await new Promise(r => hijo.on('close', r));
  }
});
