import { describe, expect, it } from 'vitest';

/**
 * OCR 100 % local (Sprint 10, docs/glosario.md): ningún texto de la app de escritorio vuelve a decir que el DPI se lee en
 * un servicio remoto o que necesita internet. Revisa el código fuente (sin las pruebas), donde viven los textos.
 */
const fuentes = import.meta.glob(['../../**/*.ts', '../../**/*.tsx', '!../../**/__tests__/**'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

describe('textos del OCR del DPI', () => {
  it('la revisión recorre el código de la app (no una carpeta vacía)', () => {
    expect(Object.keys(fuentes)).toEqual(expect.arrayContaining(['../../components/garita/CameraPane.tsx', '../dpi.ts']));
  });

  it.each([
    ['OCR remoto', /ocr remoto/i],
    ['servicio en la nube', /en la nube/i],
    ['el DPI requiere internet', /(requiere|necesita) (internet|conexi[oó]n)[^.'"`]*\bDPI\b|\bDPI\b[^.'"`]*(requiere|necesita) (internet|conexi[oó]n)/i],
    ['OCR de Google', /google|cloud vision/i],
  ] as const)('ningún texto dice «%s»', (regla, patron) => {
    const infracciones = Object.entries(fuentes).flatMap(([f, codigo]) =>
      codigo.split('\n').flatMap((linea, i) => (patron.test(linea) ? [`${f}:${i + 1}`] : [])));
    expect(infracciones, regla).toEqual([]);
  });
});
