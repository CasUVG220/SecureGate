import { describe, expect, it } from 'vitest';
import { esPlacaGuatemalteca, formatearPlaca, normalizarPlaca, placaParaInput } from '../placa';

describe('placa', () => {
  it('normaliza a mayúsculas sin separadores', () => {
    expect(normalizarPlaca(' p-123 abc ')).toBe('P123ABC');
    expect(normalizarPlaca('cd 004.abc')).toBe('CD004ABC');
    expect(normalizarPlaca(null)).toBe('');
    expect(normalizarPlaca(undefined)).toBe('');
  });

  it('presenta con un guion tras el prefijo cuando tiene la forma guatemalteca', () => {
    expect(formatearPlaca('p123abc')).toBe('P-123ABC');
    expect(formatearPlaca('CD 004ABC')).toBe('CD-004ABC');
    expect(formatearPlaca('TRC999zzz')).toBe('TRC-999ZZZ');
    // formatos que no son guatemaltecos se dejan normalizados, sin inventar guiones
    expect(formatearPlaca('xyz-12')).toBe('XYZ12');
  });

  it('es idempotente: formatear y normalizar convergen', () => {
    for (const p of ['P123ABC', 'p-123abc', ' p 123 abc ']) {
      expect(normalizarPlaca(formatearPlaca(p))).toBe('P123ABC');
      expect(formatearPlaca(formatearPlaca(p))).toBe('P-123ABC');
    }
  });

  it('reconoce la forma legal', () => {
    expect(esPlacaGuatemalteca('P-123ABC')).toBe(true);
    expect(esPlacaGuatemalteca('1234ABC')).toBe(false);
    expect(esPlacaGuatemalteca('')).toBe(false);
  });

  it('placaParaInput nunca excede el largo permitido', () => {
    expect(placaParaInput('p123abc')).toBe('P-123ABC');
    expect(placaParaInput('x'.repeat(40)).length).toBeLessThanOrEqual(13);
  });
});
