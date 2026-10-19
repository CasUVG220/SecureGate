import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  cajaRelativa, carrilNuevo, idNuevo, MODO_AL_ACTIVAR, pendiente, placaVisible, porcentaje, problemaRoi, problemaUrlRele,
  puntoDeClic, puntosSvg, rotuloPista, sonarAlerta, textoApertura, textoEstadoCarril, textoMotivo,
} from '../anpr';

describe('textos del ANPR', () => {
  it('motivo de la verificación en palabras del agente; la lista negra siempre dice que no se abre', () => {
    expect(textoMotivo({ estado: 'verificacion_pendiente', motivo: 'desconocida' })).toBe('La placa no es de un vehículo autorizado.');
    expect(textoMotivo({ estado: 'verificacion_pendiente', motivo: 'licencia_bloqueada' })).toMatch(/empresa suspendida/);
    expect(textoMotivo({ estado: 'alerta_lista_negra', motivo: 'Robo reportado' })).toBe('En lista negra: Robo reportado. No se abre.');
    expect(textoMotivo({ estado: 'alerta_lista_negra', motivo: null })).toBe('En lista negra. No se abre.');
    expect(textoMotivo({ estado: 'automatico', motivo: null })).toBeNull();
    expect(textoMotivo({ estado: 'verificacion_pendiente', motivo: 'algo_nuevo' })).toBe('algo_nuevo');
  });

  it('pendiente: verificación, ilegible y lista negra esperan al agente', () => {
    expect(['verificacion_pendiente', 'ilegible', 'alerta_lista_negra'].every(e => pendiente({ estado: e as never }))).toBe(true);
    expect(['automatico', 'resuelto', 'descartado'].some(e => pendiente({ estado: e as never }))).toBe(false);
  });

  it('placa visible: la confirmada con formato, la probable entre signos de duda', () => {
    expect(placaVisible({ placa: 'P123ABC', placa_probable: null })).toBe('P-123ABC');
    expect(placaVisible({ placa: null, placa_probable: 'P123ABC' })).toBe('¿P-123ABC?');
    expect(placaVisible({ placa: null, placa_probable: null })).toBe('Sin placa');
  });

  it('resultado de la talanquera', () => {
    expect(textoApertura(null)).toBeNull();
    expect(textoApertura('abierta')).toEqual({ texto: 'Talanquera abierta', tono: 'ok' });
    expect(textoApertura('simulada')?.texto).toBe('Talanquera abierta (simulada)');
    expect(textoApertura('fallo: el relé no respondió')).toEqual({ texto: 'La talanquera no respondió: el relé no respondió', tono: 'bad' });
  });

  it('estado del carril: la pausa y el modo apagado mandan sobre lo que diga el motor', () => {
    expect(textoEstadoCarril({ estado: 'activo', fps: 5 }, 'automatico', false)).toEqual({ texto: 'Vigilando · 5 fps', tono: 'ok' });
    expect(textoEstadoCarril({ estado: 'activo', fps: 0.5 }, 'automatico', false).texto).toBe('Vigilando · 0.5 fps');
    expect(textoEstadoCarril({ estado: 'activo', fps: 5 }, 'automatico', true).texto).toBe('Pausado');
    expect(textoEstadoCarril(undefined, 'apagado', false).texto).toBe('Apagado');
    expect(textoEstadoCarril({ estado: 'sin_camara', motivo: 'No responde' }, 'verificacion', false)).toEqual({ texto: 'Sin cámara: No responde', tono: 'bad' });
    expect(textoEstadoCarril(undefined, 'automatico', false).texto).toBe('Detenido');
  });

  it('porcentaje', () => {
    expect(porcentaje(0.934)).toBe('93 %');
    expect(porcentaje(null)).toBe('—');
  });
});

