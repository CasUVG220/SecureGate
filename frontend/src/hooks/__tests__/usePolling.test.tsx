import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePolling } from '../usePolling';

const visibilidad = (estado: 'visible' | 'hidden') => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => estado });
};

beforeEach(() => { vi.useFakeTimers(); visibilidad('visible'); });
afterEach(() => { vi.useRealTimers(); visibilidad('visible'); });

describe('usePolling', () => {
  it('llama a la función en cada intervalo y se detiene al desmontar', async () => {
    const fn = vi.fn().mockResolvedValue(undefined);
    const { unmount } = renderHook(() => usePolling(fn, 1000));
    await act(async () => { await vi.advanceTimersByTimeAsync(3100); });
    expect(fn).toHaveBeenCalledTimes(3);
    unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('no sondea con la pestaña oculta y actualiza de inmediato al volver a verla', async () => {
    const fn = vi.fn().mockResolvedValue(undefined);
    renderHook(() => usePolling(fn, 1000));
    visibilidad('hidden');
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(fn).not.toHaveBeenCalled();

    visibilidad('visible');
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); await vi.advanceTimersByTimeAsync(10); });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('no apila llamadas: si una sigue en curso, la siguiente espera', async () => {
    let terminar!: () => void;
    const fn = vi.fn(() => new Promise<void>(r => { terminar = r; }));
    renderHook(() => usePolling(fn, 1000));
    await act(async () => { await vi.advanceTimersByTimeAsync(3500); });
    expect(fn).toHaveBeenCalledTimes(1);          // la primera sigue pendiente: las demás se saltan
    await act(async () => { terminar(); await vi.advanceTimersByTimeAsync(1000); });
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('un error de red no rompe el sondeo: el siguiente ciclo reintenta', async () => {
    const fn = vi.fn().mockRejectedValueOnce(new Error('sin red')).mockResolvedValue(undefined);
    renderHook(() => usePolling(fn, 1000));
    await act(async () => { await vi.advanceTimersByTimeAsync(2100); });
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('activo=false no sondea', async () => {
    const fn = vi.fn();
    renderHook(() => usePolling(fn, 1000, false));
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(fn).not.toHaveBeenCalled();
  });

  it('usa siempre la versión más reciente de la función', async () => {
    const a = vi.fn().mockResolvedValue(undefined);
    const b = vi.fn().mockResolvedValue(undefined);
    const { rerender } = renderHook(({ f }) => usePolling(f, 1000), { initialProps: { f: a } });
    rerender({ f: b });
    await act(async () => { await vi.advanceTimersByTimeAsync(1100); });
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledTimes(1);
  });
});
