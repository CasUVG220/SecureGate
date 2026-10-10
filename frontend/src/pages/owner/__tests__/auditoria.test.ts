import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { translations } from '../../../i18n/translations';
import { estadoDe, grupoDeAccion, GRUPOS } from '../auditoria';

/** Acciones documentadas en docs/acciones_sensibles.md (primera columna de la tabla). */
const accionesDocumentadas = (): string[] => {
  const doc = readFileSync(path.resolve(__dirname, '../../../../../docs/acciones_sensibles.md'), 'utf8');
  const set = new Set<string>();
  for (const linea of doc.split('\n')) {
    const m = /^\|\s*`([A-Z][A-Z0-9_]+)`\s*\|/.exec(linea);
    if (m) set.add(m[1]);
  }
  return [...set].sort();
};

describe('panel de auditoría: cada acción documentada se puede leer y filtrar', () => {
  const acciones = accionesDocumentadas();

  it('la lista documentada se leyó (si no, las pruebas de abajo no prueban nada)', () => {
    expect(acciones.length).toBeGreaterThan(70);
    expect(acciones).toEqual(expect.arrayContaining(['LOGIN', 'LOGOUT', 'TICKET_CREADO', 'ACCESO_DENEGADO', 'REFRESH_RECHAZADO']));
  });

  it('todas tienen un nombre legible en español y en inglés', () => {
    for (const a of acciones) {
      expect([a, translations.es[`audit.accion.${a}`]?.length > 0]).toEqual([a, true]);
      expect([a, translations.en[`audit.accion.${a}`]?.length > 0]).toEqual([a, true]);
    }
  });

  it('todas caen en un grupo del filtro (ninguna se pierde en «otras»)', () => {
    const sueltas = acciones.filter(a => grupoDeAccion(a) === 'otras');
    expect(sueltas).toEqual([]);
  });

  it('todos los grupos tienen su rótulo y los nombres no repiten el código crudo', () => {
    for (const g of GRUPOS) expect(translations.es[`audit.group.${g}`]).toBeTruthy();
    for (const a of acciones) expect(translations.es[`audit.accion.${a}`]).not.toBe(a);
  });

  it('el vocabulario del glosario se respeta: nada de «ticket», «ban» ni «ingreso» en los nombres', () => {
    for (const a of acciones) expect(translations.es[`audit.accion.${a}`]).not.toMatch(/\bticket|\bban\b|ingreso/i);
  });
});

describe('agrupación y resultado', () => {
  it('las invitaciones con QR van con la garita y las de administradores con las empresas', () => {
    expect(grupoDeAccion('INVITACION_QR_CREADA')).toBe('garita');
    expect(grupoDeAccion('INVITACION_CREADA')).toBe('empresas');
    expect(grupoDeAccion('REPORTE_PAGOS_EXPORTADO')).toBe('datos');
    expect(grupoDeAccion('JOB_MORA_EJECUTADO')).toBe('sistema');
    expect(grupoDeAccion('ACCION_DEL_FUTURO')).toBe('otras');
  });

  it('el resultado sale del código HTTP igual que en el servidor', () => {
    expect(estadoDe(200)).toBe('ok');
    expect(estadoDe(201)).toBe('ok');
    expect(estadoDe(null)).toBe('ok');
    expect(estadoDe(403)).toBe('rechazado');
    expect(estadoDe(423)).toBe('rechazado');
    expect(estadoDe(429)).toBe('bloqueado');
    expect(estadoDe(500)).toBe('error');
  });
});
