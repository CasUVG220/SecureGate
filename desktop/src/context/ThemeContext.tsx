/**
 * Tema claro/oscuro. Misma mecánica que frontend/src/context/ThemeContext.tsx
 * (clase `dark` en <html>, mismo default oscuro, mismo toggle) con una
 * diferencia deliberada: la preferencia es DEL EQUIPO, no del usuario.
 *
 * En la web el tema sigue a la cuenta (se guarda en el perfil y sólo se
 * recuerda mientras hay sesión). Una garita es un puesto compartido por
 * varios agentes por turno: si el tema cambiara con cada login, la pantalla
 * parpadearía entre turnos y nadie sabría por qué. Aquí se guarda en el
 * localStorage del WebView (persistente entre arranques) y sobrevive al
 * cierre de sesión.
 */
/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

export type Theme = 'dark' | 'light';

interface ThemeContextValue {
  theme: Theme;
  setTheme: (t: Theme) => void;
  toggle: () => void;
}

const STORAGE_KEY = 'theme';

/** Tema del producto mientras nadie ha elegido: el mismo que la web. */
export const DEFAULT_THEME: Theme = 'dark';

const ThemeContext = createContext<ThemeContextValue>({
  theme: DEFAULT_THEME, setTheme: () => {}, toggle: () => {},
});

export function useTheme() {
  return useContext(ThemeContext);
}

export function resolveInitialTheme(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'dark' || stored === 'light') return stored;
  } catch {
    /* Storage bloqueado: se usa el tema por defecto. */
  }
  return DEFAULT_THEME;
}

export function applyTheme(theme: Theme): void {
  document.documentElement.classList.toggle('dark', theme === 'dark');
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(resolveInitialTheme);

  useEffect(() => {
    applyTheme(theme);
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      /* Sin storage el tema sigue funcionando; solo no se recuerda. */
    }
  }, [theme]);

  const setTheme = useCallback((t: Theme) => setThemeState(t), []);
  const toggle = useCallback(() => setThemeState(t => (t === 'dark' ? 'light' : 'dark')), []);

  const value = useMemo(() => ({ theme, setTheme, toggle }), [theme, setTheme, toggle]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/** Botón sol/luna del header, idéntico al de la web. */
export function ThemeToggle({ className }: { className?: string }) {
  const { theme, toggle } = useTheme();
  const label = theme === 'dark' ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro';
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={label}
      title={label}
      className={`flex h-9 w-9 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-500/12 hover:text-gray-50 ${className ?? ''}`}
    >
      {theme === 'dark' ? (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="5" /><path d="M12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4" />
        </svg>
      ) : (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
      )}
    </button>
  );
}
