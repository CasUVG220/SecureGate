import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { translations } from '../translations';

/**
 * Glosario único (docs/glosario.md, SCRUM-113 / H06): la misma cosa se llama siempre igual en pantalla.
 * Esta prueba es la «lista de revisión» automática: falla si un texto vuelve a usar un término descartado.
 *
 *   - «ban»           → bloquear / bloqueo
 *   - «ticket»        → solicitud            (el código y la API siguen llamándose `tickets`)
 *   - «Estadísticas»  → Reportes
 *   - «preautorización» → aviso de visita («Avisar de una visita», «Visitas avisadas»)   (SCRUM-114 / H10)
 *   - «admin» abreviado → administrador                                                 (SCRUM-114 / H09)
 */
const entradas = (idioma: 'es' | 'en') => Object.entries(translations[idioma]);

describe('glosario: términos descartados en la interfaz', () => {
  it.each([
    ['es', /\bbans?\b|\bbaneo\b|\bbanear\b/i, 'ban → bloquear / bloqueo'],
    ['es', /\btickets?\b/i, 'ticket → solicitud'],
    ['es', /estad[ií]sticas/i, 'Estadísticas → Reportes'],
    ['en', /\bbans?\b|\bbanned\b/i, 'ban → block'],
    ['en', /\btickets?\b/i, 'ticket → request'],
    ['en', /\bstatistics\b/i, 'Statistics → Reports'],
    ['es', /preautoriz/i, 'preautorización → aviso de visita'],
    ['en', /pre-?authori[sz]/i, 'preauthorization → announced visit'],
    ['es', /\badmins?\b/i, 'admin → administrador'],
    ['en', /\badmins?\b/i, 'admin → administrator'],
  ] as const)('%s: ningún texto usa el término descartado (%s)', (idioma, patron, regla) => {
    const infracciones = entradas(idioma)
      .filter(([, valor]) => patron.test(valor))
      .map(([clave, valor]) => `${clave}: ${valor}`);
    expect(infracciones, regla).toEqual([]);
  });

  it('las dos lenguas tienen las mismas claves de menú y de glosario', () => {
    const claves = ['nav.reports', 'nav.qrRules', 'nav.config', 'nav.tickets', 'nav.gates', 'nav.blacklist', 'tickets.title'];
    for (const k of claves) {
      expect(translations.es[k], `es ${k}`).toBeTruthy();
      expect(translations.en[k], `en ${k}`).toBeTruthy();
    }
  });

  it('los nombres oficiales del menú son los del glosario', () => {
    expect(translations.es['nav.reports']).toBe('Reportes');
    expect(translations.es['nav.tickets']).toBe('Solicitudes');
    expect(translations.es['nav.qrRules']).toBe('Reglas de QR');
    expect(translations.es['nav.gates']).toBe('Garitas');
    expect(translations.es['lic.title']).toBe('Garitas y códigos de activación');
    expect(translations.es['nav.preauth']).toBe('Visitas avisadas');
    expect(translations.es['aviso.title']).toBe('Avisar de una visita');
  });

  it('el glosario documentado menciona cada regla que esta prueba hace cumplir', () => {
    const doc = readFileSync(path.resolve(__dirname, '../../../../docs/glosario.md'), 'utf8');
    for (const termino of ['ban', 'ticket', 'Estadísticas', 'Reglas de QR', 'Garitas y códigos de activación', 'Reportes', 'America/Guatemala', 'P-123ABC', 'Avisar de una visita', 'Visitante guardado', 'Mi empresa']) {
      expect(doc, termino).toContain(termino);
    }
  });
});
