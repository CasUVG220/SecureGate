import { describe, it, expect } from 'vitest';
import {
  RUTA_PORTAL, normalizarRuta, otroPortal, portalDeRol, portalDeRuta,
} from '../portales';

describe('portalDeRol', () => {
  it('manda al residente a su portal', () => {
    expect(portalDeRol('residente')).toBe('residente');
  });

  it('todo lo demás es personal', () => {
    for (const rol of ['admin', 'admin_sucursal', 'admin_empresa', 'agente', 'owner']) {
      expect(portalDeRol(rol)).toBe('personal');
    }
  });

  it('un rol desconocido no cae en el portal del residente', () => {
    // Ante un rol que no se reconoce conviene enviar al portal de personal: el
    // backend seguirá negando lo que no corresponda a ese rol.
    expect(portalDeRol('')).toBe('personal');
    expect(portalDeRol('rol_nuevo')).toBe('personal');
  });
});

describe('portalDeRuta', () => {
  it('reconoce las rutas canónicas', () => {
    expect(portalDeRuta('/personal')).toBe('personal');
    expect(portalDeRuta('/residente')).toBe('residente');
  });

  it('acepta los alias en inglés', () => {
    expect(portalDeRuta('/staff')).toBe('personal');
    expect(portalDeRuta('/admin')).toBe('personal');
    expect(portalDeRuta('/tenant')).toBe('residente');
    expect(portalDeRuta('/resident')).toBe('residente');
    expect(portalDeRuta('/portal')).toBe('residente');
  });

  it('ignora barra final y mayúsculas', () => {
    expect(portalDeRuta('/Personal/')).toBe('personal');
    expect(portalDeRuta('/TENANT')).toBe('residente');
  });

  it('devuelve null para lo que no es la entrada de un portal', () => {
    expect(portalDeRuta('/')).toBeNull();
    expect(portalDeRuta('/pagos')).toBeNull();
    expect(portalDeRuta('/personal/extra')).toBeNull();
  });
});

describe('normalizarRuta', () => {
  it('la raíz se conserva como "/"', () => {
    expect(normalizarRuta('/')).toBe('/');
    expect(normalizarRuta('')).toBe('/');
  });

  it('quita las barras finales', () => {
    expect(normalizarRuta('/personal///')).toBe('/personal');
  });
});

describe('otroPortal', () => {
  it('alterna entre los dos', () => {
    expect(otroPortal('personal')).toBe('residente');
    expect(otroPortal('residente')).toBe('personal');
  });

  it('cada portal tiene su ruta canónica y son distintas', () => {
    expect(RUTA_PORTAL.personal).toBe('/personal');
    expect(RUTA_PORTAL.residente).toBe('/residente');
  });
});

describe('rutas públicas del alta autoservicio (T12)', () => {
  const token = 'abcdefghijklmnopqrstuvwxyz0123456789_-ABCDE';

  it('/registro se reconoce con o sin barra final y sin importar mayúsculas', async () => {
    const { esRutaRegistro } = await import('../portales');
    for (const r of ['/registro', '/registro/', '/REGISTRO']) expect([r, esRutaRegistro(r)]).toEqual([r, true]);
    for (const r of ['/', '/registro/otra', '/personal', '/registrov']) expect([r, esRutaRegistro(r)]).toEqual([r, false]);
  });

  it('/onboarding/<token> entrega el token tal cual (distingue mayúsculas) y rechaza lo demás', async () => {
    const { tokenDeOnboarding } = await import('../portales');
    expect(tokenDeOnboarding(`/onboarding/${token}`)).toBe(token);
    expect(tokenDeOnboarding(`/onboarding/${token}/`)).toBe(token);
    for (const r of ['/onboarding', '/onboarding/', '/onboarding/corto', `/onboarding/${token}/extra`, `/Onboarding/${token}`, `/onboarding/${token}?x=1`, `/onboarding/${token}%20`, `/invitacion/${token}`]) {
      expect([r, tokenDeOnboarding(r)]).toEqual([r, null]);
    }
  });

  it('no son rutas de ningún portal (la corrección automática las deja en paz)', async () => {
    const { portalDeRuta } = await import('../portales');
    expect(portalDeRuta('/registro')).toBeNull();
    expect(portalDeRuta(`/onboarding/${token}`)).toBeNull();
  });
});
