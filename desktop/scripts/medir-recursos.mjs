#!/usr/bin/env node
/**
 * Mide CPU y RAM de la garita con 1 y 2 flujos de video simulados (T9, SCRUM-120).
 *
 *   # A) Solo el puente de video (se puede correr en la nube/Linux): lanza N lectores ffmpeg contra cámaras RTSP simuladas
 *   node desktop/scripts/medir-recursos.mjs puente --ffmpeg <ffmpeg-minimo> --mediamtx <mediamtx> [--publicador ffmpeg] [--flujos 1,2] [--segundos 30]
 *
 *   # B) La app de escritorio completa (en el equipo real, p. ej. Windows con 6-8 GB): levanta las cámaras simuladas, te pide encender
 *   #    1 flujo y luego 2 en la app, y muestrea CPU y RAM de TODO el árbol de procesos de la app (WebView2, sidecar de OCR, ffmpeg…)
 *   node desktop/scripts/medir-recursos.mjs app --pid <PID de securegate-garita> --mediamtx <ruta> [--publicador ffmpeg] [--flujos 1,2] [--segundos 60]
 *
 * Salida: tabla en pantalla y `desktop/scripts/reportes/recursos-<fecha>.{md,json}` (ignorados por git). Para repetirlo en un equipo de 6 a 8 GB
 * sigue `docs/validacion_windows.md` (plantilla de 20 minutos) y `docs/plantilla_medicion_camaras.md`.
 *
 * Qué mide: por escenario, la CPU (como % de UN núcleo y como % del total de la máquina) y la RAM (RSS/«Working Set») pico y promedio de los
 * procesos medidos; los fotogramas por segundo que salieron (modo puente). El muestreo usa `ps` (Linux/macOS) o PowerShell (Windows).
 * **El muestreo de Windows (PowerShell) no se ejecutó en la nube: se prueba con salidas de ejemplo en `medir-recursos.test.mjs`.**
 *
 * Las cámaras simuladas son `testsrc2` (un patrón de prueba, sin personas ni lugares) publicado por RTSP; no hay datos personales.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const aquí = path.dirname(fileURLToPath(import.meta.url));

// ── Utilidades puras (con pruebas) ───────────────────────────────────────────────────────────────────────

/** Tiempo de CPU de `ps` («MM:SS.ss», «HH:MM:SS», «D-HH:MM:SS») a segundos. */
export function cpuAsegundos(t) {
  const s = String(t).trim();
  const [dias, resto] = s.includes('-') ? s.split('-') : ['0', s];
  const partes = resto.split(':').map(Number);
  if (partes.some(Number.isNaN)) return 0;
  while (partes.length < 3) partes.unshift(0);
  return Number(dias) * 86400 + partes[0] * 3600 + partes[1] * 60 + partes[2];
}

/** Salida de `ps -axo pid=,ppid=,rss=,time=` → [{ pid, ppid, rssKB, cpuS }]. */
export function parsearPs(texto) {
  return texto.split('\n').map(l => l.trim().split(/\s+/)).filter(p => p.length >= 4 && /^\d+$/.test(p[0]))
    .map(p => ({ pid: Number(p[0]), ppid: Number(p[1]), rssKB: Number(p[2]), cpuS: cpuAsegundos(p[3]) }));
}

/** Salida de PowerShell `ProcessId,ParentProcessId,WorkingSetSize,KernelModeTime,UserModeTime` (CSV) → igual que `parsearPs`. KernelModeTime/UserModeTime vienen en unidades de 100 ns. */
export function parsearWindows(csv) {
  const lineas = csv.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const cab = lineas.shift()?.replace(/"/g, '').split(',') ?? [];
  const ix = n => cab.indexOf(n);
  return lineas.map(l => l.replace(/"/g, '').split(',')).map(c => ({
    pid: Number(c[ix('ProcessId')]), ppid: Number(c[ix('ParentProcessId')]),
    rssKB: Math.round(Number(c[ix('WorkingSetSize')]) / 1024),
    cpuS: (Number(c[ix('KernelModeTime')]) + Number(c[ix('UserModeTime')])) / 1e7,
  })).filter(p => Number.isFinite(p.pid) && Number.isFinite(p.cpuS));
}

/** El proceso `raiz` y todos sus descendientes. */
export function arbol(procesos, raiz) {
  const hijos = new Map();
  for (const p of procesos) hijos.set(p.ppid, [...(hijos.get(p.ppid) ?? []), p]);
  const out = [];
  const pila = procesos.filter(p => p.pid === raiz);
  while (pila.length) {
    const p = pila.pop();
    out.push(p);
    pila.push(...(hijos.get(p.pid) ?? []));
  }
  return out;
}

