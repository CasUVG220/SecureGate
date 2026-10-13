/**
 * Prepara el sidecar de OCR para que Tauri lo empaquete.
 *
 *   node scripts/prepare-sidecar.mjs                 # host actual (desarrollo)
 *   node scripts/prepare-sidecar.mjs --target windows # build de producción
 *
 * Produce:
 *   src-tauri/binaries/node-<triple>[.exe]   ← runtime Node (externalBin)
 *   src-tauri/resources/sidecar-ocr/         ← server.js + node_modules
 *                                               (sólo prod, sólo la plataforma
 *                                               destino) + modelos .ort
 *
 * Por qué se empaqueta Node entero en vez de compilar el sidecar a un .exe:
 * onnxruntime-node y @napi-rs/canvas son addons nativos; `bun build --compile`
 * los soporta pero exige extraer y pre-cargar las DLL a mano en runtime (ver
 * scripts/binary/native-preload.ts en el repo de ppu-paddle-ocr). Un node.exe
 * oficial + node_modules es aburrido, verificable y no tiene casos raros.
 * Cuesta ~60 MB más de instalador; para una PC de garita es irrelevante.
 */
import { cpSync, existsSync, mkdirSync, rmSync, readdirSync, statSync, chmodSync, copyFileSync, writeFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DESKTOP = path.resolve(__dirname, '..');
const SIDECAR_SRC = path.join(DESKTOP, 'sidecar-ocr');
const RES_OUT = path.join(DESKTOP, 'src-tauri', 'resources', 'sidecar-ocr');
const BIN_OUT = path.join(DESKTOP, 'src-tauri', 'binaries');

/** Versión de Node que se empaqueta (LTS). Se sube a propósito, no sola. */
const NODE_VERSION = 'v24.21.0';

const args = process.argv.slice(2);
const targetArg = args[args.indexOf('--target') + 1];
const target = args.includes('--target') ? targetArg : 'host';

const TARGETS = {
  windows: { triple: 'x86_64-pc-windows-msvc', os: 'win32', cpu: 'x64', ortDir: 'win32/x64', exe: '.exe' },
  'darwin-arm64': { triple: 'aarch64-apple-darwin', os: 'darwin', cpu: 'arm64', ortDir: 'darwin/arm64', exe: '' },
  'darwin-x64': { triple: 'x86_64-apple-darwin', os: 'darwin', cpu: 'x64', ortDir: 'darwin/x64', exe: '' },
  'linux-x64': { triple: 'x86_64-unknown-linux-gnu', os: 'linux', cpu: 'x64', ortDir: 'linux/x64', exe: '' },
};

function hostTarget() {
  const key = `${os.platform() === 'win32' ? 'windows' : os.platform()}${os.platform() === 'win32' ? '' : '-' + os.arch()}`;
  if (!TARGETS[key]) throw new Error(`Host no soportado: ${key}`);
  return key;
}

const key = target === 'host' ? hostTarget() : target;
const t = TARGETS[key];
if (!t) throw new Error(`--target debe ser uno de: ${Object.keys(TARGETS).join(', ')}`);

console.log(`▶ Sidecar OCR para ${key} (${t.triple})`);

// ── 1. Modelos ─────────────────────────────────────────────────────────────
const modelsDir = path.join(SIDECAR_SRC, 'models');
if (!existsSync(path.join(modelsDir, 'SHA256SUMS'))) {
  console.log('  descargando modelos…');
  execSync('node scripts/fetch-models.mjs', { cwd: SIDECAR_SRC, stdio: 'inherit' });
}

// ── 2. Recursos: server.js + node_modules de producción para la plataforma ─
rmSync(RES_OUT, { recursive: true, force: true });
mkdirSync(RES_OUT, { recursive: true });
cpSync(path.join(SIDECAR_SRC, 'src'), path.join(RES_OUT, 'src'), { recursive: true });
cpSync(modelsDir, path.join(RES_OUT, 'models'), { recursive: true });
copyFileSync(path.join(SIDECAR_SRC, 'package.json'), path.join(RES_OUT, 'package.json'));
copyFileSync(path.join(SIDECAR_SRC, 'package-lock.json'), path.join(RES_OUT, 'package-lock.json'));

console.log(`  npm ci --omit=dev --os=${t.os} --cpu=${t.cpu}`);
execSync(`npm ci --omit=dev --ignore-scripts --no-audit --no-fund --os=${t.os} --cpu=${t.cpu}`, {
  cwd: RES_OUT, stdio: 'inherit',
});

// onnxruntime-node trae los binarios de TODAS las plataformas (~290 MB);
// sólo se conserva la carpeta del destino.
const napi = path.join(RES_OUT, 'node_modules', 'onnxruntime-node', 'bin', 'napi-v6');
for (const plat of readdirSync(napi)) {
  for (const arch of readdirSync(path.join(napi, plat))) {
    if (`${plat}/${arch}` !== t.ortDir) rmSync(path.join(napi, plat, arch), { recursive: true, force: true });
  }
  if (readdirSync(path.join(napi, plat)).length === 0) rmSync(path.join(napi, plat), { recursive: true });
}
// DirectML (GPU opcional en Windows) pesa ~37 MB y no se usa: sólo CPU.
for (const dll of ['DirectML.dll', 'dxcompiler.dll', 'dxil.dll']) {
  rmSync(path.join(napi, t.ortDir, dll), { force: true });
}
rmSync(path.join(RES_OUT, 'package-lock.json'), { force: true });

// ── 3. Runtime Node como externalBin ───────────────────────────────────────
// Siempre el binario oficial de nodejs.org (verificado contra SHASUMS256.txt),
// también para el host: el node de Homebrew/nvm puede ser un ejecutable fino
// que carga libnode.dylib por @rpath y no sobrevive a que lo copien.
mkdirSync(BIN_OUT, { recursive: true });
const binName = `node-${t.triple}${t.exe}`;
const binPath = path.join(BIN_OUT, binName);
const dist = { windows: 'win-x64', 'darwin-arm64': 'darwin-arm64', 'darwin-x64': 'darwin-x64', 'linux-x64': 'linux-x64' }[key];
const archive = `node-${NODE_VERSION}-${dist}.${key === 'windows' ? 'zip' : 'tar.gz'}`;
const cache = path.join(os.homedir(), '.cache', 'securegate-desktop');
mkdirSync(cache, { recursive: true });
const archivePath = path.join(cache, archive);
if (!existsSync(archivePath)) {
  console.log(`  descargando https://nodejs.org/dist/${NODE_VERSION}/${archive}`);
  execSync(`curl -fsSL -o "${archivePath}" "https://nodejs.org/dist/${NODE_VERSION}/${archive}"`, { stdio: 'inherit' });
}
const shasums = execSync(`curl -fsSL https://nodejs.org/dist/${NODE_VERSION}/SHASUMS256.txt`).toString();
const expected = shasums.split('\n').find(l => l.trim().endsWith(archive))?.split(/\s+/)[0];
// SHA-256 con Node (no con `shasum`): el mismo código corre en Windows, donde ese comando puede no existir.
const actual = createHash('sha256').update(readFileSync(archivePath)).digest('hex');
if (!expected || expected !== actual) {
  rmSync(archivePath, { force: true });
  throw new Error(`SHA-256 de ${archive} no coincide con SHASUMS256.txt (descarga eliminada; reintenta)`);
}
/**
 * Extrae UN archivo de un .zip. `unzip` existe en Linux/macOS y en Git Bash; en un Windows pelado solo está `tar.exe` (bsdtar, que lee zip) o
 * PowerShell. Se prueban en ese orden y se falla con un mensaje que dice qué faltó. (La rama de Windows no se pudo ejecutar en la nube.)
 */
function extraerDeZip(zip, miembro, destino) {
  const intentos = [
    `unzip -q -o "${zip}" "${miembro}" -d "${destino}"`,
    `tar -xf "${zip}" -C "${destino}" "${miembro}"`,
    `powershell -NoProfile -Command "Expand-Archive -LiteralPath '${zip}' -DestinationPath '${destino}' -Force"`,
  ];
  const errores = [];
  for (const cmd of intentos) {
    try { execSync(cmd, { stdio: 'pipe' }); if (existsSync(path.join(destino, miembro))) return; } catch (e) { errores.push(`${cmd.split(' ')[0]}: ${String(e.message).split('\n')[0]}`); }
  }
  throw new Error(`No se pudo extraer ${miembro} de ${zip}. Intentos: ${errores.join(' | ')}`);
}

const inner = `node-${NODE_VERSION}-${dist}`;
const extractDir = path.join(cache, inner);
rmSync(extractDir, { recursive: true, force: true });
if (key === 'windows') {
  extraerDeZip(archivePath, `${inner}/node.exe`, cache);
  copyFileSync(path.join(extractDir, 'node.exe'), binPath);
} else {
  execSync(`tar -xzf "${archivePath}" -C "${cache}" "${inner}/bin/node"`);
  copyFileSync(path.join(extractDir, 'bin', 'node'), binPath);
  chmodSync(binPath, 0o755);
}
// ffmpeg del puente de video (T6/T7): un build mínimo LGPL que se compila con scripts/build-ffmpeg-min.sh (no se descarga: el popular es GPL y pesa 80 MB).
const ffmpegBin = path.join(BIN_OUT, `ffmpeg-${t.triple}${t.exe}`);
if (!existsSync(ffmpegBin) || statSync(ffmpegBin).size < 1_000_000) {
  console.warn(`  ⚠ falta ${path.basename(ffmpegBin)}: las cámaras IP y el celular no funcionarán hasta compilarlo (desktop/scripts/build-ffmpeg-min.sh ${key === 'windows' ? 'windows' : 'linux'}). La webcam USB no lo necesita.`);
} else {
  console.log(`  ${path.basename(ffmpegBin)} presente (${(statSync(ffmpegBin).size / 2 ** 20).toFixed(1)} MB)`);
}
console.log(`  ${binName} ← nodejs.org ${NODE_VERSION} ${dist} (sha256 verificado)`);

const size = dir => readdirSync(dir, { recursive: true }).reduce((n, f) => {
  const p = path.join(dir, f); return n + (statSync(p).isFile() ? statSync(p).size : 0);
}, 0);
writeFileSync(path.join(RES_OUT, 'BUILD_INFO.json'), JSON.stringify({
  target: key, triple: t.triple, node: NODE_VERSION, generado: new Date().toISOString(),
}, null, 2));
console.log(`✓ recursos: ${(size(RES_OUT) / 2 ** 20).toFixed(0)} MB, runtime: ${(statSync(binPath).size / 2 ** 20).toFixed(0)} MB`);
