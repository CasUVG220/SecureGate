import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider, useToast, TOAST_DURACION_MS, type ToastOptions, type ToastType } from '../Toast';

function Disparador({ mensaje, tipo, opciones }: { mensaje: string; tipo?: ToastType; opciones?: ToastOptions }) {
  const toast = useToast();
  return <button onClick={() => toast(mensaje, tipo, opciones)}>mostrar {mensaje}</button>;
}

const mostrar = (mensaje: string, tipo?: ToastType, opciones?: ToastOptions) => {
  render(<ToastProvider><Disparador mensaje={mensaje} tipo={tipo} opciones={opciones} /></ToastProvider>);
  fireEvent.click(screen.getByRole('button', { name: `mostrar ${mensaje}` }));
};

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('Toast', () => {
  it('un aviso normal se cierra solo a los 4 s', () => {
    mostrar('Guardado');
    expect(screen.getByText('Guardado')).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(TOAST_DURACION_MS + 50); });
    expect(screen.queryByText('Guardado')).toBeNull();
  });

  it('un ERROR es persistente: sigue ahí pasado un minuto y se cierra con su botón', () => {
    mostrar('No se pudo guardar', 'error');
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(screen.getByRole('alert')).toHaveTextContent('No se pudo guardar');
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar aviso' }));
    expect(screen.queryByText('No se pudo guardar')).toBeNull();
  });

  it('una confirmación con acción también persiste y la acción lleva al elemento y cierra el aviso', () => {
    const ir = vi.fn();
    mostrar('Anuncio publicado', 'success', { accion: { label: 'Ver anuncio', onClick: ir } });
    act(() => { vi.advanceTimersByTime(30_000); });
    fireEvent.click(screen.getByRole('button', { name: 'Ver anuncio' }));
    expect(ir).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Anuncio publicado')).toBeNull();
  });

  it('persistente: false permite que un error se cierre solo', () => {
    mostrar('Aviso breve', 'error', { persistente: false });
    act(() => { vi.advanceTimersByTime(TOAST_DURACION_MS + 50); });
    expect(screen.queryByText('Aviso breve')).toBeNull();
  });

  it('pasar el cursor detiene el cierre automático y al soltarlo se despide', () => {
    mostrar('Con cursor');
    const aviso = screen.getByRole('status', { name: '' });
    act(() => { vi.advanceTimersByTime(TOAST_DURACION_MS - 500); });
    fireEvent.mouseEnter(aviso);
    act(() => { vi.advanceTimersByTime(10_000); });
    expect(screen.getByText('Con cursor')).toBeInTheDocument();    // detenido mientras se lee
    fireEvent.mouseLeave(aviso);
    act(() => { vi.advanceTimersByTime(3000); });
    expect(screen.queryByText('Con cursor')).toBeNull();
  });

  it('el error se anuncia como alerta y el resto como estado', () => {
    mostrar('x', 'error');
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });
});
