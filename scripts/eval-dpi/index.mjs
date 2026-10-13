#!/usr/bin/env node
/**
 * Evaluador del OCR de DPI (T3, SCRUM-121).
 *
 *   node scripts/eval-dpi/index.mjs --dir <carpeta> [--csv <verdad_terreno.csv>] [--motor local|vision|ambos]
 *                                   [--out scripts/eval-dpi/reportes] [--limite N]
 *                                   [--backend http://localhost:3000 --token <JWT de un agente>]
 *
 * La carpeta trae las imágenes y un `verdad_terreno.csv` con columnas `archivo,cui,nombres,apellidos[,variante]`
 * (las demás se ignoran). El conjunto sintético sale de `desktop/sidecar-ocr/fixtures-dpi/generar.mjs`; el REAL lo arma
 * el equipo con consentimiento (docs/ocr_dpi_local.md). Este script no busca ni descarga DPI de ninguna parte.
 *
 * Motores:
 *   local   El extractor del sidecar (desktop/sidecar-ocr), en este mismo proceso. Hoy no hay red de por medio.
 *   vision  Google Vision a través del backend (POST /api/ocr/dpi, el camino real de producción: cuesta por llamada y
 *           necesita --backend y --token). Vision devuelve `nombre` (nombres + apellidos juntos): por campo solo se puede
 *           comparar el CUI y el nombre completo.
 *   ambos   Los dos, con la tabla comparativa al final.
 *
 * Reporta: exactitud del CUI, exactitud por campo, tasa de revisión manual, errores SILENCIOSOS (CUI mal y sin marcar
 * para revisión: lo peligroso) y tiempo por captura (p50 y p95). Escribe `.json` y `.md` en --out.
 *
 * Los nombres se comparan en mayúsculas, sin acentos y con espacios colapsados: el modelo de reconocimiento es del alfabeto
 * latino básico y no produce Ñ ni vocales con tilde; la comparación estricta (con tildes) se informa aparte.
 */
import { createRequire } from 'node:module';
import { readFileSync, readdirSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const aquí = path.dirname(fileURLToPath(import.meta.url));
const raíz = path.resolve(aquí, '..', '..');
const sidecarDir = path.join(raíz, 'desktop', 'sidecar-ocr');
const require = createRequire(import.meta.url);

// ── utilidades ───────────────────────────────────────────────────────────────────────────────────────────
export const normalizar = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
export const estricto = (s) => String(s ?? '').toUpperCase().replace(/\s+/g, ' ').trim();
export const soloDigitos = (s) => String(s ?? '').replace(/\D/g, '');

/** Percentil por rango más cercano (p entre 0 y 100). Vacío → null. */
export function percentil(valores, p) {
  if (!valores.length) return null;
  const v = [...valores].sort((a, b) => a - b);
  return v[Math.min(v.length - 1, Math.max(0, Math.ceil((p / 100) * v.length) - 1))];
}

/** CSV simple (sin comillas ni comas dentro de los campos: los datos de prueba no las llevan). */
export function leerCsv(texto) {
  const [cab, ...filas] = texto.replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim());
  const cols = cab.split(',').map(c => c.trim());
  return filas.map(l => Object.fromEntries(l.split(',').map((v, i) => [cols[i], v.trim()])));
}

// ── argumentos ───────────────────────────────────────────────────────────────────────────────────────────
function leerArgs(argv) {
  const get = (f, d) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : d; };
  return {
    dir: get('--dir'), csv: get('--csv'), motor: get('--motor', 'local'),
    out: path.resolve(get('--out', path.join(aquí, 'reportes'))),
    limite: Number(get('--limite', 0)) || 0,
    backend: get('--backend', process.env.EVAL_DPI_BACKEND), token: get('--token', process.env.EVAL_DPI_TOKEN),
  };
}

// ── motores ──────────────────────────────────────────────────────────────────────────────────────────────
/**
 * Un motor es `{ nombre, iniciar(), extraer(buffer) → { cui, nombres, apellidos, nombre_completo, requiere_revision, ms_inferencia?, nota? }, cerrar() }`.
 * `requiere_revision` null = el motor no lo informa.
 */
