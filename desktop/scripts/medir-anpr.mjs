#!/usr/bin/env node
/**
 * Mide el ANPR continuo (Sprint 10, tarea 7): CPU y RAM del proceso de Rust y del sidecar por separado, ms por etapa, latencia
 * de la decisión y exactitud sobre los clips sintéticos, con 1 y 2 carriles. Ver docs/anpr_continuo.md («Tarea 7»).
 *
 *   # A) Pipeline real sin ventana (Linux, macOS o Windows con Rust): la prueba `anpr::pruebas_reales` (bucle de Rust + sidecar
 *   #    real + SQLCipher + actuador simulado) con los clips de test-fixtures/anpr reproducidos en tiempo real.
 *   node desktop/scripts/medir-anpr.mjs pipeline [--release] [--escenarios reposo,1,2]
 *
 *   # B) La app completa en el equipo de la garita (Windows, 6–8 GB): muestrea el árbol de procesos de la app (Tauri, WebView2,
 *   #    sidecars, ffmpeg) mientras alguien pasa vehículos por los carriles configurados.
 *   node desktop/scripts/medir-anpr.mjs app --pid <PID de securegate-garita> [--segundos 60]
 *
 * Necesita (modo pipeline): `cargo`, `node`, `ffmpeg` y los modelos (`node desktop/sidecar-ocr/scripts/fetch-models.mjs`).
 * Salida: tabla en pantalla y `desktop/scripts/reportes/anpr-<fecha>.{md,json}` (ignorados por git). No inventa nada: lo que no
 * se midió queda vacío.
 *
 * Latencia de la decisión = desde la primera lectura legible de la placa (`ms_desde_legible`, sidecar) hasta que Rust registró
 * el acceso en la base y mandó abrir (`ms_rust_total`). El tiempo de acercamiento del vehículo no cuenta: depende de la calle.
 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { arbol, informacionEquipo, listarProcesos, muestrear, resumirMuestras } from './medir-recursos.mjs';

const aquí = path.dirname(fileURLToPath(import.meta.url));
const TAURI = path.resolve(aquí, '..', 'src-tauri');

/** Objetivos del sprint y criterio sugerido de la plantilla de cámaras (a confirmar por el equipo). */
export const OBJETIVOS = Object.freeze({ latenciaMs: 2000, cpuTotalPct: 40, ramMB: 1536 });

const ESCENARIOS = {
  reposo: { prueba: 'medicion_reposo', nombre: 'Reposo: 2 carriles, calle vacía' },
  1: { prueba: 'medicion_un_carril', nombre: '1 carril con tráfico (7 clips seguidos)' },
  2: { prueba: 'medicion_dos_carriles', nombre: '2 carriles con tráfico a la vez' },
};

// ── Utilidades puras (con pruebas en medir-anpr.test.mjs) ───────────────────────────────────────────────────────────

/** Ruta del ejecutable de pruebas de la biblioteca en la salida `--message-format=json` de cargo. */
export function ejecutableDePruebas(salidaJson) {
  for (const linea of salidaJson.split('\n')) {
    if (!linea.startsWith('{')) continue;
    let m;
    try { m = JSON.parse(linea); } catch { continue; }
    if (m.reason === 'compiler-artifact' && m.target?.name === 'securegate_garita_lib' && m.profile?.test && m.executable) return m.executable;
  }
  return null;
}

/** La línea `MEDICION_ANPR {...}` de la prueba. */
export function medicionDe(stdout) {
  const l = stdout.split('\n').find(x => x.startsWith('MEDICION_ANPR '));
  return l ? JSON.parse(l.slice('MEDICION_ANPR '.length)) : null;
}

/** p50/p95/máx de una lista (o nulls si está vacía). */
export function percentiles(v) {
  if (!v.length) return { n: 0, p50: null, p95: null, max: null };
  const s = [...v].sort((a, b) => a - b);
  const p = q => s[Math.round((s.length - 1) * q)];
  return { n: s.length, p50: p(0.5), p95: p(0.95), max: s[s.length - 1] };
}

