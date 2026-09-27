import { describe, expect, it } from 'vitest';
import { MAX_DIAS, diasEntre, rangoDePreset, validarRango } from '../periodos';

// Miércoles 24 de septiembre de 2026, a media tarde (hora local).
const HOY = new Date(2026, 8, 24, 15, 30);

describe('rangoDePreset', () => {
  it.each([
    ['7d', '2026-09-18', 7],
    ['30d', '2026-08-26', 30],
    ['90d', '2026-06-27', 90],
    ['mes', '2026-09-01', 24],
    ['anio', '2026-01-01', 267],
  ] as const)('%s termina hoy e incluye %s', (preset, desde, dias) => {
    const r = rangoDePreset(preset, HOY);
    expect(r).toEqual({ desde, hasta: '2026-09-24' });
    expect(diasEntre(r)).toBe(dias);
  });

  it('"este año" el 31 de diciembre de un año bisiesto sigue dentro del máximo', () => {
    expect(diasEntre(rangoDePreset('anio', new Date(2028, 11, 31)))).toBe(MAX_DIAS);
  });
});

describe('validarRango', () => {
  it('detecta fechas faltantes, invertidas o un rango demasiado largo', () => {
    expect(validarRango({ desde: '', hasta: '2026-09-01' })).toBe('faltan');
    expect(validarRango({ desde: '2026-09-02', hasta: '2026-09-01' })).toBe('orden');
    expect(validarRango({ desde: '2025-01-01', hasta: '2026-09-01' })).toBe('largo');
    expect(validarRango({ desde: '2026-09-01', hasta: '2026-09-01' })).toBeNull();
  });
});