async function motorLocal() {
  const sc = require(path.join(sidecarDir, 'src', 'server.js'));
  let service;
  const tieneExtractor = typeof sc.reconocerDpi === 'function';
  return {
    nombre: 'local',
    extractor: tieneExtractor ? 'sidecar-ocr · reconocerDpi' : 'ninguno: el sidecar aún no extrae DPI (solo texto crudo)',
    async iniciar() {
      service = sc.createService(sc.resolveModels(path.join(sidecarDir, 'models')));
      await service.initialize();
      // Una pasada de calentamiento: la primera inferencia paga la inicialización de ONNX Runtime y no es lo que ve el agente.
      const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
      await sc.recognize(service, png.toString('base64')).catch(() => {});
    },
    async extraer(buffer) {
      const b64 = buffer.toString('base64');
      if (tieneExtractor) return sc.reconocerDpi(service, b64);
      const r = await sc.recognize(service, b64);
      return { cui: '', nombres: '', apellidos: '', nombre_completo: '', requiere_revision: true, ms_inferencia: r.ms_inferencia, nota: 'sin extractor de DPI' };
    },
    async cerrar() { await service?.destroy().catch(() => {}); },
  };
}

function motorVision({ backend, token }) {
  if (!backend || !token) throw new Error('El motor «vision» necesita --backend y --token (o EVAL_DPI_BACKEND y EVAL_DPI_TOKEN). Cada imagen cuesta una llamada a Google Vision.');
  return {
    nombre: 'vision',
    extractor: `POST ${backend}/api/ocr/dpi (Google Vision, parser del backend)`,
    async iniciar() {},
    async extraer(buffer) {
      const res = await fetch(`${backend.replace(/\/$/, '')}/api/ocr/dpi`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ image: buffer.toString('base64') }),
      });
      const cuerpo = await res.json().catch(() => ({}));
      if (!res.ok) return { cui: '', nombres: null, apellidos: null, nombre_completo: '', requiere_revision: null, nota: `HTTP ${res.status}: ${cuerpo.error ?? ''}` };
      return { cui: soloDigitos(cuerpo.numero_dpi), nombres: null, apellidos: null, nombre_completo: cuerpo.nombre ?? '', requiere_revision: null };
    },
    async cerrar() {},
  };
}

// ── evaluación ───────────────────────────────────────────────────────────────────────────────────────────
export async function evaluar(motor, filas, carpeta, alProgresar = () => {}) {
  await motor.iniciar();
  const detalle = [];
  for (const f of filas) {
    const ruta = path.join(carpeta, f.archivo);
    if (!existsSync(ruta)) { detalle.push({ archivo: f.archivo, error: 'imagen no encontrada' }); continue; }
    const buf = readFileSync(ruta);
    const t0 = performance.now();
    let r, error = null;
    try { r = await motor.extraer(buf); } catch (e) { error = String(e?.message ?? e); r = { cui: '', nombres: '', apellidos: '', nombre_completo: '', requiere_revision: null }; }
    const ms = performance.now() - t0;
    const verdadCompleto = `${f.nombres} ${f.apellidos}`;
    const cuiOk = soloDigitos(r.cui) === soloDigitos(f.cui) && soloDigitos(f.cui).length === 13;
    detalle.push({
      archivo: f.archivo, variante: f.variante ?? 'n/d', error,
      cui_ok: cuiOk,
      nombres_ok: r.nombres == null ? null : normalizar(r.nombres) === normalizar(f.nombres),
      apellidos_ok: r.apellidos == null ? null : normalizar(r.apellidos) === normalizar(f.apellidos),
      nombre_completo_ok: normalizar(r.nombre_completo || `${r.nombres ?? ''} ${r.apellidos ?? ''}`) === normalizar(verdadCompleto),
      nombres_estricto: r.nombres == null ? null : estricto(r.nombres) === estricto(f.nombres),
      apellidos_estricto: r.apellidos == null ? null : estricto(r.apellidos) === estricto(f.apellidos),
      requiere_revision: r.requiere_revision ?? null,
      ms: Math.round(ms), ms_inferencia: r.ms_inferencia ?? null, nota: r.nota ?? null,
    });
    alProgresar(detalle.length, filas.length);
  }
  await motor.cerrar();
  return { motor: motor.nombre, extractor: motor.extractor, detalle, resumen: resumir(detalle) };
}

