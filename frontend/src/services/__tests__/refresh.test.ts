import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BLOQUEO_KEY, getEmpresas, refreshToken, tomarBloqueoGuardado } from '../api';

/**
 * S-11 (SCRUM-129): si la empresa se suspende con la sesión abierta, el servidor responde 423 a `/auth/refresh`.
 * El cliente guarda el aviso, cierra la sesión y la pantalla de acceso explica por qué (no un 401 mudo).
 */
const respuesta = (status: number, cuerpo: unknown = {}) =>
  new Response(JSON.stringify(cuerpo), { status, headers: { 'Content-Type': 'application/json' } });

const BLOQUEO = {
  error: 'Las operaciones de Condominio X están suspendidas: Falta de pago. Contacta al administrador de SecureGate.',
  estado: 'suspendida', codigo: 'empresa_suspendida', empresa: 'Condominio X', motivo: 'Falta de pago', desde: '2026-10-10T12:00:00Z',
};

let ubicacion: { href: string };
beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('token', 'vencido');
  ubicacion = { href: '/ajustes' };
  vi.stubGlobal('location', ubicacion);
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('refreshToken', () => {
  it('423: guarda el aviso (una sola vez) y no renueva nada', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respuesta(423, BLOQUEO)));
    await expect(refreshToken()).resolves.toBeNull();
    expect(JSON.parse(localStorage.getItem(BLOQUEO_KEY)!)).toMatchObject({ codigo: 'empresa_suspendida', motivo: 'Falta de pago' });
    expect(tomarBloqueoGuardado()).toMatchObject({ empresa: 'Condominio X' });
    expect(tomarBloqueoGuardado()).toBeNull();                       // se lee una sola vez
  });

  it('401: sesión vencida sin aviso de empresa', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respuesta(401, { error: 'Refresh token inválido o expirado' })));
    await expect(refreshToken()).resolves.toBeNull();
    expect(localStorage.getItem(BLOQUEO_KEY)).toBeNull();
  });

  it('200: guarda el token nuevo', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respuesta(200, { token: 'nuevo' })));
    await expect(refreshToken()).resolves.toBe('nuevo');
    expect(localStorage.getItem('token')).toBe('nuevo');
  });
});

describe('una petición con el access token vencido y la empresa suspendida', () => {
  it('intenta renovar, recibe 423, cierra la sesión, vuelve a la pantalla de acceso y deja el aviso', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(respuesta(401, { error: 'Sesión revocada' }))      // GET /api/empresas
      .mockResolvedValueOnce(respuesta(423, BLOQUEO));                          // POST /api/auth/refresh
    vi.stubGlobal('fetch', fetchMock);

    await expect(getEmpresas()).rejects.toThrow();                              // la petición original no prospera
    expect(fetchMock.mock.calls[1][0]).toMatch(/\/api\/auth\/refresh$/);
    expect(localStorage.getItem('token')).toBeNull();
    expect(ubicacion.href).toBe('/');
    expect(tomarBloqueoGuardado()).toMatchObject({ codigo: 'empresa_suspendida', motivo: 'Falta de pago' });
  });
});
