import { describe, it, expect } from 'vitest';
import { navForRole } from '../App';
import { translations } from '../i18n/translations';

/** SCRUM-114 / H09: «Administración global» es del owner; el administrador de empresa solo ve la suya. */
describe('navegación por rol', () => {
  const rotulos = (rol: string) => navForRole(rol).map(g => g.labelKey);

  it('el owner ve «Administración global»', () => {
    expect(rotulos('owner')).toContain('nav.group.global');
  });

  it('el administrador de empresa NO ve «Administración global» sino el rótulo de su empresa', () => {
    expect(rotulos('admin_empresa')).not.toContain('nav.group.global');
    expect(rotulos('admin_empresa')).toContain('nav.group.company');
  });

  it('ningún otro rol ve «Administración global»', () => {
    for (const rol of ['admin_sucursal', 'agente', 'residente', 'desconocido']) {
      expect([rol, rotulos(rol)]).toEqual([rol, expect.not.arrayContaining(['nav.group.global'])]);
    }
  });

  it('el rótulo nuevo existe en español e inglés', () => {
    expect(translations.es['nav.group.company']).toBe('Mi empresa');
    expect(translations.en['nav.group.company']).toBeTruthy();
  });

  /** SCRUM-123: «Mi cuenta» (verificación en dos pasos) es de los tres roles de administración. */
  it('los tres roles de administración tienen «Mi cuenta»; el personal de garita y los residentes no', () => {
    const paginas = (rol: string) => navForRole(rol).flatMap(g => g.items.map(i => i.key as string));
    for (const rol of ['owner', 'admin_empresa', 'admin_sucursal']) expect([rol, paginas(rol)]).toEqual([rol, expect.arrayContaining(['cuenta'])]);
    for (const rol of ['agente', 'residente', 'desconocido']) expect([rol, paginas(rol)]).toEqual([rol, expect.not.arrayContaining(['cuenta'])]);
  });

  it('«Mi cuenta» existe en español e inglés', () => {
    expect(translations.es['nav.account']).toBe('Mi cuenta');
    expect(translations.en['nav.account']).toBe('My account');
    expect(translations.es['nav.group.account']).toBeTruthy();
    expect(translations.en['nav.group.account']).toBeTruthy();
  });
});
