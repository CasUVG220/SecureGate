/**
 * Generador reproducible del conjunto SINTÉTICO de DPI (T3, SCRUM-121).
 *
 *   node fixtures-dpi/generar.mjs [--out fixtures-dpi/salida] [--n 60] [--seed 20261011] [--acentos 0.15]
 *
 * Produce `img_0001.jpg …` y `verdad_terreno.csv` (qué debería leer el extractor en cada imagen).
 *
 * ┌────────────────────────────────────────────────────────────────────────────────────────────────────────┐
 * │ TODO ES FICTICIO. Los nombres salen de listas de nombres y apellidos comunes combinados al azar y el    │
 * │ CUI es un número aleatorio con departamento/municipio válidos. Ninguna persona real (ni su DPI) se usó   │
 * │ ni se buscó. La tarjeta dibujada dice «EJEMPLO FICTICIO» y NO imita los elementos de seguridad de un     │
 * │ DPI real: solo reproduce la disposición de las etiquetas bilingües («NOMBRES / GIVEN NAMES», etc.) y el  │
 * │ formato del CUI (4-5-4) para ejercitar el extractor.                                                     │
 * └────────────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * Qué NO demuestra: que el extractor acierte con DPI reales. Fotos sintéticas limpias son mucho más fáciles que fotos
 * de garita (reflejos del plástico, fondo, dedos, tipografía real). Sirve para regresiones y para medir tiempos;
 * la exactitud con DPI reales se mide con el conjunto REAL, con consentimiento (docs/ocr_dpi_local.md).
 *
 * Reproducibilidad: misma semilla → mismos datos y mismas transformaciones (PRNG mulberry32). El dibujo depende de
 * las fuentes del sistema (se usa DejaVu Sans / Arial / sans-serif), así que los píxeles pueden variar entre
 * sistemas operativos; el CSV de verdad terreno no.
 */
import { createCanvas } from '@napi-rs/canvas';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const aquí = path.dirname(fileURLToPath(import.meta.url));

// ── argumentos ───────────────────────────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const arg = (flag, def) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : def; };
const OUT = path.resolve(arg('--out', path.join(aquí, 'salida')));
const N = Number(arg('--n', 60));
const SEMILLA = Number(arg('--seed', 20261011));
const P_ACENTOS = Number(arg('--acentos', 0.15));

// ── PRNG determinista ────────────────────────────────────────────────────────────────────────────────────
function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(SEMILLA);
const entre = (a, b) => a + (b - a) * rnd();
const entero = (a, b) => Math.floor(entre(a, b + 1));
const elegir = (xs) => xs[Math.floor(rnd() * xs.length)];
const gauss = () => { let u = 0; while (u === 0) u = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd()); };

// ── datos ficticios ──────────────────────────────────────────────────────────────────────────────────────
const NOMBRES = ['MARIA', 'JOSE', 'LUIS', 'ANA', 'CARLOS', 'ROSA', 'JUAN', 'LUCIA', 'PEDRO', 'SOFIA', 'MIGUEL', 'ELENA', 'DIEGO',
  'CARMEN', 'ANDRES', 'PAOLA', 'FERNANDO', 'GLORIA', 'RICARDO', 'MONICA', 'OSCAR', 'KARLA', 'EDUARDO', 'VERONICA', 'HUGO', 'DANIELA'];
const NOMBRES_ACENTO = ['JOSÉ', 'MARÍA', 'ÁNGEL', 'JESÚS', 'ANDRÉS', 'RAMÓN', 'INÉS', 'NOÉ'];
const APELLIDOS = ['LOPEZ', 'GARCIA', 'MARTINEZ', 'RODRIGUEZ', 'HERNANDEZ', 'PEREZ', 'GONZALEZ', 'RAMIREZ', 'FLORES', 'MORALES', 'CASTILLO',
  'ORTIZ', 'CHAVEZ', 'REYES', 'MENDOZA', 'VASQUEZ', 'JIMENEZ', 'SOTO', 'ALVARADO', 'CIFUENTES', 'ESTRADA', 'ROJAS', 'AGUILAR', 'LEMUS', 'BARRIOS'];
const APELLIDOS_ACENTO = ['MUÑOZ', 'NÚÑEZ', 'PEÑA', 'IBÁÑEZ', 'CASTAÑEDA', 'GÓMEZ', 'DÍAZ', 'FERNÁNDEZ'];

const quitarAcentos = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');
const unoDe = (comunes, acento) => (rnd() < P_ACENTOS ? elegir(acento) : elegir(comunes));

