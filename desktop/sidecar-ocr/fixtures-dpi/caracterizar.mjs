#!/usr/bin/env node
/**
 * Graba la CARACTERIZACIÓN del camino local del DPI (Sprint 10, OCR 100 % local, tarea 1): con DPI sintéticos (FICTICIOS,
 * de `generar.mjs`) guarda lo que hoy lee el OCR local y lo que hoy extraen las reglas del DPI, para que una prueba fije ese
 * comportamiento mientras se retira el OCR remoto. Ver docs/ocr_local_decision.md.
 *
 *   cd desktop/sidecar-ocr
 *   node fixtures-dpi/caracterizar.mjs            # 12 DPI, semilla 2026 → fixtures-dpi/caracterizacion.json
 *
 * Qué guarda, por documento: la verdad de terreno (inventada), las líneas del OCR (`items`: texto, confianza y caja) y lo que
 * `extraerDpi` devuelve con ellas (CUI, nombres, apellidos, validez, revisión y motivos). Además, el resumen de punta a punta
 * con `reconocerDpi` (enderezado + OCR + reglas): cuántos CUI salieron exactos, cuántos fueron a revisión y cuántos errores
 * silenciosos hubo. Solo se vuelve a grabar si un cambio de las reglas es INTENCIONAL (y se explica en el commit).
 *
 * Necesita los modelos (`node scripts/fetch-models.mjs`). Las imágenes van a una carpeta temporal y se borran.
 */
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(AQUI, '..', 'package.json'));
const sc = require('./src/server.js');
const { extraerDpi } = require('./src/dpi.js');

export const SEMILLA = 2026;
export const N = 12;
const SALIDA = path.join(AQUI, 'caracterizacion.json');

/** Lo que se fija de la extracción (sin tiempos: dependen del equipo). */
export const camposFijados = (r) => ({
  cui: r.cui, cui_valido: r.cui_valido, nombres: r.nombres, apellidos: r.apellidos,
  revision_obligatoria: r.revision_obligatoria, motivos: r.motivos, correcciones: r.correcciones.length,
});

/** Genera los DPI sintéticos en una carpeta temporal; devuelve la carpeta y las filas de la verdad de terreno. */
export function generarConjunto(semilla = SEMILLA, n = N) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'dpi-caract-'));
  execFileSync(process.execPath, [path.join(AQUI, 'generar.mjs'), '--out', dir, '--n', String(n), '--seed', String(semilla)], { stdio: 'pipe' });
  const [cab, ...filas] = readFileSync(path.join(dir, 'verdad_terreno.csv'), 'utf8').trim().split('\n');
  const cols = cab.split(',');
  return { dir, filas: filas.map(l => Object.fromEntries(l.split(',').map((v, i) => [cols[i], v]))) };
}

/** Resumen de punta a punta: CUI exactos, revisiones y errores silenciosos (CUI mal SIN marcar para revisión). */
export function resumir(pares) {
  let exactos = 0, revision = 0, silenciosos = 0;
  for (const { verdad, r } of pares) {
    const ok = r.cui === verdad.cui;
    if (ok) exactos++;
    if (r.revision_obligatoria) revision++;
    if (!ok && r.cui && !r.revision_obligatoria) silenciosos++;
  }
  return { documentos: pares.length, cui_exactos: exactos, a_revision: revision, errores_silenciosos: silenciosos };
}

async function main() {
  const { dir, filas } = generarConjunto();
  const service = sc.createService(sc.resolveModels(path.join(AQUI, '..', 'models')));
  await service.initialize();
  try {
    const casos = [];
    const pares = [];
    for (const v of filas) {
      const b64 = readFileSync(path.join(dir, v.archivo)).toString('base64');
      const ocr = await sc.recognize(service, b64, { spaceRecovery: false });
      const items = ocr.items.map(i => ({ texto: i.texto, confianza: i.confianza, box: i.box }));
      casos.push({
        archivo: v.archivo,
        verdad: { cui: v.cui, nombres: v.nombres, apellidos: v.apellidos, variante: v.variante },
        items,
        esperado: camposFijados(extraerDpi(items)),
      });
      pares.push({ verdad: v, r: await sc.reconocerDpi(service, b64) });
    }
    writeFileSync(SALIDA, JSON.stringify({
      descripcion: 'Caracterización del camino LOCAL del DPI: DPI sintéticos (ficticios), líneas del OCR local y lo que hoy extraen las reglas. Ver docs/ocr_local_decision.md.',
      semilla: SEMILLA,
      documentos: N,
      grabado: new Date().toISOString().slice(0, 10),
      punta_a_punta: resumir(pares),
      casos,
    }, null, 1) + '\n');
    process.stdout.write(`✓ ${SALIDA}\n${JSON.stringify(resumir(pares))}\n`);
  } finally {
    await service.destroy();
    rmSync(dir, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { process.stderr.write(`${e.stack ?? e}\n`); process.exit(1); });
}
