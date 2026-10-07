import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * H12 (SCRUM-115): nada de cuadros del navegador. `window.confirm` / `prompt` / `alert` no llevan la marca ni el tema,
 * no se traducen, no se pueden probar y su botón «Aceptar» no dice qué va a pasar. Las confirmaciones usan
 * `useConfirmacion()` (components/ui) y lo que pide un dato usa un `Modal`.
 */
const SRC = path.resolve(__dirname, '../..');
const NATIVOS = new Set(['confirm', 'prompt', 'alert']);

const archivos = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === '__tests__' || e.name === 'node_modules' ? [] : archivos(p);
    return /\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [p] : [];
  });

const hallazgos = (archivo: string): string[] => {
  const sf = ts.createSourceFile(archivo, readFileSync(archivo, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const rel = path.relative(SRC, archivo);
  const out: string[] = [];
  const visitar = (n: ts.Node) => {
    if (ts.isCallExpression(n)) {
      const f = n.expression;
      const linea = sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
      // confirm(...) / prompt(...) / alert(...) sueltos
      if (ts.isIdentifier(f) && NATIVOS.has(f.text)) out.push(`${rel}:${linea}  ${f.text}() — usa useConfirmacion() o un Modal`);
      // window.confirm(...) / globalThis.prompt(...) / self.alert(...)
      if (ts.isPropertyAccessExpression(f) && NATIVOS.has(f.name.text) && ['window', 'globalThis', 'self'].includes(f.expression.getText(sf))) {
        out.push(`${rel}:${linea}  ${f.expression.getText(sf)}.${f.name.text}() — usa useConfirmacion() o un Modal`);
      }
    }
    ts.forEachChild(n, visitar);
  };
  visitar(sf);
  return out;
};

describe('diálogos nativos del navegador', () => {
  it('ninguna pantalla ni componente llama a confirm / prompt / alert', () => {
    expect(archivos(SRC).flatMap(hallazgos)).toEqual([]);
  });

  it('el recorrido ve el código y el sustituto existe', () => {
    expect(archivos(SRC).length).toBeGreaterThan(80);
    expect(readFileSync(path.join(SRC, 'components/ui/useConfirmacion.tsx'), 'utf8')).toContain('export function useConfirmacion');
  });
});
