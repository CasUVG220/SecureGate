import { describe, expect, it } from 'vitest';
import {
  cubeta, fmtDuracion, fmtFechaCorta, fmtQuetzales, fmtRango, indicesEtiquetas, marcasEje, variacion,
} from '../format';

describe('marcasEje', () => {
  it('marcas redondas que cubren el máximo', () => {
    expect(marcasEje(27)).toEqual({ marcas: [0, 10, 20, 30], tope: 30 });
    expect(marcasEje(3600)).toEqual({ marcas: [0, 1000, 2000, 3000, 4000], tope: 4000 });
  });

  it('nunca marcas fraccionarias en conteos chicos', () => {
    const { marcas } = marcasEje(3);
    expect(marcas.every(Number.isInteger)).toBe(true);
    expect(marcas.at(-1)).toBeGreaterThanOrEqual(3);
  });

  it('sin datos: un eje 0–1 en vez de dividir entre cero', () => {
    expect(marcasEje(0)).toEqual({ marcas: [0, 1], tope: 1 });
  });
});

describe('variacion', () => {
  it('sube, baja o se mantiene', () => {
    expect(variacion(125, 100)).toEqual({ pct: 0.25, dir: 'sube' });
    expect(variacion(80, 100)).toEqual({ pct: -0.2, dir: 'baja' });
    expect(variacion(100.2, 100)).toEqual({ pct: 0, dir: 'igual' });
  });

  it('sin base no inventa un porcentaje infinito', () => {
    expect(variacion(12, 0)).toEqual({ pct: null, dir: 'sube' });
    expect(variacion(0, 0)).toEqual({ pct: null, dir: 'igual' });
  });
});

describe('indicesEtiquetas', () => {
  it('rotula todos los días si caben', () => {
    expect(indicesEtiquetas(5, 600)).toEqual([0, 1, 2, 3, 4]);
  });

  it('con muchos días espacia las marcas y siempre rotula el último', () => {
    const idx = indicesEtiquetas(90, 300);
    expect(idx[0]).toBe(0);
    expect(idx.at(-1)).toBe(89);
    expect(idx.length).toBeLessThanOrEqual(Math.floor(300 / 72));
  });
});

describe('cubeta', () => {
  it('0 queda reservado para "sin movimiento" y el máximo cae en la última', () => {
    expect(cubeta(0, 10)).toBe(0);
    expect(cubeta(1, 10)).toBe(1);
    expect(cubeta(10, 10)).toBe(5);
    expect(cubeta(5, 0)).toBe(0);
  });
});

describe('formatos', () => {
  it('quetzales con símbolo fijo en los dos idiomas', () => {
    expect(fmtQuetzales(1234.5, 'es')).toBe('Q1,234.50');
    expect(fmtQuetzales(1200, 'en')).toBe('Q1,200');
    expect(fmtQuetzales(125_000, 'en', { compacto: true })).toBe('Q125K');
  });

  it('duración en minutos u horas', () => {
    expect(fmtDuracion(38)).toBe('38 min');
    expect(fmtDuracion(95)).toBe('1 h 35 min');
    expect(fmtDuracion(120)).toBe('2 h');
  });

  it('las fechas AAAA-MM-DD no se corren un día por la zona horaria', () => {
    expect(fmtFechaCorta('2026-09-01', 'en')).toBe('Sep 1');
    expect(fmtRango('2026-08-26', '2026-09-24', 'en')).toBe('Aug 26 – Sep 24, 2026');
    expect(fmtRango('2026-09-24', '2026-09-24', 'en')).toBe('Sep 24, 2026');
  });
});
