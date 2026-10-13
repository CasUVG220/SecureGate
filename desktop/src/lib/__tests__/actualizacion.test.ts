import { describe, expect, it } from 'vitest';
import { INTERVALO_BUSQUEDA_MS, PRIMERA_BUSQUEDA_MS, razonBloqueo } from '../actualizacion';

describe('razonBloqueo', () => {
  it('con la cola vacía y sin captura se puede actualizar', () => {
    expect(razonBloqueo(0, false)).toBeNull();
  });
  it('con accesos sin enviar no, y el mensaje concuerda en número', () => {
    expect(razonBloqueo(1, false)).toBe('Hay 1 acceso sin enviar al servidor. Podrás actualizar cuando se sincronicen.');
    expect(razonBloqueo(12, false)).toBe('Hay 12 accesos sin enviar al servidor. Podrás actualizar cuando se sincronicen.');
  });
  it('con una captura en curso no, y esa razón manda sobre la cola', () => {
    expect(razonBloqueo(0, true)).toMatch(/captura en curso/);
    expect(razonBloqueo(9, true)).toMatch(/captura en curso/);
  });
});

describe('tiempos de búsqueda', () => {
  it('primero a los 30 s (sin competir con el arranque) y luego cada 6 horas', () => {
    expect(PRIMERA_BUSQUEDA_MS).toBe(30_000);
    expect(INTERVALO_BUSQUEDA_MS).toBe(21_600_000);
  });
});
