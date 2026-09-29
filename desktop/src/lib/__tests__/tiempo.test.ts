import { describe, expect, it } from 'vitest';
import { haceCuanto, horasATexto } from '../tiempo';

describe('haceCuanto', () => {
  const ahora = new Date('2026-09-19T12:00:00Z');
  const hace = (seg: number) => new Date(ahora.getTime() - seg * 1000).toISOString();

  it('cubre los tramos que muestra la tira de estado', () => {
    expect(haceCuanto(null, ahora)).toBe('nunca');
    expect(haceCuanto('basura', ahora)).toBe('nunca');
    expect(haceCuanto(hace(10), ahora)).toBe('hace un momento');
    expect(haceCuanto(hace(3 * 60), ahora)).toBe('hace 3 min');
    expect(haceCuanto(hace(90 * 60), ahora)).toBe('hace 1 h 30 min');
    expect(haceCuanto(hace(2 * 3600), ahora)).toBe('hace 2 h');
    expect(haceCuanto(hace(49 * 3600), ahora)).toBe('hace 2 días');
  });

  it('un timestamp en el futuro (reloj movido) no da negativos', () => {
    expect(haceCuanto(hace(-500), ahora)).toBe('hace un momento');
  });
});

describe('horasATexto', () => {
  it('formatea horas decimales', () => {
    expect(horasATexto(0.5)).toBe('30 min');
    expect(horasATexto(2)).toBe('2 h');
    expect(horasATexto(47.9)).toBe('47 h 54 min');
  });
});
