'use strict';
// T5: privacidad del DPI en el sidecar. La imagen no se escribe a disco y el CUI/los nombres no salen por stderr (el canal
// de logs que Rust reenvía). Solo viajan por stdout, en la respuesta a la petición, hacia el proceso padre.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');

const modelos = path.join(__dirname, '..', 'models', 'SHA256SUMS');

// Los módulos del ANPR (Sprint 10) entran en la misma guarda: la evidencia sale por stdout hacia Rust, que la guarda cifrada.
const anpr = fs.readdirSync(path.join(__dirname, 'anpr')).filter(f => f.endsWith('.js') && !f.endsWith('.test.js')).map(f => path.join('anpr', f));

test('guarda de código: el sidecar no escribe archivos ni imprime con console.log', () => {
  assert.ok(anpr.length > 0, 'la guarda encuentra los módulos del ANPR');
  for (const f of ['server.js', 'dpi.js', 'enderezar.js', ...anpr]) {
    const codigo = fs.readFileSync(path.join(__dirname, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const prohibido of ['writeFile', 'createWriteStream', 'appendFile', 'console.log', 'console.error', 'console.info', 'toFile(', 'mkdtemp']) {
      assert.ok(!codigo.includes(prohibido), `${f} no debe usar ${prohibido}`);
    }
  }
});

test('guarda de código: los logs del sidecar (log(...)) nunca interpolan campos del DPI', () => {
  const server = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
  for (const linea of server.split('\n').filter(l => /\blog\(/.test(l) && !/^\s*(\/\/|\*)/.test(l) && !l.includes('const log'))) {
    assert.ok(!/cui|nombres|apellidos|image|imagen/i.test(linea), `log sospechoso: ${linea.trim()}`);
  }
});

test('punta a punta: el CUI solo aparece en stdout, nada en stderr y ningún archivo nuevo en el directorio temporal (se omite sin modelos)', { skip: !fs.existsSync(modelos) }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dpi-priv-'));
  execFileSync(process.execPath, [path.join(__dirname, '..', 'fixtures-dpi', 'generar.mjs'), '--out', dir, '--n', '1', '--seed', '9'], { stdio: 'pipe' });
  const [, cui, nombres, apellidos] = fs.readFileSync(path.join(dir, 'verdad_terreno.csv'), 'utf8').trim().split('\n')[1].split(',');
  const imagen = fs.readFileSync(path.join(dir, 'img_0001.jpg')).toString('base64');
  // El sidecar corre con un directorio temporal PROPIO: así lo que otras pruebas creen en paralelo no cuenta.
  const tmpHijo = fs.mkdtempSync(path.join(os.tmpdir(), 'dpi-priv-tmp-'));

  const hijo = spawn(process.execPath, [path.join(__dirname, 'server.js'), '--models', path.join(__dirname, '..', 'models')], { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, TMPDIR: tmpHijo, TEMP: tmpHijo, TMP: tmpHijo } });
  let out = '', err = '';
  hijo.stdout.on('data', d => { out += d; });
  hijo.stderr.on('data', d => { err += d; });
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('el sidecar no respondió a tiempo')), 60_000);
    const espera = setInterval(() => {
      if (out.includes('"evento":"listo"') && !out.includes('"id":"1"')) {
        if (!hijo.__enviado) { hijo.__enviado = true; hijo.stdin.write(JSON.stringify({ id: '1', op: 'dpi', image: imagen }) + '\n'); }
      }
      if (out.includes('"id":"1"')) { clearInterval(espera); clearTimeout(t); resolve(); }
    }, 50);
  });
  hijo.stdin.write(JSON.stringify({ id: '2', op: 'shutdown' }) + '\n');
  await new Promise(r => hijo.on('close', r));

  const respuesta = JSON.parse(out.split('\n').find(l => l.includes('"id":"1"')));
  assert.equal(respuesta.ok, true);
  assert.equal(respuesta.cui, cui, 'la respuesta SÍ lleva el CUI hacia el proceso padre');
  assert.ok(!('texto' in respuesta) && !('image' in respuesta));

  for (const dato of [cui, cui.slice(0, 4), nombres.split(' ')[0], apellidos.split(' ')[0]]) {
    assert.ok(!err.includes(dato), `stderr filtró un dato del DPI («${dato.slice(0, 2)}…»)`);
  }
  // Las bibliotecas de imágenes del OCR dejan DOS marcas propias en el directorio temporal al iniciar, ajenas al código del sidecar
  // y sin datos: `mat-debug-<pid>.log` (vacío) y `.ses` (una marca de tiempo y un UUID). Cualquier otro archivo, o uno de
  // esos con otro contenido, hace fallar la prueba.
  const conocido = (f) => {
    const ruta = path.join(tmpHijo, f);
    if (/^mat-debug-\d+\.log$/.test(f)) return fs.statSync(ruta).size === 0;
    if (f === '.ses') return /^\d{10,}\s+[0-9a-f-]{36}\s*$/i.test(fs.readFileSync(ruta, 'utf8'));
    return false;
  };
  const dejados = fs.readdirSync(tmpHijo).filter(f => !conocido(f));
  assert.deepEqual(dejados, [], 'el sidecar dejó archivos con contenido en su directorio temporal');
  fs.rmSync(tmpHijo, { recursive: true, force: true });
  fs.rmSync(dir, { recursive: true, force: true });
});