const pct = (n, d) => (d ? Number(((100 * n) / d).toFixed(1)) : null);

export function resumir(detalle) {
  const ok = detalle.filter(d => !d.error || d.error !== 'imagen no encontrada');
  const n = ok.length;
  const cuenta = (campo) => { const v = ok.filter(d => d[campo] !== null && d[campo] !== undefined); return { n: v.length, aciertos: v.filter(d => d[campo]).length, pct: pct(v.filter(d => d[campo]).length, v.length) }; };
  const conRev = ok.filter(d => d.requiere_revision !== null);
  const revision = conRev.length ? {
    informada: true, n: conRev.length, marcadas: conRev.filter(d => d.requiere_revision).length,
    tasa_pct: pct(conRev.filter(d => d.requiere_revision).length, conRev.length),
    // Lo peligroso: el CUI salió mal y nadie lo marcó para revisión.
    errores_silenciosos: conRev.filter(d => !d.cui_ok && !d.requiere_revision).length,
    errores_silenciosos_pct: pct(conRev.filter(d => !d.cui_ok && !d.requiere_revision).length, conRev.length),
    revisiones_innecesarias: conRev.filter(d => d.cui_ok && d.requiere_revision).length,
  } : { informada: false, nota: 'El motor no informa revisión: la pantalla siempre muestra los campos para confirmar.' };
  const porVariante = {};
  for (const d of ok) { const v = (porVariante[d.variante] ??= { n: 0, cui_ok: 0 }); v.n++; if (d.cui_ok) v.cui_ok++; }
  for (const v of Object.values(porVariante)) v.cui_pct = pct(v.cui_ok, v.n);
  const ms = ok.map(d => d.ms);
  const msInf = ok.map(d => d.ms_inferencia).filter(x => x != null);
  return {
    n, errores: detalle.filter(d => d.error).length,
    cui: cuenta('cui_ok'), nombres: cuenta('nombres_ok'), apellidos: cuenta('apellidos_ok'), nombre_completo: cuenta('nombre_completo_ok'),
    nombres_estricto: cuenta('nombres_estricto'), apellidos_estricto: cuenta('apellidos_estricto'),
    revision, por_variante: porVariante,
    tiempo_ms: { p50: percentil(ms, 50), p95: percentil(ms, 95), max: ms.length ? Math.max(...ms) : null },
    inferencia_ms: msInf.length ? { p50: percentil(msInf, 50), p95: percentil(msInf, 95) } : null,
    meta_rnf03_5s: ms.length ? percentil(ms, 95) < 5000 : null,
  };
}