function persona() {
  const nombres = [unoDe(NOMBRES, NOMBRES_ACENTO), ...(rnd() < 0.6 ? [unoDe(NOMBRES, NOMBRES_ACENTO)] : [])].join(' ');
  const apellidos = [unoDe(APELLIDOS, APELLIDOS_ACENTO), unoDe(APELLIDOS, APELLIDOS_ACENTO)].join(' ');
  // CUI: 8 dígitos + 1 dígito (verificador, aquí aleatorio: el algoritmo oficial no está verificado) + depto (01-22) + municipio (01-17).
  const d = (n) => Array.from({ length: n }, () => entero(0, 9)).join('');
  const depto = String(entero(1, 22)).padStart(2, '0');
  const muni = String(entero(1, 17)).padStart(2, '0');
  const cui = `${d(8)}${d(1)}${depto}${muni}`;
  return { cui, nombres, apellidos };
}
const cuiConEspacios = (c) => `${c.slice(0, 4)} ${c.slice(4, 9)} ${c.slice(9)}`;

// ── tarjeta ──────────────────────────────────────────────────────────────────────────────────────────────
const W = 1011, H = 638;                       // proporción ID-1 (85,6 × 54 mm)
const FUENTE = '"DejaVu Sans", Arial, sans-serif';
const MONO = '"DejaVu Sans Mono", "Courier New", monospace';

function dibujarTarjeta(p) {
  const c = createCanvas(W, H);
  const g = c.getContext('2d');
  const fondo = g.createLinearGradient(0, 0, W, H);
  fondo.addColorStop(0, '#dfeaf5'); fondo.addColorStop(1, '#c9dcc9');
  g.fillStyle = fondo; g.fillRect(0, 0, W, H);
  g.strokeStyle = '#6a7f94'; g.lineWidth = 6; g.strokeRect(3, 3, W - 6, H - 6);

  g.fillStyle = '#1d2f4a';
  g.font = `bold 30px ${FUENTE}`; g.fillText('REPÚBLICA DE GUATEMALA', 40, 55);
  g.font = `22px ${FUENTE}`; g.fillText('DOCUMENTO PERSONAL DE IDENTIFICACIÓN', 40, 88);
  g.fillStyle = '#a02020'; g.font = `bold 20px ${FUENTE}`; g.fillText('EJEMPLO FICTICIO — SOLO PRUEBAS', 40, 118);

  g.fillStyle = '#9aa7b5'; g.fillRect(40, 150, 220, 280);                 // foto
  g.fillStyle = '#586573'; g.font = `20px ${FUENTE}`; g.fillText('FOTO', 120, 295);

  g.fillStyle = '#1d2f4a';
  g.font = `18px ${FUENTE}`; g.fillText('CUI', 300, 165);
  g.font = `bold 52px ${MONO}`; g.fillText(cuiConEspacios(p.cui), 300, 220);

  g.font = `18px ${FUENTE}`; g.fillText('APELLIDOS / SURNAME', 300, 275);
  g.font = `bold 38px ${FUENTE}`; g.fillText(p.apellidos, 300, 318);

  g.font = `18px ${FUENTE}`; g.fillText('NOMBRES / GIVEN NAMES', 300, 372);
  g.font = `bold 38px ${FUENTE}`; g.fillText(p.nombres, 300, 415);

  g.font = `18px ${FUENTE}`; g.fillText('NACIONALIDAD / NATIONALITY', 300, 470);
  g.font = `bold 26px ${FUENTE}`; g.fillText('GUATEMALTECA', 300, 502);
  g.font = `18px ${FUENTE}`; g.fillText('FECHA DE NACIMIENTO', 40, 470);
  g.font = `bold 26px ${FUENTE}`; g.fillText(`${String(entero(1, 28)).padStart(2, '0')} ENE ${entero(1950, 2004)}`, 40, 502);
  g.font = `16px ${MONO}`; g.fillStyle = '#44556b'; g.fillText('<<<<<<<<<<<<< FICTICIO <<<<<<<<<<<<<<<<<<<<<<<<', 40, 590);
  return c;
}

// ── escena de captura (webcam) con variaciones ───────────────────────────────────────────────────────────
const CW = 1280, CH = 720;
const VARIANTES = ['limpia', 'luz_baja', 'luz_alta', 'angulo', 'ruido', 'desenfoque', 'mixta'];

