/**
 * Descarga los modelos ONNX (formato .ort) que usa el sidecar y los deja en
 * sidecar-ocr/models/ (ignorado por git: ~12 MB de binarios no van al repo).
 *
 * Se descargan una vez en la máquina de build y se empaquetan como recursos
 * de la app: la garita NUNCA descarga modelos en runtime (puede no tener
 * internet el día de la instalación).
 *
 * Los SHA-256 están fijados: si el mirror cambia un archivo, el build falla
 * en vez de empaquetar silenciosamente otro modelo.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, '..', 'models');
const BASE = 'https://huggingface.co/snowfluke/ppu-paddle-ocr-models/resolve/main';
const MIRROR = 'https://github.com/PT-Perkasa-Pilar-Utama/ppu-paddle-ocr-models/raw/main';

// PP-OCRv5 mobile (detección) + PP-OCRv5 "en" mobile (reconocimiento): la
// misma familia que ppu-paddle-ocr expone como V5_EN_MOBILE_MODEL.
export const MODELS = [
  { file: 'PP-OCRv5_mobile_det_infer.ort',    rel: 'detection/PP-OCRv5_mobile_det_infer.ort',                     sha256: '30acfc4e21f2a23669d01a75aaeb92190f96874613108a0f7086bed264420abc' },
  { file: 'en_PP-OCRv5_mobile_rec_infer.ort', rel: 'recognition/multi/en/v5/en_PP-OCRv5_mobile_rec_infer.ort', sha256: '74ff9e508379375b5149a3c7764221fa9ba7680b7e2f2e458f26b7c7993a89b0' },
  { file: 'ppocrv5_en_dict.txt',              rel: 'recognition/multi/en/v5/ppocrv5_en_dict.txt',              sha256: 'c60d46e9e01d500ed6388fe8681051eac9cf6692e0d57238315be171927a0a1b' },
];

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

async function download(rel) {
  for (const base of [BASE, MIRROR]) {
    const url = `${base}/${rel}`;
    try {
      const res = await fetch(url, { redirect: 'follow' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (err) {
      console.warn(`  ${url}: ${err.message} — probando mirror`);
    }
  }
  throw new Error(`No se pudo descargar ${rel}`);
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const lock = path.join(OUT, 'SHA256SUMS');
  const pinned = existsSync(lock)
    ? Object.fromEntries((await readFile(lock, 'utf8')).split('\n').filter(Boolean).map(l => l.split(/\s+/).reverse()))
    : {};
  const sums = [];

  for (const m of MODELS) {
    const dest = path.join(OUT, m.file);
    const expected = m.sha256 ?? pinned[m.file] ?? null;
    if (existsSync(dest) && expected && sha256(await readFile(dest)) === expected) {
      console.log(`✓ ${m.file} (ya descargado, hash OK)`);
      sums.push(`${expected}  ${m.file}`);
      continue;
    }
    process.stdout.write(`↓ ${m.file} … `);
    const buf = await download(m.rel);
    const hash = sha256(buf);
    if (expected && hash !== expected) {
      throw new Error(`Hash inesperado para ${m.file}: ${hash} (esperado ${expected})`);
    }
    await writeFile(dest, buf);
    console.log(`${(buf.length / 1024 / 1024).toFixed(1)} MB sha256=${hash.slice(0, 12)}…`);
    sums.push(`${hash}  ${m.file}`);
  }
  await writeFile(lock, sums.join('\n') + '\n');
  console.log(`Modelos en ${OUT}`);
}

main().catch(err => { console.error(err); process.exit(1); });
