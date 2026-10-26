import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAnpr } from '../useAnpr';
import { api, onAnpr, type MensajeAnpr } from '../../lib/tauri';
import { sonarAlerta } from '../../lib/anpr';
import { carril, estadoAnpr, evento } from '../../components/anpr/__tests__/fixtures';

let emitir: (m: MensajeAnpr) => void = () => {};

vi.mock('../../lib/tauri', async () => {
  const real = await vi.importActual<typeof import('../../lib/tauri')>('../../lib/tauri');
  return {
    ...real,
    api: { anpr: { estado: vi.fn(), iniciar: vi.fn(), eventos: vi.fn(), resolver: vi.fn(), pausar: vi.fn() } },
    onAnpr: vi.fn(async (cb: (m: MensajeAnpr) => void) => { emitir = cb; return () => {}; }),
  };
});

vi.mock('../../lib/anpr', async () => {
  const real = await vi.importActual<typeof import('../../lib/anpr')>('../../lib/anpr');
  return { ...real, sonarAlerta: vi.fn() };
});

const a = api.anpr as unknown as Record<string, ReturnType<typeof vi.fn>>;

beforeEach(() => {
  Object.values(a).forEach(f => f.mockReset());
  vi.mocked(sonarAlerta).mockReset();
  a.iniciar.mockResolvedValue(estadoAnpr());
  a.estado.mockResolvedValue(estadoAnpr());
  a.eventos.mockResolvedValue([evento({ id: 'viejo', estado: 'resuelto' })]);
});

async function montar(habilitado = true) {
  const r = renderHook(() => useAnpr(habilitado));
  await waitFor(() => expect(r.result.current.estado).not.toBeNull());
  await waitFor(() => expect(vi.mocked(onAnpr)).toHaveBeenCalled());
  return r;
}

describe('useAnpr', () => {
  it('con sesión arranca los carriles y trae los eventos; sin sesión no arranca nada', async () => {
    const r = await montar();
    expect(a.iniciar).toHaveBeenCalledTimes(1);
    expect(r.result.current.eventos.map(e => e.id)).toEqual(['viejo']);
    renderHook(() => useAnpr(false));
    expect(a.iniciar).toHaveBeenCalledTimes(1);
  });

  it('si el ANPR no arranca lo dice, y la garita sigue (el error no se lanza)', async () => {
    a.iniciar.mockRejectedValue({ codigo: 'anpr', mensaje: 'Falta el detector de vehículos en esta instalación (yolox_nano.onnx).' });
    const r = await montar();
    await waitFor(() => expect(r.result.current.error).toMatch(/yolox_nano/));
  });

  it('pistas por carril, evento nuevo arriba, alerta de lista negra con sonido', async () => {
    const r = await montar();
    act(() => emitir({ tipo: 'fotograma', carril: 'c1', pistas: [{ id: 'c1-1', estado: 'LEYENDO', bbox: { x: 1, y: 2, w: 3, h: 4 }, clase: 'carro', placa: null }], tamano: [640, 360], movimiento: null, ms: null, fps: 5 }));
    expect(r.result.current.pistas.c1).toEqual({ pistas: [expect.objectContaining({ id: 'c1-1' })], tamano: [640, 360] });

    act(() => emitir({ tipo: 'evento', carril: 'c1', evento: evento({ id: 'nuevo', estado: 'verificacion_pendiente', motivo: 'desconocida' }), alerta: false }));
    expect(r.result.current.eventos[0].id).toBe('nuevo');
    expect(r.result.current.pendientes).toBe(1);
    expect(sonarAlerta).not.toHaveBeenCalled();

    act(() => emitir({ tipo: 'evento', carril: 'c1', evento: evento({ id: 'ln', estado: 'alerta_lista_negra', motivo: 'Robo' }), alerta: true }));
    expect(sonarAlerta).toHaveBeenCalledTimes(1);
    expect(r.result.current.alertas.map(e => e.id)).toEqual(['ln']);
    expect(r.result.current.pendientes).toBe(2);
  });

  it('el estado de un carril se actualiza; al detenerse se borran sus pistas', async () => {
    const r = await montar();
    act(() => emitir({ tipo: 'fotograma', carril: 'c1', pistas: [], tamano: [640, 360], movimiento: null, ms: null, fps: 1 }));
    act(() => emitir({ tipo: 'estado', carril: 'c1', estado: { estado: 'sin_camara', motivo: 'No responde' } }));
    expect(r.result.current.estado?.carriles[0].estado).toEqual({ estado: 'sin_camara', motivo: 'No responde' });
    act(() => emitir({ tipo: 'estado', carril: 'c1', estado: { estado: 'detenido' } }));
    expect(r.result.current.pistas.c1).toBeUndefined();
  });

  it('la talanquera que falla queda como aviso persistente hasta que el agente lo ve; una que abre no', async () => {
    a.eventos.mockResolvedValue([evento({ id: 'e1' }), evento({ id: 'e2' })]);
    const r = await montar();
    act(() => emitir({ tipo: 'apertura', carril: 'c1', evento_id: 'e1', ok: false, simulada: false, error: 'el relé no respondió' }));
    act(() => emitir({ tipo: 'apertura', carril: 'c1', evento_id: 'e2', ok: true, simulada: true, error: null }));
    expect(r.result.current.fallas).toEqual([{ evento_id: 'e1', carril: 'c1', error: 'el relé no respondió' }]);
    expect(r.result.current.eventos.find(e => e.id === 'e2')?.apertura).toBe('simulada');
    act(() => r.result.current.verFalla('e1'));
    expect(r.result.current.fallas).toEqual([]);
  });

  it('resolver reemplaza el evento por el resuelto; pausar deja el estado que devuelve Rust y limpia las pistas', async () => {
    a.eventos.mockResolvedValue([evento({ id: 'p', estado: 'verificacion_pendiente' })]);
    const r = await montar();
    expect(r.result.current.pendientes).toBe(1);
    a.resolver.mockResolvedValue(evento({ id: 'p', estado: 'resuelto', resolucion: 'autorizar' }));
    await act(async () => { await r.result.current.resolver('p', 'autorizar', 'P123ABC'); });
    expect(a.resolver).toHaveBeenCalledWith('p', 'autorizar', 'P123ABC');
    expect(r.result.current.pendientes).toBe(0);

    act(() => emitir({ tipo: 'fotograma', carril: 'c1', pistas: [], tamano: [1, 1], movimiento: null, ms: null, fps: 1 }));
    a.pausar.mockResolvedValue(estadoAnpr({ pausado: true }));
    await act(async () => { await r.result.current.pausar(true); });
    expect(r.result.current.estado?.pausado).toBe(true);
    expect(r.result.current.pistas).toEqual({});
    expect(r.result.current.nombreCarril('c1')).toBe(carril().nombre);
    expect(r.result.current.nombreCarril('otro')).toBe('otro');
  });

  it('si pausar falla se muestra el error y se vuelve a pedir el estado real', async () => {
    const r = await montar();
    a.pausar.mockRejectedValue({ codigo: 'sesion', mensaje: 'Inicia sesión.' });
    await act(async () => { await r.result.current.pausar(true); });
    expect(r.result.current.error).toBe('Inicia sesión.');
    expect(a.estado).toHaveBeenCalledTimes(2);
  });
});
