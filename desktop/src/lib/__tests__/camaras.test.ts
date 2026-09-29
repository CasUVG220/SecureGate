import { beforeEach, describe, expect, it } from 'vitest';
import {
  ajustarPaneles, asignacionHuerfana, asignacionPorDefecto, etiquetaCamara, guardarDisposicion,
  idDeQr, leerAsignacion, leerDisposicion, resolverDispositivo, STORAGE_KEY, guardarAsignacion,
  LAYOUT_STORAGE_KEY, DISPOSICION_POR_DEFECTO,
} from '../camaras';

const cam = (id: string, label = '') => ({ deviceId: id, label });
const UUID = '3f1b2c4d-5e6f-4a8b-9c0d-1e2f3a4b5c6d';

describe('resolverDispositivo', () => {
  it('usa la cámara asignada cuando sigue conectada', () => {
    expect(resolverDispositivo('placa', { placa: 'b' }, [cam('a'), cam('b')])).toBe('b');
  });

  it('con una sola cámara la usa aunque la asignación apunte a otra (se desconectó o Windows la renumeró)', () => {
    expect(resolverDispositivo('dpi', { dpi: 'vieja' }, [cam('unica')])).toBe('unica');
  });

  it('con varias cámaras y la asignada ausente no adivina: deja elegir al sistema', () => {
    expect(resolverDispositivo('qr', { qr: 'fantasma' }, [cam('a'), cam('b')])).toBeUndefined();
  });

  it('sin asignación y sin cámaras devuelve undefined', () => {
    expect(resolverDispositivo('qr', {}, [])).toBeUndefined();
  });
});

describe('asignacionHuerfana', () => {
  it('avisa sólo cuando hay una asignación que ya no existe', () => {
    expect(asignacionHuerfana('placa', { placa: 'x' }, [cam('a')])).toBe(true);
    expect(asignacionHuerfana('placa', { placa: 'a' }, [cam('a')])).toBe(false);
    expect(asignacionHuerfana('placa', {}, [cam('a')])).toBe(false);
    // Sin lista de dispositivos todavía no se puede afirmar nada.
    expect(asignacionHuerfana('placa', { placa: 'x' }, [])).toBe(false);
  });
});

describe('asignacionPorDefecto', () => {
  it('con una cámara, las cuatro tareas la comparten (comportamiento anterior)', () => {
    expect(asignacionPorDefecto([cam('a')])).toEqual({ qr: 'a', placa: 'a', dpi: 'a', salida: 'a' });
  });

  it('con cuatro cámaras reparte una por tarea', () => {
    expect(asignacionPorDefecto([cam('a'), cam('b'), cam('c'), cam('d')]))
      .toEqual({ qr: 'a', placa: 'b', dpi: 'c', salida: 'd' });
  });

  it('con menos cámaras que tareas, las últimas reutilizan la final', () => {
    expect(asignacionPorDefecto([cam('a'), cam('b')])).toEqual({ qr: 'a', placa: 'b', dpi: 'b', salida: 'b' });
  });

  it('sin cámaras no inventa nada', () => {
    expect(asignacionPorDefecto([])).toEqual({});
  });
});

describe('persistencia', () => {
  it('guarda y relee, ignorando basura', () => {
    localStorage.clear();
    guardarAsignacion({ qr: 'a', placa: 'b' });
    expect(leerAsignacion()).toEqual({ qr: 'a', placa: 'b' });

    localStorage.setItem(STORAGE_KEY, 'no-es-json');
    expect(leerAsignacion()).toEqual({});
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ qr: 5, otra: 'x' }));
    expect(leerAsignacion()).toEqual({});
  });
});

describe('etiquetaCamara', () => {
  it('numera las que el sistema no nombra', () => {
    expect(etiquetaCamara(cam('a', 'Logitech C920'), 0)).toBe('Logitech C920');
    expect(etiquetaCamara(cam('a', '  '), 1)).toBe('Cámara 2');
  });
});

describe('idDeQr', () => {
  it('acepta sólo códigos de SecureGate con UUID', () => {
    expect(idDeQr(`SGQR:${UUID}`)).toBe(UUID);
    expect(idDeQr(`  SGQR:${UUID.toUpperCase()}  `)).toBe(UUID);
  });

  it('ignora códigos ajenos: la garita está llena de QR que no son nuestros', () => {
    expect(idDeQr('https://ejemplo.com')).toBeNull();
    expect(idDeQr('SGQR:no-es-uuid')).toBeNull();
    expect(idDeQr(UUID)).toBeNull();
    expect(idDeQr('')).toBeNull();
  });
});

describe('disposición de los paneles', () => {
  beforeEach(() => localStorage.clear());

  it('arranca con una sola vista mientras nadie elija otra cosa', () => {
    expect(leerDisposicion()).toEqual(DISPOSICION_POR_DEFECTO);
    expect(leerDisposicion().layout).toBe(1);
  });

  it('guarda y relee la disposición elegida', () => {
    guardarDisposicion({ layout: 4, paneles: ['salida', 'qr', 'dpi', 'placa'] });
    expect(leerDisposicion()).toEqual({ layout: 4, paneles: ['salida', 'qr', 'dpi', 'placa'] });
  });

  it('ignora layouts y tareas inventados en vez de romper la pantalla', () => {
    localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify({ layout: 3, paneles: ['qr', 'inventada'] }));
    expect(leerDisposicion()).toEqual(DISPOSICION_POR_DEFECTO);

    localStorage.setItem(LAYOUT_STORAGE_KEY, 'no-es-json');
    expect(leerDisposicion()).toEqual(DISPOSICION_POR_DEFECTO);
  });

  it('al crecer conserva lo ya elegido y rellena el resto por defecto', () => {
    expect(ajustarPaneles(['salida'], 4)).toEqual(['salida', 'placa', 'dpi', 'salida']);
    expect(ajustarPaneles(['salida'], 2)).toEqual(['salida', 'placa']);
  });

  it('al encoger se queda con los primeros paneles', () => {
    expect(ajustarPaneles(['dpi', 'salida', 'qr', 'placa'], 1)).toEqual(['dpi']);
    expect(ajustarPaneles(['dpi', 'salida', 'qr', 'placa'], 2)).toEqual(['dpi', 'salida']);
  });
});
