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
 *   - «2FA» / «MFA» / «OTP» → verificación en dos pasos                                   (SCRUM-123)
 *   - «Logo URL»      → el logo se sube como archivo, no se escribe una URL                 (SCRUM-115 / H12)
 *   - «ingreso(s)»    → entrada(s) para las visitas; el dinero es «cobrado» / «recaudado»  (SCRUM-115 / H11)
 *   - «barrera»       → talanquera                                                        (Sprint 10, ANPR)
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
    ['es', /logo\s*url/i, 'Logo URL → Logo (se sube como archivo)'],
    ['en', /logo\s*url/i, 'Logo URL → Logo (uploaded as a file)'],
    ['es', /\bingresos?\b/i, 'ingreso(s) → entrada(s) / cobrado'],
    ['es', /\badmins?\b/i, 'admin → administrador'],
    ['es', /\b2fa\b|\bmfa\b|\botp\b|autenticaci[oó]n (de|en) dos factores/i, '2FA / MFA / OTP → verificación en dos pasos'],
    ['en', /\b2fa\b|\bmfa\b|\botp\b|two-factor/i, '2FA / MFA / OTP / two-factor → two-step verification'],
    ['en', /\badmins?\b/i, 'admin → administrator'],
    ['es', /\bbarreras?\b/i, 'barrera → talanquera'],
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

  it('accesos por placas (Sprint 10): «Automático (placas)» y «Verificado por agente», en las dos lenguas', () => {
    expect(translations.es['entradas.method.anpr']).toBe('Automático (placas)');
    expect(translations.es['entradas.verified']).toBe('Verificado por agente');
    expect(translations.en['entradas.method.anpr']).toBe('Automatic (plates)');
    expect(translations.en['entradas.verified']).toBeTruthy();
    expect(translations.es['plates.listLabel']).toBe('Placas autorizadas');
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
    for (const termino of ['ban', 'ticket', 'Estadísticas', 'Reglas de QR', 'Garitas y códigos de activación', 'Reportes', 'America/Guatemala', 'P-123ABC', 'Avisar de una visita', 'Visitante guardado', 'Mi empresa', 'Verificación en dos pasos', 'Mi cuenta']) {
      expect(doc, termino).toContain(termino);
    }
  });
});
