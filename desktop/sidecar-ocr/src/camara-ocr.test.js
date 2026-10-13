'use strict';
// T8: «la captura de fotograma para el OCR funciona igual que con la webcam».
// Una cámara RTSP SIMULADA (mediamtx + ffmpeg repitiendo la foto de una placa de prueba) → el ffmpeg mínimo con los MISMOS argumentos
// que usa el puente de Rust (`args_ffmpeg` en desktop/src-tauri/src/camaras/fuente.rs) → un JPEG → el MISMO OCR local de la placa.
// Se omite solo si faltan: modelos, el ffmpeg mínimo (SG_FFMPEG o src-tauri/binaries/ffmpeg-<triple>), SG_MEDIAMTX o un ffmpeg con
// libx264 en el PATH. Sin probar con hardware real: ninguna cámara física participa.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const os = require('node:os');
const { spawn, spawnSync } = require('node:child_process');

const modelos = path.join(__dirname, '..', 'models', 'SHA256SUMS');
const placa = path.join(__dirname, '..', 'test-assets', 'placa_p123abc.jpg');
const minimo = process.env.SG_FFMPEG
  || path.join(__dirname, '..', '..', 'src-tauri', 'binaries', 'ffmpeg-x86_64-unknown-linux-gnu');
const mediamtx = process.env.SG_MEDIAMTX;
const hayFfmpeg = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0;
const faltante = !fs.existsSync(modelos) ? 'modelos'
  : !(fs.existsSync(minimo) && fs.statSync(minimo).size > 1_000_000) ? 'ffmpeg mínimo'
  : !(mediamtx && fs.existsSync(mediamtx)) ? 'SG_MEDIAMTX'
  : !hayFfmpeg ? 'ffmpeg del sistema' : null;

const puertoLibre = () => new Promise(r => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const dormir = ms => new Promise(r => setTimeout(r, ms));

/** Argumentos idénticos a `args_ffmpeg(url, 10, 960, 5)` de Rust. */
const argsPuente = url => ['-hide_banner', '-nostdin', '-loglevel', 'info', '-rtsp_transport', 'tcp', '-i', url, '-an',
  '-vf', 'fps=10,scale=960:-2', '-c:v', 'mjpeg', '-q:v', '5', '-f', 'mjpeg', 'pipe:1'];

function primerJpeg(ffmpeg, url, ms) {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpeg, argsPuente(url), { stdio: ['ignore', 'pipe', 'ignore'] });
    let buf = Buffer.alloc(0);
    const t = setTimeout(() => { p.kill(); reject(new Error('sin fotograma a tiempo')); }, ms);
    p.stdout.on('data', d => {
      buf = Buffer.concat([buf, d]);
      const ini = buf.indexOf(Buffer.from([0xff, 0xd8, 0xff]));
      const fin = ini >= 0 ? buf.indexOf(Buffer.from([0xff, 0xd9]), ini + 3) : -1;
      if (ini >= 0 && fin > 0) { clearTimeout(t); p.kill(); resolve(buf.subarray(ini, fin + 2)); }
    });
  });
}

test('un fotograma de una cámara RTSP simulada se lee con el MISMO OCR de placas que la webcam', { skip: faltante ? `falta ${faltante}` : false, timeout: 120_000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cam-ocr-'));
  const [rtsp, rtp] = [await puertoLibre(), 20000 + 2 * Math.floor(Math.random() * 5000)];
  fs.writeFileSync(path.join(dir, 'm.yml'), `logLevel: error\nrtspAddress: 127.0.0.1:${rtsp}\nrtpAddress: 127.0.0.1:${rtp}\nrtcpAddress: 127.0.0.1:${rtp + 1}\nrtmp: no\nhls: no\nwebrtc: no\nsrt: no\napi: no\nmetrics: no\npaths:\n  all_others:\n`);
  const servidor = spawn(mediamtx, [path.join(dir, 'm.yml')], { stdio: 'ignore' });
  await dormir(1000);
  // La «cámara»: la foto de la placa repetida como video H.264 a 10 fps.
  const camara = spawn('ffmpeg', ['-loglevel', 'error', '-re', '-loop', '1', '-framerate', '10', '-i', placa, '-vf', 'scale=1280:-2,format=yuv420p',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency', '-g', '10', '-f', 'rtsp', '-rtsp_transport', 'tcp', `rtsp://127.0.0.1:${rtsp}/carril`], { stdio: 'ignore' });
  try {
    await dormir(2000);
    const jpeg = await primerJpeg(minimo, `rtsp://127.0.0.1:${rtsp}/carril`, 20_000);
    assert.ok(jpeg.length > 5_000, 'el fotograma es una imagen de verdad');

    const sc = require('./server');
    const service = sc.createService(sc.resolveModels(path.join(__dirname, '..', 'models')));
    await service.initialize();
    try {
      const compacto = t => t.replace(/[^A-Z0-9]/gi, '').toUpperCase();
      // La foto original y el fotograma que llega por la cámara (comprimido a H.264 y vuelto a JPEG) se leen igual de bien: la parte
      // «123AB» de la placa aparece en los dos. (La última letra la resuelve `mejorCandidato` en la pantalla, igual con la webcam.)
      const directo = await sc.recognize(service, fs.readFileSync(placa).toString('base64'));
      const porCamara = await sc.recognize(service, jpeg.toString('base64'));
      assert.ok(compacto(directo.texto).includes('123AB'), `referencia: «${directo.texto}»`);
      assert.ok(compacto(porCamara.texto).includes('123AB'), `el OCR no leyó la placa del fotograma de la cámara: «${porCamara.texto}»`);
    } finally { await service.destroy(); }
  } finally {
    camara.kill(); servidor.kill();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
