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

/** T12: «Mi plan» es del administrador de empresa y «Planes y cobros» del owner; nadie más los ve. */
describe('navegación SaaS (T12)', () => {
  const paginas = (rol: string) => navForRole(rol).flatMap(g => g.items.map(i => i.key as string));

  it('el administrador de empresa ve «Mi plan» y el owner ve «Planes y cobros», cada uno solo el suyo', () => {
    expect(paginas('admin_empresa')).toContain('ae-plan');
    expect(paginas('admin_empresa')).not.toContain('owner-saas');
    expect(paginas('owner')).toContain('owner-saas');
    expect(paginas('owner')).not.toContain('ae-plan');
  });

  it('ni el administrador de sucursal, ni el residente, ni el personal de garita ven los cobros', () => {
    for (const rol of ['admin_sucursal', 'residente', 'agente', 'desconocido']) {
      expect([rol, paginas(rol)]).toEqual([rol, expect.not.arrayContaining(['ae-plan', 'owner-saas'])]);
    }
  });

  it('los rótulos existen en español e inglés', () => {
    for (const k of ['nav.saas', 'nav.myPlan', 'login.register']) {
      expect(translations.es[k], `es ${k}`).toBeTruthy();
      expect(translations.en[k], `en ${k}`).toBeTruthy();
    }
    expect(translations.es['nav.myPlan']).toBe('Mi plan');
  });
});

describe('traducciones de T10–T12: mismas claves en las dos lenguas', () => {
  it('toda clave plan.* saas.* reg.* onb.* existe en español e inglés (y viceversa)', () => {
    const prefijos = /^(plan|saas|reg|onb)\./;
    const es = Object.keys(translations.es).filter(k => prefijos.test(k)).sort();
    const en = Object.keys(translations.en).filter(k => prefijos.test(k)).sort();
    expect(es.length).toBeGreaterThan(100);
    expect(en).toEqual(es);
  });
});