export function reporteMarkdown(resultados, meta) {
  const L = [];
  L.push(`# Evaluación del OCR de DPI`, '', `- Fecha: ${meta.fecha}`, `- Conjunto: \`${meta.dir}\` (${meta.n} imágenes)`, `- Origen: **${meta.origen}**`, '');
  if (meta.sintetico) L.push('> ⚠️ Conjunto SINTÉTICO (DPI ficticios). Sirve para regresiones y tiempos; **NO es evidencia de la precisión con DPI reales**. La decisión de corte se toma con el conjunto real.', '');
  const celda = (c) => (c && c.n ? `${c.pct} % (${c.aciertos}/${c.n})` : 'n/d');
  L.push('| Métrica | ' + resultados.map(r => r.motor).join(' | ') + ' |', '|---|' + resultados.map(() => '---').join('|') + '|');
  const fila = (nombre, f) => L.push(`| ${nombre} | ${resultados.map(r => f(r.resumen)).join(' | ')} |`);
  fila('Exactitud del CUI', s => celda(s.cui));
  fila('Exactitud de nombres (sin acentos)', s => celda(s.nombres));
  fila('Exactitud de apellidos (sin acentos)', s => celda(s.apellidos));
  fila('Exactitud del nombre completo (sin acentos)', s => celda(s.nombre_completo));
  fila('Nombres, comparación estricta (con tildes)', s => celda(s.nombres_estricto));
  fila('Apellidos, comparación estricta (con tildes)', s => celda(s.apellidos_estricto));
  fila('Tasa de revisión manual', s => (s.revision.informada ? `${s.revision.tasa_pct} % (${s.revision.marcadas}/${s.revision.n})` : 'n/d'));
  fila('Errores silenciosos (CUI mal y sin marcar)', s => (s.revision.informada ? `${s.revision.errores_silenciosos_pct} % (${s.revision.errores_silenciosos})` : 'n/d'));
  fila('Tiempo por captura p50 / p95', s => `${s.tiempo_ms.p50} / ${s.tiempo_ms.p95} ms`);
  fila('Meta RNF-03 (p95 < 5 s)', s => (s.meta_rnf03_5s === null ? 'n/d' : s.meta_rnf03_5s ? 'sí' : 'NO'));
  L.push('');
  for (const r of resultados) {
    L.push(`## ${r.motor}`, '', `Extractor: ${r.extractor}`, '', '| Variante | n | CUI exacto |', '|---|---|---|');
    for (const [v, x] of Object.entries(r.resumen.por_variante)) L.push(`| ${v} | ${x.n} | ${x.cui_pct} % |`);
    L.push('');
  }
  return L.join('\n');
}

// ── main ─────────────────────────────────────────────────────────────────────────────────────────────────
async function main() {
  const a = leerArgs(process.argv.slice(2));
  if (!a.dir) { console.error('Uso: node scripts/eval-dpi/index.mjs --dir <carpeta con imágenes y verdad_terreno.csv> [--motor local|vision|ambos]'); process.exit(2); }
  const carpeta = path.resolve(a.dir);
  const rutaCsv = a.csv ? path.resolve(a.csv) : path.join(carpeta, 'verdad_terreno.csv');
  if (!existsSync(rutaCsv)) { console.error(`No existe ${rutaCsv}. Genera el conjunto sintético con: node desktop/sidecar-ocr/fixtures-dpi/generar.mjs --out ${a.dir}`); process.exit(2); }
  let filas = leerCsv(readFileSync(rutaCsv, 'utf8'));
  if (a.limite) filas = filas.slice(0, a.limite);
  const motores = [];
  if (a.motor === 'local' || a.motor === 'ambos') motores.push(await motorLocal());
  if (a.motor === 'vision' || a.motor === 'ambos') motores.push(motorVision(a));
  if (!motores.length) { console.error('--motor debe ser local, vision o ambos'); process.exit(2); }

  const resultados = [];
  for (const m of motores) {
    process.stderr.write(`Motor ${m.nombre}: `);
    resultados.push(await evaluar(m, filas, carpeta, (i, n) => { if (i % 10 === 0 || i === n) process.stderr.write(`${i}/${n} `); }));
    process.stderr.write('\n');
  }
  const meta = {
    fecha: new Date().toISOString(), dir: path.relative(raíz, carpeta) || carpeta, n: filas.length,
    sintetico: /sint|fixtures-dpi/i.test(carpeta) || filas.every(f => /^img_\d+\.jpg$/.test(f.archivo)),
    origen: motores.map(m => m.nombre).join(' + '),
  };
  mkdirSync(a.out, { recursive: true });
  const sello = meta.fecha.replace(/[:.]/g, '-').slice(0, 19);
  // El detalle por imagen lleva solo nombres de archivo y aciertos: ningún dato personal ni imagen.
  writeFileSync(path.join(a.out, `eval-dpi-${sello}.json`), JSON.stringify({ meta, resultados }, null, 2));
  const md = reporteMarkdown(resultados, meta);
  writeFileSync(path.join(a.out, `eval-dpi-${sello}.md`), md);
  console.log(md);
  console.log(`\nReporte: ${path.join(a.out, `eval-dpi-${sello}.md`)}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(e => { console.error(e); process.exit(1); });
}
