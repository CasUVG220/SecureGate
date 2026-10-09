import { describe, expect, it } from 'vitest';
import { translations } from '../translations';
import { plural } from '../plural';

const t = (k: string, f?: string) => translations.es[k] ?? f ?? k;

describe('plural()', () => {
  it('usa la forma singular con 1 y la plural con cualquier otro número, incluido 0', () => {
    expect(plural(t, 'stats.kpi.ticketsOpen', 1)).toBe('1 sigue abierta');
    expect(plural(t, 'stats.kpi.ticketsOpen', 0)).toBe('0 siguen abiertas');
    expect(plural(t, 'stats.kpi.ticketsOpen', 7)).toBe('7 siguen abiertas');
    expect(plural(t, 'lic.summary.active', 1)).toBe('1 equipo activo');
    expect(plural(t, 'lic.summary.active', 2)).toBe('2 equipos activos');
    expect(plural(t, 'nav.badge.pendingReservations', 1)).toBe('1 reserva por aprobar');
  });

  it('el número ya formateado («1,200») no decide: manda la cuenta', () => {
    expect(plural(t, 'stats.kpi.ticketsOpen', '1,200', {}, 1200)).toBe('1,200 siguen abiertas');
    expect(plural(t, 'stats.kpi.ticketsOpen', '1', {}, 1)).toBe('1 sigue abierta');
  });

  it('rellena las demás variables y respalda en la clave base si no hay variantes', () => {
    expect(plural(t, 'config.appliedTo', 1, { monto: '150.00' })).toBe('Cargo aplicado a 1 residente — Total: Q150.00');
    expect(plural(t, 'config.appliedTo', 12, { monto: '150.00' })).toBe('Cargo aplicado a 12 residentes — Total: Q150.00');
    expect(plural(t, 'empresas.counts', 3, { total: 3, activas: 2 })).toBe('Registradas: 3 · Activas: 2');
  });
});

describe('claves de plural', () => {
  for (const idioma of ['es', 'en'] as const) {
    it(`${idioma}: cada «.one» tiene su «.other» y al revés`, () => {
      const claves = Object.keys(translations[idioma]);
      const uno = claves.filter(k => k.endsWith('.one')).map(k => k.slice(0, -4)).sort();
      const otros = claves.filter(k => k.endsWith('.other')).map(k => k.slice(0, -6)).sort();
      expect(uno).toEqual(otros);
      expect(uno.length).toBeGreaterThan(5);
    });
  }

  it('las dos lenguas tienen las mismas claves de plural', () => {
    const base = (idioma: 'es' | 'en') => Object.keys(translations[idioma]).filter(k => /\.(one|other)$/.test(k)).sort();
    expect(base('en')).toEqual(base('es'));
  });

  it('ningún texto lleva un «{n} sucursales»-style sin concordar: los sustantivos con {n} delante usan .one/.other', () => {
    // Números junto a un sustantivo plural sin variante de singular: «{n} visitas», «{n} pagos»… (solo las que no tienen .one)
    const sospechosas = Object.entries(translations.es)
      .filter(([k, v]) => /\{n\}\s+(sucursales|empresas|residentes|reservas|equipos|solicitudes|usuarios|agentes|visitas|pagos|casas)\b/.test(v)
        && !k.endsWith('.other') && !k.endsWith('.one')
        // con variantes (clave.one / clave.other) o con su caso singular en otra clave (claveOne)
        && !(`${k}.one` in translations.es) && !(`${k}One` in translations.es))
      .map(([k]) => k);
    // La única que queda tiene su singular con otro nombre (stats.unit.visits → stats.unit.visitOne); un caso nuevo saltaría aquí.
    expect(sospechosas.sort()).toEqual(['stats.unit.visits']);
  });
});