/** Qué hacer si algo se pasa de los objetivos. Lista vacía = nada que mitigar. */
export function mitigaciones(esc, nucleos) {
  const m = [];
  const lat = esc.latenciaTotal?.p95;
  if (lat != null && lat > OBJETIVOS.latenciaMs) {
    m.push(`La latencia p95 (${Math.round(lat)} ms) pasa de ${OBJETIVOS.latenciaMs} ms: bajar «Cuadros por segundo con movimiento» a 3 en los carriles y, si no basta, el detector a 1 hilo (--hilos-detector 1).`);
  }
  const cpu = (esc.rust?.cpuTotalPct ?? 0) + (esc.sidecar?.cpuTotalPct ?? 0);
  if (cpu > OBJETIVOS.cpuTotalPct) {
    m.push(`La CPU del ANPR (${cpu.toFixed(1)} % del total en ${nucleos} núcleos) pasa del ${OBJETIVOS.cpuTotalPct} %: bajar los fps con movimiento y el detector a 1 hilo.`);
  }
  const ram = (esc.rust?.ramPicoMB ?? 0) + (esc.sidecar?.ramPicoMB ?? 0);
  if (ram > OBJETIVOS.ramMB) m.push(`La RAM pico (${ram} MB) pasa de ${OBJETIVOS.ramMB} MB.`);
  return m;
}

const f = (v, d = 0) => (v == null ? '—' : Number(v).toFixed(d));

export function reporteMarkdown(rep) {
  const L = ['# Medición del ANPR continuo', '', `- Modo: **${rep.modo}**${rep.perfil ? ` (perfil de Rust: ${rep.perfil})` : ''}`,
    `- Equipo: ${rep.equipo.cpu} × ${rep.equipo.nucleos} · ${rep.equipo.ramTotalGB} GB de RAM · ${rep.equipo.sistema}`, `- Fecha: ${rep.equipo.fecha}`, ''];
  L.push('## CPU y RAM', '', '| Escenario | Rust: CPU % núcleo | Rust: RAM pico MB | Sidecar: CPU % núcleo | Sidecar: RAM pico MB | CPU total % de la máquina | Cuadros procesados / publicados |', '|---|---|---|---|---|---|---|');
  for (const e of rep.escenarios) {
    const tot = (e.rust?.cpuTotalPct ?? 0) + (e.sidecar?.cpuTotalPct ?? 0);
    const proc = e.medicion ? Object.keys(e.medicion.cuadros_publicados).map(k => `${k}: ${e.medicion.cuadros_procesados[k] ?? 0}/${e.medicion.cuadros_publicados[k]}`).join(', ') : '—';
    L.push(`| ${e.nombre} | ${f(e.rust?.cpuNucleoPct, 1)} | ${f(e.rust?.ramPicoMB)} | ${f(e.sidecar?.cpuNucleoPct, 1)} | ${f(e.sidecar?.ramPicoMB)} | ${f(tot, 1)} | ${proc} |`);
  }
  L.push('', '## ms por etapa (por cuadro procesado; p50 / p95)', '', '| Escenario | decodificar | movimiento | detector | tracker | OCR | total |', '|---|---|---|---|---|---|---|');
  for (const e of rep.escenarios) {
    const et = e.medicion?.etapas_ms ?? {};
    const c = k => (et[k]?.n ? `${f(et[k].p50, 1)} / ${f(et[k].p95, 1)}` : '—');
    L.push(`| ${e.nombre} | ${c('decodificar')} | ${c('movimiento')} | ${c('detector')} | ${c('tracker')} | ${c('ocr')} | ${c('total')} |`);
  }
  L.push('', `## Latencia de la decisión (objetivo < ${OBJETIVOS.latenciaMs} ms)`, '',
    '| Escenario | Decisiones | Sidecar: desde legible p50 / p95 / máx (ms) | Rust: registro + orden de abrir p50 / p95 / máx (ms) | Total p95 (ms) |', '|---|---|---|---|---|');
  for (const e of rep.escenarios) {
    const s = e.medicion?.ms_desde_legible ?? {};
    const r = e.medicion?.ms_rust_total ?? {};
    L.push(`| ${e.nombre} | ${e.medicion?.ms_rust_total?.n ?? 0} | ${f(s.p50)} / ${f(s.p95)} / ${f(s.max)} | ${f(r.p50, 1)} / ${f(r.p95, 1)} / ${f(r.max, 1)} | ${f(e.latenciaTotal?.p95)} |`);
  }
  L.push('', '## Exactitud sobre los clips (verdad de terreno)', '', '| Escenario | Vehículos | Abrió (placa correcta) | Al agente con la placa correcta | Ilegible | Placa equivocada | Falsas (sin vehículo) | Sin decisión |', '|---|---|---|---|---|---|---|---|');
  for (const e of rep.escenarios) {
    const x = e.medicion?.exactitud;
    if (!x) { L.push(`| ${e.nombre} | — | — | — | — | — | — | — |`); continue; }
    L.push(`| ${e.nombre} | ${x.vehiculos} | ${x.abrio_correcta} | ${x.verificacion_correcta} | ${x.ilegible} | ${x.placa_equivocada} | ${x.falsas} | ${x.perdidos} |`);
  }
  L.push('', '## Mitigación', '');
  const ms = rep.escenarios.flatMap(e => mitigaciones(e, rep.equipo.nucleos).map(t => `- ${e.nombre}: ${t}`));
  L.push(ms.length ? ms.join('\n') : '- Nada se pasó de los objetivos en este equipo: sin mitigación.', '');
  if (rep.nota) L.push(rep.nota, '');
  return L.join('\n');
}