/** Resumen de una serie de muestras `{ t (s), cpuS (acumulada), rssKB }`. */
export function resumirMuestras(muestras, nucleos) {
  if (muestras.length < 2) return { cpuNucleoPct: 0, cpuTotalPct: 0, ramPicoMB: 0, ramPromMB: 0, muestras: muestras.length };
  const primera = muestras[0], ultima = muestras[muestras.length - 1];
  const dt = ultima.t - primera.t || 1;
  const cpuNucleoPct = Math.max(0, ((ultima.cpuS - primera.cpuS) / dt) * 100);
  const rss = muestras.map(m => m.rssKB / 1024);
  return {
    cpuNucleoPct: Number(cpuNucleoPct.toFixed(1)),
    cpuTotalPct: Number((cpuNucleoPct / nucleos).toFixed(1)),
    ramPicoMB: Math.round(Math.max(...rss)),
    ramPromMB: Math.round(rss.reduce((a, b) => a + b, 0) / rss.length),
    muestras: muestras.length,
  };
}

export function informacionEquipo() {
  const cpus = os.cpus();
  return {
    sistema: `${os.type()} ${os.release()} (${os.platform()}/${os.arch()})`,
    cpu: cpus[0]?.model?.trim() ?? 'desconocida', nucleos: cpus.length,
    ramTotalGB: Number((os.totalmem() / 2 ** 30).toFixed(1)), ramLibreGB: Number((os.freemem() / 2 ** 30).toFixed(1)),
    node: process.version, fecha: new Date().toISOString(),
  };
}

export function reporteMarkdown(rep) {
  const L = ['# Medición de recursos con cámaras simuladas', '', `- Modo: **${rep.modo}**`, `- Equipo: ${rep.equipo.cpu} × ${rep.equipo.nucleos} · ${rep.equipo.ramTotalGB} GB de RAM · ${rep.equipo.sistema}`,
    `- Fecha: ${rep.equipo.fecha}`, `- Cámaras: ${rep.camaras}`, ''];
  if (rep.equipo.ramTotalGB > 9 || rep.equipo.ramTotalGB < 5) {
    L.push(`> ⚠️ Este equipo tiene ${rep.equipo.ramTotalGB} GB; el objetivo es de **6 a 8 GB**. Repetir en un equipo representativo (docs/validacion_windows.md).`, '');
  }
  L.push('| Escenario | CPU (% de un núcleo) | CPU (% del total) | RAM pico (MB) | RAM promedio (MB) | Procesos | fps de salida |', '|---|---|---|---|---|---|---|');
  for (const e of rep.escenarios) {
    L.push(`| ${e.nombre} | ${e.cpuNucleoPct} | ${e.cpuTotalPct} | ${e.ramPicoMB} | ${e.ramPromMB} | ${e.procesos ?? '—'} | ${e.fps ?? '—'} |`);
  }
  L.push('', rep.nota ?? '');
  return L.join('\n');
}

// ── Muestreo por plataforma ──────────────────────────────────────────────────────────────────────────────

export function listarProcesos() {
  if (process.platform === 'win32') {
    const r = spawnSync('powershell', ['-NoProfile', '-Command',
      'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,WorkingSetSize,KernelModeTime,UserModeTime | ConvertTo-Csv -NoTypeInformation'], { encoding: 'utf8' });
    return parsearWindows(r.stdout ?? '');
  }
  const r = spawnSync('ps', ['-axo', 'pid=,ppid=,rss=,time='], { encoding: 'utf8' });
  return parsearPs(r.stdout ?? '');
}

/** Muestrea durante `segundos` los procesos que devuelve `quienes(procesos)`; devuelve las muestras agregadas (suma del grupo). */
export async function muestrear(quienes, segundos, intervaloMs = 1000) {
  const muestras = [];
  let maxProcs = 0;
  const t0 = Date.now();
  while ((Date.now() - t0) / 1000 < segundos) {
    const grupo = quienes(listarProcesos());
    maxProcs = Math.max(maxProcs, grupo.length);
    muestras.push({ t: (Date.now() - t0) / 1000, cpuS: grupo.reduce((a, p) => a + p.cpuS, 0), rssKB: grupo.reduce((a, p) => a + p.rssKB, 0) });
    await new Promise(r => setTimeout(r, intervaloMs));
  }
  return { muestras, procesos: maxProcs };
}

