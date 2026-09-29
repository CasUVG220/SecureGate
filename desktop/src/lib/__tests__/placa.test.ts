/**
 * La placa reconocida se acepta sólo si tiene la forma legal y ninguna
 * corrección; todo lo demás obliga a revisión manual. Un falso "válida" aquí
 * registra un vehículo equivocado sin que el agente lo vea.
 */
import { describe, expect, it } from 'vitest';
import { candidatosDe, esValida, formatear, mejorCandidato, normalizar } from '../placa';

describe('normalizar / formatear / esValida', () => {
  it('quita separadores y pone mayúsculas', () => {
    expect(normalizar(' p-123 abc ')).toBe('P123ABC');
    expect(formatear('p123abc')).toBe('P-123ABC');
    expect(formatear('cd 004abc')).toBe('CD-004ABC');
  });

  it('valida el formato prefijo + 3 dígitos + 3 letras', () => {
    expect(esValida('P123ABC')).toBe(true);
    expect(esValida('TRC-999ZZZ')).toBe(true);
    expect(esValida('P12ABC')).toBe(false);
    expect(esValida('1234ABC')).toBe(false);
    expect(esValida('P123AB')).toBe(false);
    expect(esValida('')).toBe(false);
  });
});

describe('candidatosDe', () => {
  it('una lectura limpia con prefijo conocido no requiere revisión', () => {
    const [c] = candidatosDe('P123ABC', 0.95);
    expect(c.placa).toBe('P123ABC');
    expect(c.correcciones).toBe(0);
    expect(c.prefijoConocido).toBe(true);
    expect(c.requiereRevision).toBe(false);
  });

  it('corrige confusiones por posición y lo marca para revisión', () => {
    // O en posición de dígito → 0; 8 en posición de letra → B
    const cands = candidatosDe('POO4A8C', 0.95);
    const c = cands.find(x => x.placa === 'P004ABC');
    expect(c).toBeDefined();
    expect(c!.correcciones).toBe(3);
    expect(c!.requiereRevision).toBe(true);
  });

  it('confianza baja obliga a revisión aunque el texto sea perfecto', () => {
    const [c] = candidatosDe('P123ABC', 0.6);
    expect(c.valida).toBe(true);
    expect(c.requiereRevision).toBe(true);
  });

  it('prefijo desconocido se acepta como forma válida pero pide revisión', () => {
    const [c] = candidatosDe('X123ABC', 0.99);
    expect(c.valida).toBe(true);
    expect(c.prefijoConocido).toBe(false);
    expect(c.requiereRevision).toBe(true);
  });
});

describe('mejorCandidato', () => {
  it('une cajas partidas por el detector ("P" + "123ABC")', () => {
    const c = mejorCandidato([
      { texto: 'GUATEMALA', confianza: 0.99 },
      { texto: 'P', confianza: 0.9 },
      { texto: '123ABC', confianza: 0.9 },
    ]);
    expect(c.placa).toBe('P123ABC');
    expect(c.requiereRevision).toBe(false);
  });

  it('prefiere la lectura literal con prefijo conocido sobre una corregida', () => {
    const c = mejorCandidato([{ texto: 'C 458DFG', confianza: 0.97 }]);
    expect(c.placa).toBe('C458DFG');
    expect(c.correcciones).toBe(0);
  });

  it('ignora "GUATEMALA" y ruido alrededor de la placa', () => {
    const c = mejorCandidato([
      { texto: 'GUATEMALA', confianza: 1 },
      { texto: 'M771KLM', confianza: 0.93 },
      { texto: '', confianza: 0.5 },
    ]);
    expect(c.placa).toBe('M771KLM');
  });

  it('sin forma de placa devuelve el crudo más largo como inválido para editar a mano', () => {
    const c = mejorCandidato([{ texto: 'GUATEMALA', confianza: 1 }, { texto: '12', confianza: 0.4 }]);
    expect(c.valida).toBe(false);
    expect(c.placa).toBe('GUATEMALA');
    expect(c.requiereRevision).toBe(true);
  });

  it('sin fragmentos devuelve vacío e inválido', () => {
    const c = mejorCandidato([]);
    expect(c.placa).toBe('');
    expect(c.valida).toBe(false);
  });
});
