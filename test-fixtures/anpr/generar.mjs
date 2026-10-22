/**
 * Genera los clips e imágenes de prueba del ANPR (Sprint 10) a partir de DOS fotos CC0 (ver README.md) y de una escena y unas
 * placas 100 % sintéticas. Es determinista: misma salida en cada corrida en la misma máquina (el ruido sale de un PRNG con
 * semilla; la tipografía es DejaVu Sans, si no está se usa la que tenga el sistema y los píxeles pueden variar un poco).
 *
 *   node test-fixtures/anpr/generar.mjs                       # regenera clips/, imagenes/ y verdad_terreno.json
 *   node test-fixtures/anpr/generar.mjs --solo tres_a_la_vez  # solo ese clip; lo agrega/reemplaza en verdad_terreno.json
 *
 * Necesita: las dependencias del sidecar instaladas (`npm ci` en desktop/sidecar-ocr, por @napi-rs/canvas) y un ffmpeg con
 * libx264 en el PATH. Los clips YA están en el repo: solo hace falta regenerarlos si cambia este script.
 *
 * Qué simula: una cámara fija en la entrada, detrás del vehículo (ve la placa TRASERA, como en las fotos), a 960×540 y 10 fps,
 * que es lo que entrega el puente de cámaras de la app (`args_ffmpeg(url, 10, 960, 5)`). El vehículo entra por abajo, se aleja,
 * se detiene en la talanquera y sale por la izquierda del carril. Las trayectorias son sintéticas (no hay perspectiva real).
 */
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(AQUI, '..', '..', 'desktop', 'sidecar-ocr', 'package.json'));
const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');

const W = 960;
const H = 540;
const FPS = 10;
const FUENTE = GlobalFonts.has('DejaVu Sans') ? '"DejaVu Sans"' : 'sans-serif';

/** ROI del carril en estas escenas (normalizado): el trapecio del carril, sin el carril vecino de la derecha. */
export const ROI = [[0.2, 0.3], [0.72, 0.3], [0.86, 1], [0.06, 1]];

/** Fotos CC0 y dónde está su placa en blanco (píxeles de la foto de 1280 px). */
const FOTOS = {
  plata: { archivo: 'crown_plata.jpg', placa: { x: 932, y: 262, w: 124, h: 64 } },
  negro: { archivo: 'crown_negro.jpg', placa: { x: 1017, y: 255, w: 101, h: 57 } },
};