const dormir = ms => new Promise(r => setTimeout(r, ms));
const puertoLibre = () => new Promise(r => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });

async function parUdpLibre() {
  const dgram = await import('node:dgram');
  for (;;) {
    const a = dgram.createSocket('udp4');
    const p = await new Promise(r => a.bind(0, '127.0.0.1', () => r(a.address().port)));
    a.close();
    if (p % 2 === 0) return p;
  }
}

/** Levanta mediamtx y publica `n` cámaras simuladas (testsrc2 por RTSP). Devuelve las URL y cómo apagarlo. */
async function levantarCamaras({ mediamtx, publicador, n, resolucion = '1280x720', fps = 15 }) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'sg-medir-'));
  const [rtsp, rtp] = [await puertoLibre(), await parUdpLibre()];
  writeFileSync(path.join(dir, 'm.yml'), `logLevel: error\nrtspAddress: 127.0.0.1:${rtsp}\nrtpAddress: 127.0.0.1:${rtp}\nrtcpAddress: 127.0.0.1:${rtp + 1}\nrtmp: no\nhls: no\nwebrtc: no\nsrt: no\napi: no\nmetrics: no\npaths:\n  all_others:\n`);
  const hijos = [spawn(mediamtx, [path.join(dir, 'm.yml')], { stdio: 'ignore' })];
  await dormir(1000);
  const urls = [];
  for (let i = 1; i <= n; i++) {
    hijos.push(spawn(publicador, ['-loglevel', 'error', '-re', '-f', 'lavfi', '-i', `testsrc2=size=${resolucion}:rate=${fps}`, '-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency',
      '-g', String(fps), '-b:v', '2000k', '-pix_fmt', 'yuv420p', '-f', 'rtsp', '-rtsp_transport', 'tcp', `rtsp://127.0.0.1:${rtsp}/camara${i}`], { stdio: 'ignore' }));
    urls.push(`rtsp://127.0.0.1:${rtsp}/camara${i}`);
  }
  await dormir(2500);
  return { urls, apagar: () => { hijos.forEach(h => h.kill()); rmSync(dir, { recursive: true, force: true }); } };
}

// ── Modo puente ──────────────────────────────────────────────────────────────────────────────────────────

async function modoPuente(o) {
  const equipo = informacionEquipo();
  const escenarios = [];
  for (const n of o.flujos) {
    const cams = await levantarCamaras({ mediamtx: o.mediamtx, publicador: o.publicador, n });
    const lectores = cams.urls.map(u => spawn(o.ffmpeg, ['-hide_banner', '-nostdin', '-loglevel', 'error', '-rtsp_transport', 'tcp', '-i', u, '-an',
      '-vf', 'fps=10,scale=960:-2', '-c:v', 'mjpeg', '-q:v', '5', '-f', 'mjpeg', 'pipe:1'], { stdio: ['ignore', 'pipe', 'ignore'] }));
    let bytes = 0, jpegs = 0;
    for (const l of lectores) l.stdout.on('data', d => { bytes += d.length; for (let i = 0; i < d.length - 1; i++) if (d[i] === 0xff && d[i + 1] === 0xd9) jpegs++; });
    await dormir(3000);                                        // calentamiento
    const pids = new Set(lectores.map(l => l.pid));
    const { muestras, procesos } = await muestrear(ps => ps.filter(p => pids.has(p.pid)), o.segundos);
    const r = resumirMuestras(muestras, equipo.nucleos);
    escenarios.push({ nombre: `${n} flujo${n > 1 ? 's' : ''} 720p15 → MJPEG 960 px a 10 fps (puente)`, ...r, procesos, fps: Number((jpegs / (o.segundos + 3) / n).toFixed(1)), bytes });
    lectores.forEach(l => l.kill());
    cams.apagar();
    await dormir(500);
  }
  return { modo: 'puente (solo ffmpeg)', equipo, camaras: 'testsrc2 720p15 H.264 por RTSP (mediamtx)', escenarios,
    nota: 'Mide solo los procesos ffmpeg del puente. No incluye la app, WebView2 ni el OCR: para eso usa el modo `app` en el equipo real.' };
}

// ── Modo app ─────────────────────────────────────────────────────────────────────────────────────────────

async function esperarEnter(mensaje) {
  process.stdout.write(`\n${mensaje}\nPulsa Enter cuando esté listo… `);
  await new Promise(r => process.stdin.once('data', r));
}

