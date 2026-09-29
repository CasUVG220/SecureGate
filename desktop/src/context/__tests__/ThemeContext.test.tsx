import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { ThemeProvider, ThemeToggle, resolveInitialTheme } from '../ThemeContext';

describe('ThemeContext (garita)', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove('dark');
  });

  it('arranca en oscuro como la web si nadie eligió', () => {
    expect(resolveInitialTheme()).toBe('dark');
  });

  it('el toggle cambia la clase de <html> y persiste sin depender de la sesión', () => {
    render(<ThemeProvider><ThemeToggle /></ThemeProvider>);
    expect(document.documentElement.classList.contains('dark')).toBe(true);

    act(() => screen.getByRole('button', { name: /tema claro/i }).click());
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(localStorage.getItem('theme')).toBe('light');
    // No hay token de sesión en storage y aun así se recuerda: es del equipo.
    expect(localStorage.getItem('token')).toBeNull();
    expect(resolveInitialTheme()).toBe('light');
  });
});
