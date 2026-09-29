import { describe, expect, it } from 'vitest';
import { describirErrorCamara, detectarPlataforma } from '../camara';

const domErr = (name: string, message = '') => Object.assign(new Error(message), { name });

describe('describirErrorCamara', () => {
  it('permiso denegado → denegada, con la ruta de ajustes de la plataforma', () => {
    const mac = describirErrorCamara(domErr('NotAllowedError'), 'mac');
    expect(mac.estado).toBe('denegada');
    expect(mac.titulo).toMatch(/denegado/i);
    expect(mac.detalle).toContain('Configuración del Sistema');

    const win = describirErrorCamara(domErr('NotAllowedError'), 'windows');
    expect(win.detalle).toContain('Privacidad y seguridad › Cámara');
  });

  it('sin dispositivo → sin_camara con instrucción de conectar una', () => {
    const f = describirErrorCamara(domErr('NotFoundError'));
    expect(f.estado).toBe('sin_camara');
    expect(f.titulo).toBe('No se detectó ninguna cámara');
    expect(f.detalle).toMatch(/formulario manual/);
  });

  it('cámara en uso por otra app → ocupada', () => {
    expect(describirErrorCamara(domErr('NotReadableError')).estado).toBe('ocupada');
    expect(describirErrorCamara(domErr('AbortError')).estado).toBe('ocupada');
  });

  it('contexto no seguro → denegada, pero lo explica como problema de la app', () => {
    const f = describirErrorCamara(domErr('SecurityError'));
    expect(f.estado).toBe('denegada');
    expect(f.detalle).toMatch(/soporte/);
  });

  it('errores desconocidos conservan el mensaje y caen a manual', () => {
    const f = describirErrorCamara(domErr('RaroError', 'algo pasó'));
    expect(f.estado).toBe('error');
    expect(f.codigo).toBe('RaroError');
    expect(f.detalle).toContain('algo pasó');
    expect(describirErrorCamara(null).codigo).toBe('Desconocido');
  });

  it('detecta la plataforma por user agent', () => {
    expect(detectarPlataforma('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)')).toBe('mac');
    expect(detectarPlataforma('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe('windows');
    expect(detectarPlataforma('Mozilla/5.0 (X11; Linux x86_64)')).toBe('otra');
  });
});
