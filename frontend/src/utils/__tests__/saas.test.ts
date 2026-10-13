import { describe, expect, it } from 'vitest';
import { fmtCentavos, nombreDelMes, porcentajeUsado, TONO_FACTURA, TONO_SUSCRIPCION } from '../saas';

describe('fmtCentavos', () => {
  it('quetzal pegado a la cifra y siempre dos decimales (docs/glosario.md)', () => {
    expect(fmtCentavos(25000, 'es')).toBe('Q250.00');
    expect(fmtCentavos(85000, 'en')).toBe('Q850.00');
    expect(fmtCentavos(5, 'es')).toBe('Q0.05');
    expect(fmtCentavos(0, 'es')).toBe('Q0.00');
  });
  it('separa los miles y no pierde un centavo en cifras grandes', () => {
    expect(fmtCentavos(123456, 'es')).toBe('Q1,234.56');
    expect(fmtCentavos(100_000_000, 'es')).toBe('Q1,000,000.00');
    expect(fmtCentavos(99_999_999_99, 'en')).toBe('Q99,999,999.99');
  });
  it('negativos con el signo antes del quetzal', () => { expect(fmtCentavos(-250, 'es')).toBe('-Q2.50'); });
});

describe('porcentajeUsado', () => {
  it('redondea y se acota a 100 (el excedente se dice con texto, no con una barra desbordada)', () => {
    expect(porcentajeUsado(0, 500)).toBe(0);
    expect(porcentajeUsado(250, 500)).toBe(50);
    expect(porcentajeUsado(333, 500)).toBe(67);
    expect(porcentajeUsado(500, 500)).toBe(100);
    expect(porcentajeUsado(900, 500)).toBe(100);
  });
  it('sin tope incluido o con cero incluidas no divide entre cero', () => {
    expect(porcentajeUsado(10, null)).toBe(0);
    expect(porcentajeUsado(10, 0)).toBe(0);
  });
});

describe('nombreDelMes', () => {
  it('en el idioma elegido y sin correrse de mes por la zona horaria', () => {
    expect(nombreDelMes('2026-09', 'es').toLowerCase()).toContain('septiembre');
    expect(nombreDelMes('2026-09', 'es')).toContain('2026');
    expect(nombreDelMes('2026-10', 'en')).toBe('October 2026');
    expect(nombreDelMes('2027-01', 'en')).toBe('January 2027');
  });
});

describe('tonos', () => {
  it('cada estado tiene un color y las vencidas son rojas', () => {
    expect(TONO_FACTURA.vencida).toBe('danger');
    expect(TONO_FACTURA.pagada).toBe('success');
    expect(TONO_SUSCRIPCION.prueba).toBe('info');
    expect(Object.keys(TONO_FACTURA).sort()).toEqual(['anulada', 'pagada', 'pendiente', 'vencida']);
    expect(Object.keys(TONO_SUSCRIPCION).sort()).toEqual(['activa', 'cancelada', 'prueba', 'vencida']);
  });
});