function parametros(variante) {
  const base = { rot: 0, brillo: 1, ruido: 0, desenfoque: 0, gradiente: 0 };
  switch (variante) {
    case 'limpia': return { ...base, rot: entre(-1.5, 1.5), ruido: 2 };
    case 'luz_baja': return { ...base, rot: entre(-3, 3), brillo: entre(0.38, 0.6), ruido: 6, gradiente: entre(0.1, 0.3) };
    case 'luz_alta': return { ...base, rot: entre(-3, 3), brillo: entre(1.3, 1.7), gradiente: entre(0.1, 0.35) };
    case 'angulo': return { ...base, rot: (rnd() < 0.5 ? -1 : 1) * entre(8, 16), ruido: 3 };
    case 'ruido': return { ...base, rot: entre(-3, 3), ruido: entre(18, 34) };
    case 'desenfoque': return { ...base, rot: entre(-3, 3), desenfoque: entre(1.5, 3.2), ruido: 3 };
    default: return { rot: (rnd() < 0.5 ? -1 : 1) * entre(3, 10), brillo: entre(0.55, 1.35), ruido: entre(6, 20), desenfoque: entre(0.8, 2), gradiente: entre(0.1, 0.3) };
  }
}

function escena(tarjeta, prm) {
  const c = createCanvas(CW, CH);
  const g = c.getContext('2d');
  g.fillStyle = '#3b3f45'; g.fillRect(0, 0, CW, CH);                        // mesa
  const escala = 1.0;
  g.save();
  g.translate(CW / 2, CH / 2);
  g.rotate((prm.rot * Math.PI) / 180);
  g.shadowColor = 'rgba(0,0,0,0.5)'; g.shadowBlur = 24; g.shadowOffsetY = 8;
  g.drawImage(tarjeta, (-W * escala) / 2, (-H * escala) / 2, W * escala, H * escala);
  g.restore();

  if (prm.gradiente) {                                                       // luz despareja
    const lg = g.createLinearGradient(0, 0, CW, 0);
    const lado = rnd() < 0.5;
    lg.addColorStop(lado ? 0 : 1, `rgba(0,0,0,${prm.gradiente * 1.6})`);
    lg.addColorStop(lado ? 1 : 0, `rgba(255,255,255,${prm.gradiente * 0.5})`);
    g.fillStyle = lg; g.fillRect(0, 0, CW, CH);
  }
  if (prm.desenfoque > 0) {
    const t = createCanvas(CW, CH); const tg = t.getContext('2d');
    tg.filter = `blur(${prm.desenfoque.toFixed(2)}px)`; tg.drawImage(c, 0, 0);
    g.clearRect(0, 0, CW, CH); g.drawImage(t, 0, 0);
  }
  const img = g.getImageData(0, 0, CW, CH);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = prm.ruido ? gauss() * prm.ruido : 0;
    d[i] = Math.max(0, Math.min(255, d[i] * prm.brillo + n));
    d[i + 1] = Math.max(0, Math.min(255, d[i + 1] * prm.brillo + n));
    d[i + 2] = Math.max(0, Math.min(255, d[i + 2] * prm.brillo + n));
  }
  g.putImageData(img, 0, 0);
  return c;
}

// ── main ─────────────────────────────────────────────────────────────────────────────────────────────────
mkdirSync(OUT, { recursive: true });
const filas = ['archivo,cui,nombres,apellidos,variante,rotacion_grados,brillo,ruido_sigma,desenfoque_px,tiene_acentos'];
for (let i = 1; i <= N; i++) {
  const p = persona();
  const variante = VARIANTES[(i - 1) % VARIANTES.length];
  const prm = parametros(variante);
  const archivo = `img_${String(i).padStart(4, '0')}.jpg`;
  const jpg = escena(dibujarTarjeta(p), prm).toBuffer('image/jpeg', 85);
  writeFileSync(path.join(OUT, archivo), jpg);
  const acentos = quitarAcentos(p.nombres + p.apellidos) !== p.nombres + p.apellidos;
  filas.push([archivo, p.cui, p.nombres, p.apellidos, variante, prm.rot.toFixed(1), prm.brillo.toFixed(2), prm.ruido.toFixed(1), prm.desenfoque.toFixed(1), acentos ? 'si' : 'no'].join(','));
}
writeFileSync(path.join(OUT, 'verdad_terreno.csv'), filas.join('\n') + '\n', 'utf8');
console.log(`Listo: ${N} imágenes FICTICIAS y verdad_terreno.csv en ${OUT} (semilla ${SEMILLA}).`);
