/**
 * Lee un clip de video como una serie de JPEG en memoria, con el ffmpeg del sistema. Solo para pruebas, medición
 * (`desktop/scripts/medir-anpr.mjs`) y la prueba de punta a punta: en la garita los fotogramas los entrega el puente de cámaras
 * de la app (Rust), no este módulo.
 */
'use strict';

const { spawn, spawnSync } = require('node:child_process');

const SOI = Buffer.from([0xff, 0xd8]);
const EOI = Buffer.from([0xff, 0xd9]);

/** ¿Hay un ffmpeg en el PATH? */
function hayFfmpeg(binario = 'ffmpeg') {
  return spawnSync(binario, ['-version'], { stdio: 'ignore' }).status === 0;
}

/**
 * Decodifica `ruta` a JPEG (calidad alta) a `fps` cuadros por segundo y `ancho` px (alto proporcional). Llama a `porCuadro(jpeg,
 * indice)` con cada uno, en orden; si devuelve una promesa se espera antes de pedir el siguiente (contrapresión real: el proceso
 * se pausa).
 * @returns {Promise<number>} cuántos cuadros se entregaron
 */
function leerClip(ruta, { fps = 10, ancho = 960, binario = 'ffmpeg' } = {}, porCuadro) {
  return new Promise((resolve, reject) => {
    const args = ['-hide_banner', '-loglevel', 'error', '-i', ruta, '-an', '-vf', `fps=${fps},scale=${ancho}:-2`,
      '-c:v', 'mjpeg', '-q:v', '3', '-f', 'image2pipe', 'pipe:1'];
    const p = spawn(binario, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let buf = Buffer.alloc(0);
    let n = 0;
    let error = '';
    let cadena = Promise.resolve();
    p.stderr.on('data', d => { error += d; });
    p.stdout.on('data', d => {
      buf = Buffer.concat([buf, d]);
      const listos = [];
      for (;;) {
        const ini = buf.indexOf(SOI);
        if (ini < 0) { buf = Buffer.alloc(0); break; }
        const fin = buf.indexOf(EOI, ini + 2);
        if (fin < 0) { buf = buf.subarray(ini); break; }
        listos.push(Buffer.from(buf.subarray(ini, fin + 2)));
        buf = buf.subarray(fin + 2);
      }
      if (!listos.length) return;
      p.stdout.pause();
      cadena = cadena.then(async () => {
        for (const jpeg of listos) await porCuadro(jpeg, n++);
        p.stdout.resume();
      }).catch((e) => { p.kill(); reject(e); });
    });
    p.on('error', reject);
    p.on('close', (codigo) => {
      cadena.then(() => (codigo === 0 ? resolve(n) : reject(new Error(`ffmpeg terminó con ${codigo}: ${error.trim().slice(0, 300)}`))), reject);
    });
  });
}

module.exports = { leerClip, hayFfmpeg };
