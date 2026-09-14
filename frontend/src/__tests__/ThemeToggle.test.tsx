import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { ThemeProvider, useTheme, resolveInitialTheme, DEFAULT_THEME } from '../context/ThemeContext';
import { updatePreferencias } from '../services/api';

// El provider avisa al backend en segundo plano; en las pruebas no hay red.
vi.mock('../services/api', () => ({ updatePreferencias: vi.fn().mockResolvedValue(undefined) }));

const mockPrefs = updatePreferencias as unknown as ReturnType<typeof vi.fn>;

function ThemeProbe() {
  const { theme, toggle, reset } = useTheme();
  return (
    <>
      <span data-testid="tema">{theme}</span>
      <button onClick={toggle}>Cambiar tema</button>
      <button onClick={reset}>Cerrar sesión</button>
    </>
  );
}

const renderToggle = () => render(<ThemeProvider><ThemeProbe /></ThemeProvider>);
const conSesion = () => localStorage.setItem('token', 'tok-de-prueba');

describe('Tema', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove('dark');
    mockPrefs.mockClear();
  });

  it('el tema por defecto del producto es oscuro', () => {
    expect(DEFAULT_THEME).toBe('dark');
    renderToggle();
    expect(screen.getByTestId('tema')).toHaveTextContent('dark');
    expect(document.documentElement).toHaveClass('dark');
  });

  it('sin sesión ignora cualquier preferencia guardada', () => {
    // Un tema guardado pertenece al usuario que lo eligió: en el login, o tras
    // cerrar sesión, no debe teñir la pantalla del siguiente.
    localStorage.setItem('theme', 'light');
    expect(resolveInitialTheme()).toBe('dark');
  });

  it('con sesión recupera la preferencia guardada del usuario', () => {
    conSesion();
    localStorage.setItem('theme', 'light');
    expect(resolveInitialTheme()).toBe('light');

    renderToggle();
    expect(screen.getByTestId('tema')).toHaveTextContent('light');
    expect(document.documentElement).not.toHaveClass('dark');
  });

  it('ignora la preferencia del sistema operativo', () => {
    const original = window.matchMedia;
    window.matchMedia = ((q: string) => ({
      matches: true, media: q, onchange: null,
      addEventListener: () => {}, removeEventListener: () => {},
      addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;

    try {
      conSesion();
      // El sistema dice "oscuro" y la preferencia del usuario dice "claro":
      // manda el usuario.
      localStorage.setItem('theme', 'light');
      expect(resolveInitialTheme()).toBe('light');
    } finally {
      window.matchMedia = original;
    }
  });

  it('con sesión, alternar aplica la clase y persiste la preferencia', () => {
    conSesion();
    renderToggle();
    const boton = screen.getByRole('button', { name: 'Cambiar tema' });

    act(() => { fireEvent.click(boton); });
    expect(screen.getByTestId('tema')).toHaveTextContent('light');
    expect(document.documentElement).not.toHaveClass('dark');
    expect(localStorage.getItem('theme')).toBe('light');

    act(() => { fireEvent.click(boton); });
    expect(screen.getByTestId('tema')).toHaveTextContent('dark');
    expect(document.documentElement).toHaveClass('dark');
    expect(localStorage.getItem('theme')).toBe('dark');
  });

  it('la preferencia sobrevive a un remontaje mientras haya sesión', () => {
    conSesion();
    const { unmount } = renderToggle();
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Cambiar tema' })); });
    expect(localStorage.getItem('theme')).toBe('light');
    unmount();

    renderToggle();
    expect(screen.getByTestId('tema')).toHaveTextContent('light');
  });

  it('cerrar sesión vuelve al oscuro y olvida la preferencia', () => {
    conSesion();
    renderToggle();
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Cambiar tema' })); });
    expect(screen.getByTestId('tema')).toHaveTextContent('light');

    localStorage.removeItem('token');
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Cerrar sesión' })); });

    expect(screen.getByTestId('tema')).toHaveTextContent('dark');
    expect(document.documentElement).toHaveClass('dark');
    expect(localStorage.getItem('theme')).toBeNull();
  });

  it('sin sesión no escribe preferencia al cambiar de tema', () => {
    renderToggle();
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Cambiar tema' })); });
    expect(localStorage.getItem('theme')).toBeNull();
  });

  it('al guardar en el servidor manda sólo el tema', async () => {
    // Mandar también el idioma leído de localStorage hacía que, al iniciar
    // sesión, una preferencia pisara a la otra en la base de datos.
    conSesion();
    localStorage.setItem('language', 'en');
    renderToggle();
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Cambiar tema' })); });

    await vi.waitFor(() => expect(mockPrefs).toHaveBeenCalled());
    expect(mockPrefs).toHaveBeenCalledWith({ tema: 'light' });
    expect(mockPrefs.mock.calls[0][0]).not.toHaveProperty('idioma');
  });

  it('sin sesión no avisa al servidor', async () => {
    renderToggle();
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Cambiar tema' })); });
    await new Promise(r => setTimeout(r, 20));
    expect(mockPrefs).not.toHaveBeenCalled();
  });
});
