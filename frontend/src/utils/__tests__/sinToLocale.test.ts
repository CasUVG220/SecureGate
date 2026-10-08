import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * H06 (SCRUM-113): las fechas y horas se formatean SOLO con `utils/fecha.ts` (zona America/Guatemala, mes
 * escrito). Las ~32 llamadas sueltas a `toLocale*String('es-GT')` mostraban la hora según la zona del navegador
 * y en formatos distintos. Esta prueba falla si alguien vuelve a escribir una, o vuelve a calcular «hoy» con
 * `toISOString().slice(0, 10)` (que da el día de UTC: en Guatemala, desde las 6 pm ya es «mañana»).
 *
 * Los números se formatean con `fmtNumero`/`fmtQuetzales` (charts/format.ts), no con `toLocaleString`.
 */
const SRC = path.resolve(__dirname, '../..');
const PROHIBIDOS = new Set(['toLocaleDateString', 'toLocaleTimeString', 'toLocaleString']);

const archivos = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === '__tests__' || e.name === 'node_modules' ? [] : archivos(p);
    return /\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [p] : [];
  });

const hallazgos = (archivo: string): string[] => {
  const texto = readFileSync(archivo, 'utf8');
  const sf = ts.createSourceFile(archivo, texto, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const rel = path.relative(SRC, archivo);
  const out: string[] = [];
  const visitar = (n: ts.Node) => {
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)) {
      const nombre = n.expression.name.text;
      const linea = sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
      if (PROHIBIDOS.has(nombre)) out.push(`${rel}:${linea}  .${nombre}() — usa utils/fecha.ts`);
      // new Date().toISOString().slice(0, 10)  →  hoyEnZona()
      if (nombre === 'slice' && ts.isCallExpression(n.expression.expression)
        && ts.isPropertyAccessExpression(n.expression.expression.expression)
        && n.expression.expression.expression.name.text === 'toISOString'
        && n.arguments.length === 2 && n.arguments[0].getText() === '0' && n.arguments[1].getText() === '10') {
        const base = n.expression.expression.expression.expression.getText(sf);
        if (/^new Date\(\s*\)$/.test(base)) out.push(`${rel}:${linea}  new Date().toISOString().slice(0, 10) — usa hoyEnZona()`);
      }
    }
    ts.forEachChild(n, visitar);
  };
  visitar(sf);
  return out;
};

describe('fechas: un solo formateador', () => {
  it('ninguna pantalla ni componente llama a toLocale*String ni calcula «hoy» en UTC', () => {
    const todos = archivos(SRC).flatMap(hallazgos);
    expect(todos).toEqual([]);
  });

  it('el recorrido ve el código (si no, la prueba anterior no prueba nada)', () => {
    expect(archivos(SRC).length).toBeGreaterThan(80);
    expect(readFileSync(path.join(SRC, 'utils/fecha.ts'), 'utf8')).toContain('America/Guatemala');
  });
});
