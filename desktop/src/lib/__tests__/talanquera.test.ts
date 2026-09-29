import { describe, expect, it } from 'vitest';
import { textoApertura } from '../talanquera';

describe('textoApertura', () => {
  it('sin driver no dice nada: la apertura física es opcional', () => {
    expect(textoApertura({ abierta: false, driver: 'Sin hardware', error: { tipo: 'sin_driver' } })).toBeNull();
    expect(textoApertura({ abierta: false, driver: 'x', error: null })).toBeNull();
  });

  it('abierta: confirma con el driver', () => {
    expect(textoApertura({ abierta: true, driver: 'Relé USB (LCUS/CH340)', error: null }))
      .toBe('Talanquera abierta (Relé USB (LCUS/CH340)).');
  });

  it('fallo: dice que abra a mano y por qué', () => {
    const t = textoApertura({ abierta: false, driver: 'Relé TCP 10.0.0.5:6722', error: { tipo: 'timeout', detalle: 'conectar' } });
    expect(t).toMatch(/abre manual/);
    expect(t).toMatch(/no respondió a tiempo \(conectar\)/);
    expect(textoApertura({ abierta: false, driver: 'GPIO', error: { tipo: 'no_soportado', detalle: 'pin 17' } })).toMatch(/No soportado/);
  });
});
