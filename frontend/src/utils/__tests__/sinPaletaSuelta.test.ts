import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * H12 (SCRUM-115) «paleta uniforme»: los colores se piden por su NOMBRE DE TOKEN (brand, success, warning, danger, gray),
 * no por los nombres heredados de otra paleta (blue, emerald, amber, red…). `tailwind.config.ts` los mantiene como alias para
 * que el código antiguo no se rompa, pero cada pantalla que escribía `text-red-300` o `bg-emerald-500` elegía un tono por su
 * cuenta y la paleta se iba separando. Esta prueba falla si vuelve a aparecer un nombre heredado en un componente o pantalla.
 */
const SRC = path.resolve(__dirname, '../..');
const HEREDADOS = 'blue|teal|cyan|indigo|purple|green|emerald|amber|yellow|red|rose|slate|zinc';
const PREFIJOS = 'bg|text|border|ring|from|to|via|fill|stroke|divide|outline|placeholder|shadow|accent|decoration|caret';
const CLASE_HEREDADA = new RegExp(`\\b(?:${PREFIJOS})-(?:${HEREDADOS})-\\d{2,3}\\b`, 'g');

const archivos = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === '__tests__' || e.name === 'node_modules' ? [] : archivos(p);
    return /\.tsx$/.test(e.name) && !/\.test\.tsx$/.test(e.name) ? [p] : [];
  });

describe('paleta: nombres de token, no de otra paleta', () => {
  it('ningún componente ni pantalla usa blue-/emerald-/amber-/red-… (usa brand-/success-/warning-/danger-/gray-)', () => {
    const hallazgos = archivos(SRC).flatMap(f =>
      readFileSync(f, 'utf8').split('\n').flatMap((linea, i) =>
        [...linea.matchAll(CLASE_HEREDADA)].map(m => `${path.relative(SRC, f)}:${i + 1}  ${m[0]}`)));
    expect(hallazgos).toEqual([]);
  });

  it('el recorrido ve el código', () => {
    expect(archivos(SRC).length).toBeGreaterThan(60);
  });
});
