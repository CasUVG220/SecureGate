import { describe, expect, it } from 'vitest';
import {
  CASETAS, HOGARES, PAQUETES, PAQUETE_DESTACADO, PLANES, TRAMOS, casetasDe, esTramo, etiquetaTramo, formatoQ, precioDe, rangoMensualidad,
} from '../planes';

// Intl separa la Q del número con un espacio (normal o de no separación, según la versión de ICU): se acepta cualquiera.
const q = (texto: string) => new RegExp(`^Q\\s?${texto.replace(/[.,]/g, m => `\\${m}`)}$`);

describe('planes · datos', () => {
  it('cada paquete tiene un par [primer pago, mensualidad] por tramo publicado', () => {
    for (const p of PAQUETES) {
      expect(PLANES[p]).toHaveLength(HOGARES.length);
      for (const [primer, mensual] of PLANES[p]) {
        expect(Number.isInteger(primer) && primer > 0).toBe(true);
        expect(Number.isInteger(mensual) && mensual > 0).toBe(true);
      }
    }
    expect(CASETAS).toHaveLength(HOGARES.length);
  });

  it('la mensualidad crece con el número de hogares en los tres paquetes', () => {
    for (const p of PAQUETES) {
      const mensual = PLANES[p].map(([, m]) => m);
      expect([...mensual].sort((a, b) => a - b)).toEqual(mensual);
    }
  });

  it('ningún paquete viene marcado como «el más pedido» sin confirmación', () => {
    expect(PAQUETE_DESTACADO).toBeNull();
  });
});

describe('planes · formato de moneda (es-GT, GTQ)', () => {
  it('quetzales con separador de miles y dos decimales', () => {
    expect(formatoQ(44078)).toMatch(q('44,078.00'));
    expect(formatoQ(896)).toMatch(q('896.00'));
    expect(formatoQ(213668)).toMatch(q('213,668.00'));
  });

  it('etiquetas de tramo', () => {
    expect(etiquetaTramo(1000)).toBe('1,000');
    expect(etiquetaTramo(50)).toBe('50');
    expect(etiquetaTramo('1000+')).toBe('Más de 1,000');
  });
});

describe('planes · consulta por tramo', () => {
  it('devuelve el par del tramo', () => {
    expect(precioDe('compra', 200)).toEqual({ primerPago: 86475, mensualidad: 3472 });
    expect(precioDe('alquiler', 50)).toEqual({ primerPago: 7840, mensualidad: 2576 });
    expect(precioDe('licencia', 1000)).toEqual({ primerPago: 7280, mensualidad: 6720 });
    expect(casetasDe(500)).toBe(3);
  });

  it('más de 1,000 hogares NO da monto ni casetas (cotización a medida)', () => {
    for (const p of PAQUETES) expect(precioDe(p, '1000+')).toBeNull();
    expect(casetasDe('1000+')).toBeNull();
    expect(TRAMOS.at(-1)).toBe('1000+');
  });

  it('reconoce los tramos válidos y rechaza el resto', () => {
    for (const t of ['50', '100', '200', '500', '1000', '1000+', 1000]) expect(esTramo(t)).toBe(true);
    for (const t of ['75', '2000', '', null, undefined, '1000 ']) expect(esTramo(t)).toBe(false);
  });

  it('rango de mensualidades publicado', () => {
    expect(rangoMensualidad()).toEqual({ minima: 896, maxima: 15120 });
  });
});