describe('superposición y área del carril', () => {
  it('la caja de una pista en porcentaje del cuadro, recortada a la imagen', () => {
    const p = { id: 'c1-1', estado: 'LEYENDO', clase: 'carro', placa: null, bbox: { x: 320, y: 90, w: 640, h: 360 } };
    expect(cajaRelativa(p, [1280, 720])).toEqual({ left: 25, top: 12.5, width: 50, height: 50 });
    expect(cajaRelativa({ ...p, bbox: { x: -10, y: 0, w: 5000, h: 10 } }, [1280, 720])).toMatchObject({ left: 0, width: 100 });
    expect(rotuloPista(p)).toBe('Leyendo');
    expect(rotuloPista({ ...p, placa: 'P123ABC' })).toBe('P-123ABC');
  });

  it('polígono para el SVG: vacío = todo el cuadro', () => {
    expect(puntosSvg([])).toBe('0.00,0.00 100.00,0.00 100.00,100.00 0.00,100.00');
    expect(puntosSvg([[0.1, 0.2], [0.5, 0.2], [0.5, 0.9]])).toBe('10.00,20.00 50.00,20.00 50.00,90.00');
  });

  it('clic a punto normalizado (0–1), aunque se salga del borde', () => {
    const rect = { left: 100, top: 50, width: 400, height: 200 };
    expect(puntoDeClic(300, 150, rect)).toEqual([0.5, 0.5]);
    expect(puntoDeClic(50, 300, rect)).toEqual([0, 1]);
  });

  it('validación del área: igual que Rust (3–32 puntos) y que encierre algo', () => {
    expect(problemaRoi([])).toBeNull();
    expect(problemaRoi([[0, 0], [1, 1]])).toMatch(/al menos 3/);
    expect(problemaRoi([[0, 0], [0.5, 0.5], [1, 1]])).toMatch(/demasiado chica/);
    expect(problemaRoi([[0.1, 0.1], [0.9, 0.1], [0.9, 0.9]])).toBeNull();
    expect(problemaRoi(Array.from({ length: 33 }, (_, i) => [i / 33, (i % 2) * 0.9] as [number, number]))).toMatch(/hasta 32/);
  });
});

describe('carril nuevo y relé', () => {
  it('un carril nuevo nace APAGADO, con id válido para Rust y sin repetir; al activarlo se propone Automático', () => {
    const c = carrilNuevo([], 'cam1');
    expect(c).toMatchObject({ modo: 'apagado', sentido: 'entrada', camara_id: 'cam1', roi: [], actuador: { tipo: 'simulado' }, nombre: 'Carril 1' });
    expect(c.id).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
    expect(idNuevo(['carril-1'], 1)).toBe('carril-1-2');
    expect(MODO_AL_ACTIVAR).toBe('automatico');
  });

  it('URL del relé: http:// e IP escrita, sin credenciales', () => {
    expect(problemaUrlRele('')).toMatch(/Escribe/);
    expect(problemaUrlRele('https://192.168.1.50/abrir')).toMatch(/http:\/\//);
    expect(problemaUrlRele('http://rele.local/abrir')).toMatch(/IP/);
    expect(problemaUrlRele('http://admin:x@192.168.1.50/')).toMatch(/usuario/);
    expect(problemaUrlRele('no es url')).toMatch(/no es válida/);
    expect(problemaUrlRele('http://192.168.1.50/abrir')).toBeNull();
  });
});

describe('sonido de la alerta', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

  it('sin audio en el equipo no rompe nada', () => {
    vi.stubGlobal('AudioContext', undefined);
    expect(() => sonarAlerta()).not.toThrow();
  });

  it('con audio, tres pitidos', () => {
    vi.useFakeTimers();
    const osc = () => ({ type: '', frequency: { value: 0 }, connect: vi.fn(() => ({ connect: vi.fn() })), start: vi.fn(), stop: vi.fn() });
    const creados: ReturnType<typeof osc>[] = [];
    class CtxFalso {
      currentTime = 0;
      destination = {};
      createOscillator() { const o = osc(); creados.push(o); return o; }
      createGain() { return { gain: { value: 0 }, connect: vi.fn() }; }
      close() { return Promise.resolve(); }
    }
    vi.stubGlobal('AudioContext', CtxFalso);
    sonarAlerta();
    expect(creados).toHaveLength(3);
    expect(creados.every(o => o.start.mock.calls.length === 1)).toBe(true);
    vi.runAllTimers();
  });
});
