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

/** Todos los cuadros de un clip, en memoria (los clips de prueba son cortos: ~5 MB). */
async function cuadrosDeClip(ruta, opciones = {}) {
  const cuadros = [];
  await leerClip(ruta, opciones, (jpeg) => { cuadros.push(jpeg); });
  return cuadros;
}

/**
 * Reproduce `cuadros` en TIEMPO REAL como lo haría el puente de cámaras: a cada envío le toca el cuadro que corresponde a la hora
 * actual (si el consumidor tardó, los intermedios se saltan; nunca hay cola), y entre envíos se espera lo que pida el consumidor
 * (`fps_deseado` de la respuesta), igual que Rust (`desktop/src-tauri/src/anpr/`).
 * @param {(jpeg: Buffer, indice: number) => Promise<{fps_deseado?: number}>} enviar
 * @returns {Promise<{enviados: number, saltados: number, ms: number}>}
 */
async function reproducir(cuadros, fpsClip, enviar, { ahora = () => Date.now(), dormir = (ms) => new Promise(r => setTimeout(r, ms)) } = {}) {
  const t0 = ahora();
  let enviados = 0;
  let ultimo = -1;
  for (;;) {
    const indice = Math.floor(((ahora() - t0) * fpsClip) / 1000);
    if (indice >= cuadros.length) break;
    if (indice === ultimo) { await dormir(5); continue; }
    const tEnvio = ahora();
    const r = await enviar(cuadros[indice], indice);
    enviados++;
    ultimo = indice;
    const fps = r && r.fps_deseado > 0 ? Math.min(r.fps_deseado, fpsClip) : fpsClip;
    const espera = tEnvio + 1000 / fps - ahora();
    if (espera > 0) await dormir(espera);
  }
  return { enviados, saltados: cuadros.length - enviados, ms: ahora() - t0 };
}

module.exports = { leerClip, hayFfmpeg, cuadrosDeClip, reproducir };