function prng(semilla) {
  let a = semilla >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const lerp = (a, b, t) => a + (b - a) * t;

/** Placa guatemalteca sintética (mismo estilo que desktop/sidecar-ocr/test-assets): fondo crema, borde, «GUATEMALA», texto. */
function dibujarPlaca(g, { x, y, w, h }, texto, { borrosa = 0 } = {}) {
  g.save();
  g.fillStyle = '#f3f1e6';
  g.fillRect(x, y, w, h);
  g.strokeStyle = '#1e1e1e';
  g.lineWidth = Math.max(1, h * 0.05);
  g.strokeRect(x + h * 0.06, y + h * 0.06, w - h * 0.12, h - h * 0.12);
  if (borrosa) g.filter = `blur(${borrosa}px)`;
  g.fillStyle = '#3a3a3a';
  g.font = `bold ${Math.round(h * 0.16)}px ${FUENTE}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('GUATEMALA', x + w / 2, y + h * 0.22);
  g.fillStyle = '#151515';
  let tam = h * 0.5;
  g.font = `bold ${Math.round(tam)}px ${FUENTE}`;
  while (g.measureText(texto).width > w * 0.86 && tam > 4) { tam -= 1; g.font = `bold ${Math.round(tam)}px ${FUENTE}`; }
  g.fillText(texto, x + w / 2, y + h * 0.62);
  g.restore();
}

/**
 * Foto del vehículo con la placa sintética y un borde difuminado (para que el recorte de la foto no se note tanto).
 * `escalaPlaca` agranda la placa dibujada alrededor de su centro (para escenas con vehículos más chicos en el cuadro).
 */
async function vehiculo(foto, placa, opciones = {}) {
  const img = await loadImage(readFileSync(path.join(AQUI, 'fuentes', foto.archivo)));
  const c = createCanvas(img.width, img.height);
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0);
  const e = opciones.escalaPlaca ?? 1;
  const caja = { x: foto.placa.x - foto.placa.w * (e - 1) / 2, y: foto.placa.y - foto.placa.h * (e - 1) / 2, w: foto.placa.w * e, h: foto.placa.h * e };
  dibujarPlaca(g, caja, placa, opciones);
  const datos = g.getImageData(0, 0, c.width, c.height);
  const borde = 40;
  for (let yy = 0; yy < c.height; yy++) {
    for (let xx = 0; xx < c.width; xx++) {
      const d = Math.min(xx, yy, c.width - 1 - xx, c.height - 1 - yy);
      if (d < borde) datos.data[(yy * c.width + xx) * 4 + 3] = Math.round((255 * d) / borde);
    }
  }
  g.putImageData(datos, 0, 0);
  return c;
}

/** Escena fija: muro, asfalto, bordes del carril, carril vecino y el poste de la talanquera. */
function escena() {
  const c = createCanvas(W, H);
  const g = c.getContext('2d');
  const cielo = g.createLinearGradient(0, 0, 0, 170);
  cielo.addColorStop(0, '#b9c4cc');
  cielo.addColorStop(1, '#d8d2c4');
  g.fillStyle = cielo;
  g.fillRect(0, 0, W, 170);
  g.fillStyle = '#9a8f80';
  for (let x = 0; x < W; x += 64) g.fillRect(x, 120, 60, 46);
  const asfalto = g.createLinearGradient(0, 160, 0, H);
  asfalto.addColorStop(0, '#6c6f72');
  asfalto.addColorStop(1, '#45484b');
  g.fillStyle = asfalto;
  g.fillRect(0, 160, W, H - 160);
  const r = prng(7);
  for (let i = 0; i < 2500; i++) {
    g.fillStyle = `rgba(${r() < 0.5 ? '255,255,255' : '0,0,0'},${(0.04 + r() * 0.06).toFixed(3)})`;
    g.fillRect(r() * W, 160 + r() * (H - 160), 2, 2);
  }
  g.strokeStyle = '#e9e6d8';
  g.lineWidth = 6;
  g.beginPath();
  g.moveTo(40, H); g.lineTo(200, 165);
  g.moveTo(860, H); g.lineTo(690, 165);
  g.stroke();
  g.setLineDash([30, 26]);
  g.beginPath();
  g.moveTo(950, H); g.lineTo(760, 165);
  g.stroke();
  g.setLineDash([]);
  g.fillStyle = '#2d2d2d';
  g.fillRect(150, 170, 26, 150);
  g.fillStyle = '#d23c2c';
  for (let y = 40; y < 170; y += 30) g.fillRect(156, y, 14, 15);
  g.fillStyle = '#f2f2f2';
  for (let y = 55; y < 170; y += 30) g.fillRect(156, y, 14, 15);
  return c;
}

/** Ruido de sensor por cuadro (determinista) y cambio de brillo opcional. */
function ruido(g, semilla, brillo = 0) {
  const r = prng(semilla);
  if (brillo) {
    g.fillStyle = brillo > 0 ? `rgba(255,255,255,${brillo})` : `rgba(0,0,0,${-brillo})`;
    g.fillRect(0, 0, W, H);
  }
  for (let i = 0; i < 1500; i++) {
    g.fillStyle = `rgba(${r() < 0.5 ? '255,255,255' : '0,0,0'},0.06)`;
    g.fillRect(r() * W, r() * H, 2, 2);
  }
}

/**
 * Posición del vehículo para el avance `t` (0 = entrando por abajo, 1 = junto a la talanquera, más allá = saliendo por la
 * izquierda). Devuelve ancho y esquina superior izquierda de la foto.
 */
function pose(foto, t) {
  const proporcion = foto.height / foto.width;
  const avance = Math.min(1, t);
  const ancho = lerp(900, 560, avance);
  const base = lerp(H + 170, 470, avance);
  const salida = Math.max(0, t - 1);
  const cx = lerp(470, 440, avance) - salida * 1400;
  return { x: cx - ancho / 2, y: base - ancho * proporcion, w: ancho, h: ancho * proporcion };
}

/** Recorrido de un vehículo: entra (tEntrada s), se detiene (tParada s) y sale (tSalida s). Lista de t por cuadro. */
function recorrido({ entrada = 3, parada = 1.5, salida = 1.2 } = {}) {
  const ts = [];
  for (let i = 0; i < entrada * FPS; i++) ts.push(i / (entrada * FPS));
  for (let i = 0; i < parada * FPS; i++) ts.push(1);
  for (let i = 1; i <= salida * FPS; i++) ts.push(1 + i / (salida * FPS));
  return ts;
}

/** Caja de la foto con el centro horizontal `cx`, el borde de abajo en `base` y el ancho `ancho` (alto según la foto). */
function cajaEn(foto, cx, base, ancho) {
  const h = ancho * (foto.height / foto.width);
  return { x: cx - ancho / 2, y: base - h, w: ancho, h };
}

/** Interpola dos poses {cx, base, ancho} en `n` cuadros (sin el último). */
const tramo = (a, b, n) => Array.from({ length: n }, (_, i) => {
  const t = i / n;
  return { cx: lerp(a.cx, b.cx, t), base: lerp(a.base, b.base, t), ancho: lerp(a.ancho, b.ancho, t) };
});

async function renderizar(nombre, cuadros, dir) {
  const fondo = escena();
  const carpeta = mkdtempSync(path.join(os.tmpdir(), `anpr-${nombre}-`));
  try {
    for (let i = 0; i < cuadros.length; i++) {
      const c = createCanvas(W, H);
      const g = c.getContext('2d');
      g.drawImage(fondo, 0, 0);
      // Del más lejano al más cercano: el de caja más baja queda delante.
      const poses = cuadros[i].vehiculos.map(v => ({ foto: v.foto, p: v.p ?? pose(v.foto, v.t) }));
      poses.sort((a, b) => (a.p.y + a.p.h) - (b.p.y + b.p.h));
      for (const { foto, p } of poses) g.drawImage(foto, p.x, p.y, p.w, p.h);
      ruido(g, 1000 + i, cuadros[i].brillo ?? 0);
      writeFileSync(path.join(carpeta, `${String(i).padStart(4, '0')}.jpg`), c.toBuffer('image/jpeg', 92));
      if (cuadros[i].guardarComo) writeFileSync(path.join(AQUI, 'imagenes', cuadros[i].guardarComo), c.toBuffer('image/jpeg', 90));
    }
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-framerate', String(FPS), '-i', path.join(carpeta, '%04d.jpg'),
      '-c:v', 'libx264', '-preset', 'veryslow', '-crf', '24', '-g', String(FPS * 2), '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
      '-metadata', 'comment=SecureGate ANPR: escena y placas sinteticas; vehiculos de fotos CC0 (ver README.md)',
      path.join(dir, `${nombre}.mp4`)], { stdio: 'inherit' });
  } finally {
    rmSync(carpeta, { recursive: true, force: true });
  }
  return cuadros.length;
}

const vacios = (n, extra = {}) => Array.from({ length: n }, () => ({ vehiculos: [], ...extra }));

async function main() {
  const dirClips = path.join(AQUI, 'clips');
  mkdirSync(dirClips, { recursive: true });
  mkdirSync(path.join(AQUI, 'imagenes'), { recursive: true });
  const auto = (k, placa, op) => vehiculo(FOTOS[k], placa, op);
  // `--solo a,b`: solo esos clips (los demás del repo no se tocan; su verdad de terreno se conserva).
  const iSolo = process.argv.indexOf('--solo');
  const solo = iSolo > 0 ? new Set(String(process.argv[iSolo + 1] ?? '').split(',').filter(Boolean)) : null;

  const clips = [];
  const agregar = async (nombre, descripcion, cuadros, vehiculos) => {
    if (solo && !solo.has(nombre)) return;
    const n = await renderizar(nombre, solo ? cuadros.map(c => ({ ...c, guardarComo: undefined })) : cuadros, dirClips);
    clips.push({ archivo: `clips/${nombre}.mp4`, fps: FPS, cuadros: n, descripcion, vehiculos });
    process.stdout.write(`✓ ${nombre} (${n} cuadros)\n`);
  };
  const cruce = (foto, opciones, guardar) => recorrido(opciones).map((t, i, todo) => ({
    vehiculos: [{ foto, t }],
    guardarComo: guardar && t === 1 && todo[i - 1] !== 1 ? guardar : undefined,
  }));

  const p123 = await auto('plata', 'P 123ABC');
  await agregar('entrada_p123abc', 'Sedán plateado entra, se detiene 1,5 s en la talanquera y sale.',
    [...vacios(10), ...cruce(p123, {}, 'carro_en_roi.jpg'), ...vacios(15)], [{ placa: 'P123ABC', legible: true }]);

  const c458 = await auto('negro', 'C 458DFG');
  await agregar('entrada_c458dfg', 'Sedán negro entra, se detiene 1,5 s y sale.',
    [...vacios(10), ...cruce(c458, {}), ...vacios(15)], [{ placa: 'C458DFG', legible: true }]);

  const m771 = await auto('plata', 'M 771KLM');
  await agregar('detenido_m771klm', 'Vehículo que se queda 20 s detenido dentro del ROI: un solo evento.',
    [...vacios(10), ...cruce(m771, { parada: 20 }), ...vacios(15)], [{ placa: 'M771KLM', legible: true }]);

  const p555 = await auto('negro', 'P 555TRK');
  const u318 = await auto('plata', 'U 318BCD');
  await agregar('dos_seguidos', 'Dos vehículos seguidos con 2 s entre uno y otro: dos pistas, dos eventos.',
    [...vacios(10), ...cruce(p555, { parada: 1 }), ...vacios(20), ...cruce(u318, { parada: 1 }), ...vacios(15)],
    [{ placa: 'P555TRK', legible: true }, { placa: 'U318BCD', legible: true }]);

  await agregar('vacio', 'Carril vacío con ruido y un cambio de brillo (nube): sin vehículos ni movimiento.',
    Array.from({ length: 80 }, (_, i) => ({
      vehiculos: [], brillo: i < 30 ? 0 : -Math.min(0.25, (i - 30) * 0.02), guardarComo: i === 5 ? 'vacio.jpg' : undefined,
    })), []);

  // Carril vecino: un vehículo pequeño sube por la derecha, siempre fuera del ROI (el borde derecho del ROI está en x≈720 a esa
  // altura y el vehículo nunca baja de x=745).
  const vecino = await auto('negro', 'P 777VEC');
  const fueraRoi = Array.from({ length: 40 }, (_, i) => {
    const t = i / 39;
    const w = lerp(240, 150, t);
    const h = w * (vecino.height / vecino.width);
    return { vehiculos: [{ foto: vecino, p: { x: lerp(745, 960, t), y: lerp(330, 210, t) - h, w, h } }], guardarComo: i === 12 ? 'carro_fuera_roi.jpg' : undefined };
  });
  await agregar('carril_vecino', 'Un vehículo pasa por el carril vecino (derecha), fuera del ROI: no cuenta ni despierta el pipeline.',
    [...vacios(10), ...fueraRoi, ...vacios(10)], []);

  const ilegible = await auto('plata', 'P 246XYZ', { borrosa: 7 });
  await agregar('ilegible', 'Placa ilegible (texto muy borroso): debe terminar en verificación del agente, nunca en una placa inventada.',
    [...vacios(10), ...cruce(ilegible, { parada: 3 }), ...vacios(15)], [{ placa: null, legible: false }]);

  // Tres vehículos a la vez (seguimiento del Sprint 10, tarea 4). V1 llega a la talanquera por la izquierda y se detiene; V2 llega
  // 0,5 s después por la derecha, más cerca de la cámara, y se detiene a su lado tapándole el costado; V3 llega 3 s después de V2
  // (< 5 s) por abajo y cruza de izquierda a derecha por DELANTE de los dos (los tapa en parte al pasar) y sale por la derecha.
  // Después salen V1 y V2. Las placas se dibujan más grandes (los vehículos son más chicos en el cuadro que en los otros clips).
  const v1 = await auto('plata', 'P 432HJK', { escalaPlaca: 1.6 });
  const v2 = await auto('negro', 'C 615MNP', { escalaPlaca: 1.9 });
  const v3 = await auto('plata', 'M 208RST', { escalaPlaca: 1.6 });
  {
    const N = 190;
    const ruta = (pasos, desde) => {
      const out = Array(N).fill(null);
      let i = desde;
      for (const [a, b, n] of pasos) for (const q of (b ? tramo(a, b, n) : Array(n).fill(a))) { if (i < N) out[i] = q; i++; }
      return out;
    };
    const R1 = ruta([
      [{ cx: 300, base: 700, ancho: 540 }, { cx: 330, base: 410, ancho: 400 }, 25], // entra (2,5 s)
      [{ cx: 330, base: 410, ancho: 400 }, null, 95], //                                    detenido 9,5 s
      [{ cx: 330, base: 410, ancho: 400 }, { cx: -320, base: 400, ancho: 400 }, 15], //   sale por la izquierda
    ], 10);
    const R2 = ruta([
      [{ cx: 760, base: 720, ancho: 580 }, { cx: 680, base: 450, ancho: 430 }, 25],
      [{ cx: 680, base: 450, ancho: 430 }, null, 110],
      [{ cx: 680, base: 450, ancho: 430 }, { cx: 1300, base: 440, ancho: 430 }, 15],
    ], 15);
    const R3 = ruta([
      [{ cx: 120, base: 760, ancho: 500 }, { cx: 300, base: 530, ancho: 440 }, 15], //    entra por abajo a la izquierda
      [{ cx: 300, base: 530, ancho: 440 }, { cx: 640, base: 525, ancho: 430 }, 25], //    cruza por delante de los dos
      [{ cx: 640, base: 525, ancho: 430 }, { cx: 1250, base: 530, ancho: 430 }, 20], //   sale por la derecha
    ], 45);
    const cuadros = Array.from({ length: N }, (_, i) => ({
      vehiculos: [[v1, R1[i]], [v2, R2[i]], [v3, R3[i]]].filter(([, q]) => q).map(([foto, q]) => ({ foto, p: cajaEn(foto, q.cx, q.base, q.ancho) })),
    }));
    await agregar('tres_a_la_vez', 'Tres vehículos a la vez: dos se detienen lado a lado en la talanquera y un tercero llega 3 s después y cruza por delante de los dos.',
      [...cuadros, ...vacios(15)], [{ placa: 'P432HJK', legible: true }, { placa: 'C615MNP', legible: true }, { placa: 'M208RST', legible: true }]);
  }

  const archivoVerdad = path.join(AQUI, 'verdad_terreno.json');
  if (solo) {
    const previa = JSON.parse(readFileSync(archivoVerdad, 'utf8'));
    for (const c of clips) {
      const k = previa.clips.findIndex(x => x.archivo === c.archivo);
      if (k >= 0) previa.clips[k] = c; else previa.clips.push(c);
    }
    writeFileSync(archivoVerdad, JSON.stringify(previa, null, 2) + '\n');
    process.stdout.write('verdad_terreno.json actualizado\n');
    return;
  }
  writeFileSync(archivoVerdad, JSON.stringify({
    descripcion: 'Verdad de terreno de los clips sintéticos del ANPR (generados por generar.mjs).',
    resolucion: [W, H],
    roi: ROI,
    clips,
    imagenes: [
      { archivo: 'imagenes/carro_en_roi.jpg', vehiculos_en_roi: 1 },
      { archivo: 'imagenes/vacio.jpg', vehiculos_en_roi: 0 },
      { archivo: 'imagenes/carro_fuera_roi.jpg', vehiculos_en_roi: 0 },
    ],
  }, null, 2) + '\n');
  process.stdout.write('verdad_terreno.json listo\n');
}

main().catch((e) => { process.stderr.write(`${e.stack ?? e}\n`); process.exit(1); });