// ── Modo pipeline ────────────────────────────────────────────────────────────────────────────────────────────────────

function compilar(release) {
  console.log(`Compilando las pruebas de Rust${release ? ' (release)' : ''}…`);
  const r = spawnSync('cargo', ['test', '--lib', '--locked', ...(release ? ['--release'] : []), '--no-run', '--message-format=json'],
    { cwd: TAURI, encoding: 'utf8', maxBuffer: 256 * 2 ** 20, stdio: ['ignore', 'pipe', 'inherit'] });
  const exe = ejecutableDePruebas(r.stdout ?? '');
  if (r.status !== 0 || !exe) throw new Error('No se pudo compilar el ejecutable de pruebas de Rust.');
  return exe;
}

/** Corre una prueba de medición y muestrea Rust (el proceso de la prueba) y el sidecar (sus hijos) por separado. */
async function correrEscenario(exe, esc, nucleos) {
  console.log(`\n▶ ${esc.nombre}`);
  const hijo = spawn(exe, [`anpr::pruebas_reales::${esc.prueba}`, '--exact', '--ignored', '--nocapture', '--test-threads', '1'], { cwd: TAURI });
  let salida = '';
  let listo = false;
  hijo.stdout.on('data', d => { salida += d; if (!listo && salida.includes('ANPR_LISTO')) listo = true; });
  hijo.stderr.on('data', d => { salida += d; });
  const fin = new Promise(r => hijo.on('close', r));
  while (!listo && hijo.exitCode === null) await new Promise(r => setTimeout(r, 200));
  const rust = [];
  const sidecar = [];
  const t0 = Date.now();
  let terminado = false;
  void fin.then(() => { terminado = true; });
  while (!terminado) {
    const procs = listarProcesos();
    const t = (Date.now() - t0) / 1000;
    const propio = procs.filter(p => p.pid === hijo.pid);
    const hijos = arbol(procs, hijo.pid).filter(p => p.pid !== hijo.pid);
    if (propio.length) rust.push({ t, cpuS: propio[0].cpuS, rssKB: propio[0].rssKB });
    if (hijos.length) sidecar.push({ t, cpuS: hijos.reduce((a, p) => a + p.cpuS, 0), rssKB: hijos.reduce((a, p) => a + p.rssKB, 0) });
    await new Promise(r => setTimeout(r, 1000));
  }
  const codigo = await fin;
  const medicion = medicionDe(salida);
  if (codigo !== 0) console.error(`  ⚠️ la prueba terminó con código ${codigo}:\n${salida.split('\n').filter(l => /panicked|assert/.test(l)).join('\n')}`);
  // Para la CPU se descarta el último segundo (el proceso ya se estaba cerrando).
  const res = {
    nombre: esc.nombre, prueba: esc.prueba, ok: codigo === 0,
    rust: resumirMuestras(rust.slice(0, -1), nucleos), sidecar: resumirMuestras(sidecar.slice(0, -1), nucleos), medicion,
  };
  const lat = (medicion?.clips ?? []).flatMap(c => c.decisiones).filter(d => typeof d.ms_desde_legible === 'number').map(d => d.ms_desde_legible);
  const rustP95 = medicion?.ms_rust_total?.p95 ?? 0;
  res.latenciaTotal = percentiles(lat.map(v => v + rustP95));
  return res;
}