async function modoApp(o) {
  const equipo = informacionEquipo();
  const escenarios = [];
  const raiz = o.pid;
  const base = await muestrear(ps => arbol(ps, raiz), Math.min(o.segundos, 15));
  escenarios.push({ nombre: 'Reposo (app abierta, sin cámaras IP encendidas)', ...resumirMuestras(base.muestras, equipo.nucleos), procesos: base.procesos });
  const maxN = Math.max(...o.flujos);
  const cams = await levantarCamaras({ mediamtx: o.mediamtx, publicador: o.publicador, n: maxN });
  console.log('\nCámaras simuladas listas. Agrega estas direcciones en «Cámaras de esta garita → Cámaras IP y celulares»:');
  cams.urls.forEach((u, i) => console.log(`  ${i + 1}. ${u}`));
  try {
    for (const n of o.flujos) {
      await esperarEnter(`Asigna ${n} cámara${n > 1 ? 's' : ''} a ${n > 1 ? 'tareas distintas, con la vista de ' + (n === 2 ? '2' : '4') + ' cámaras' : 'una tarea, con la vista de 1 cámara'} y comprueba que se ve la imagen en vivo.`);
      const { muestras, procesos } = await muestrear(ps => arbol(ps, raiz), o.segundos);
      escenarios.push({ nombre: `${n} flujo${n > 1 ? 's' : ''} simulado${n > 1 ? 's' : ''} en la app`, ...resumirMuestras(muestras, equipo.nucleos), procesos });
    }
  } finally {
    cams.apagar();
  }
  return { modo: 'app (árbol de procesos completo)', equipo, camaras: `testsrc2 720p15 por RTSP (mediamtx); ${maxN} publicada(s)`, escenarios,
    nota: 'Procesos medidos: la app, su WebView, el sidecar de OCR y ffmpeg. Criterio sugerido (RNF-03/RNF-13): RAM total < 1,5 GB y CPU < 40 % del total con 2 flujos.' };
}

// ── main ─────────────────────────────────────────────────────────────────────────────────────────────────

function leerArgs(argv) {
  const [modo, ...resto] = argv;
  const g = (f, d) => { const i = resto.indexOf(f); return i >= 0 ? resto[i + 1] : d; };
  return {
    modo, ffmpeg: g('--ffmpeg'), mediamtx: g('--mediamtx', process.env.SG_MEDIAMTX), publicador: g('--publicador', 'ffmpeg'),
    flujos: g('--flujos', '1,2').split(',').map(Number).filter(n => n >= 1 && n <= 4), segundos: Number(g('--segundos', 30)), pid: Number(g('--pid', 0)),
    salida: path.resolve(g('--salida', path.join(aquí, 'reportes'))),
  };
}

async function main() {
  const o = leerArgs(process.argv.slice(2));
  const falta = (c, m) => { if (c) { console.error(m); process.exit(2); } };
  falta(!['puente', 'app'].includes(o.modo), 'Uso: medir-recursos.mjs puente|app … (ver el encabezado del archivo)');
  falta(!o.mediamtx || !existsSync(o.mediamtx), 'Falta mediamtx (--mediamtx <ruta> o SG_MEDIAMTX): es el servidor RTSP de las cámaras simuladas.');
  falta(spawnSync(o.publicador, ['-version'], { stdio: 'ignore' }).status !== 0, `Falta «${o.publicador}» con libx264 para publicar las cámaras simuladas (--publicador).`);
  if (o.modo === 'puente') falta(!o.ffmpeg || !existsSync(o.ffmpeg), 'Falta --ffmpeg <ruta del ffmpeg mínimo> (desktop/scripts/build-ffmpeg-min.sh).');
  if (o.modo === 'app') falta(!o.pid, 'Falta --pid <PID de securegate-garita> (en Windows: Get-Process securegate-garita).');
  const rep = o.modo === 'puente' ? await modoPuente(o) : await modoApp(o);
  mkdirSync(o.salida, { recursive: true });
  const sello = rep.equipo.fecha.replace(/[:.]/g, '-').slice(0, 19);
  writeFileSync(path.join(o.salida, `recursos-${sello}.json`), JSON.stringify(rep, null, 2));
  const md = reporteMarkdown(rep);
  writeFileSync(path.join(o.salida, `recursos-${sello}.md`), md);
  console.log('\n' + md);
  console.log(`\nReporte: ${path.join(o.salida, `recursos-${sello}.md`)}`);
  process.exit(0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(e => { console.error(e); process.exit(1); });
}