async function modoPipeline(o) {
  const equipo = informacionEquipo();
  const exe = compilar(o.release);
  const escenarios = [];
  for (const k of o.escenarios) escenarios.push(await correrEscenario(exe, ESCENARIOS[k], equipo.nucleos));
  return {
    modo: 'pipeline (Rust + sidecar real + SQLCipher, sin ventana)', perfil: o.release ? 'release' : 'debug', equipo, escenarios,
    nota: 'Sin WebView (no hay ventana): la RAM y la CPU de la pantalla se miden con el modo `app` en el equipo real. '
      + 'Clips sintéticos 960×540 reproducidos en tiempo real (test-fixtures/anpr). La latencia total suma el p95 de Rust a cada decisión.',
  };
}

// ── Modo app (equipo real) ──────────────────────────────────────────────────────────────────────────────────────────

async function esperarEnter(mensaje) {
  process.stdout.write(`\n${mensaje}\nPulsa Enter cuando esté listo… `);
  await new Promise(r => process.stdin.once('data', r));
}

async function modoApp(o) {
  const equipo = informacionEquipo();
  const fases = [
    ['ANPR en pausa (garita abierta, «Pausar ANPR» activo)', 'Activa «Pausar ANPR».'],
    ['Reposo: carriles activos, sin vehículos', 'Reanuda el ANPR y deja los carriles sin vehículos.'],
    ['1 carril con tráfico', `Pasa vehículos por UN carril durante ${o.segundos} s (o reproduce un video frente a la cámara).`],
    ['2 carriles con tráfico', `Pasa vehículos por los DOS carriles durante ${o.segundos} s.`],
  ];
  const escenarios = [];
  for (const [nombre, instruccion] of fases) {
    await esperarEnter(instruccion);
    const { muestras, procesos } = await muestrear(ps => arbol(ps, o.pid), o.segundos);
    escenarios.push({ nombre, app: { ...resumirMuestras(muestras, equipo.nucleos), procesos } });
  }
  return { modo: 'app (árbol de procesos completo)', equipo, escenarios };
}

function reporteApp(rep) {
  const L = ['# Medición del ANPR en la app', '', `- Equipo: ${rep.equipo.cpu} × ${rep.equipo.nucleos} · ${rep.equipo.ramTotalGB} GB · ${rep.equipo.sistema}`, `- Fecha: ${rep.equipo.fecha}`, '',
    '| Fase | CPU (% de un núcleo) | CPU (% del total) | RAM pico (MB) | RAM promedio (MB) | Procesos |', '|---|---|---|---|---|---|'];
  for (const e of rep.escenarios) L.push(`| ${e.nombre} | ${e.app.cpuNucleoPct} | ${e.app.cpuTotalPct} | ${e.app.ramPicoMB} | ${e.app.ramPromMB} | ${e.app.procesos} |`);
  L.push('', 'Latencia y exactitud en la garita: ver «Eventos del ANPR» (cada evento dice los segundos desde la primera lectura legible).');
  return L.join('\n');
}

// ── main ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

function leerArgs(argv) {
  const [modo, ...resto] = argv;
  const g = (k, d) => { const i = resto.indexOf(k); return i >= 0 ? resto[i + 1] : d; };
  return {
    modo, release: resto.includes('--release'), pid: Number(g('--pid', 0)), segundos: Number(g('--segundos', 60)),
    escenarios: g('--escenarios', 'reposo,1,2').split(',').filter(k => k in ESCENARIOS),
    salida: path.resolve(g('--salida', path.join(aquí, 'reportes'))),
  };
}

async function main() {
  const o = leerArgs(process.argv.slice(2));
  if (!['pipeline', 'app'].includes(o.modo)) {
    console.error('Uso: medir-anpr.mjs pipeline [--release] [--escenarios reposo,1,2] | app --pid <PID> [--segundos 60]');
    process.exit(2);
  }
  if (o.modo === 'app' && !o.pid) { console.error('Falta --pid <PID de securegate-garita>.'); process.exit(2); }
  const rep = o.modo === 'pipeline' ? await modoPipeline(o) : await modoApp(o);
  const md = o.modo === 'pipeline' ? reporteMarkdown(rep) : reporteApp(rep);
  mkdirSync(o.salida, { recursive: true });
  const sello = rep.equipo.fecha.replace(/[:.]/g, '-').slice(0, 19);
  writeFileSync(path.join(o.salida, `anpr-${sello}.json`), JSON.stringify(rep, null, 2));
  writeFileSync(path.join(o.salida, `anpr-${sello}.md`), md);
  console.log(`\n${md}\nReporte: ${path.join(o.salida, `anpr-${sello}.md`)}`);
  process.exit(rep.escenarios.every(e => e.ok !== false) ? 0 : 1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(e => { console.error(e); process.exit(1); });
}
