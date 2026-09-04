/* El contexto expone hook y provider para el shell y las pantallas. */
/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

export type Theme = 'dark' | 'light';

interface ThemeContextValue {
  theme: Theme;
  setTheme: (t: Theme) => void;
  toggle: () => void;
  /** Vuelve al tema por defecto y olvida la preferencia local (cierre de sesión). */
  reset: () => void;
}

const STORAGE_KEY = 'theme';
const TOKEN_KEY = 'token';

/** Tema del producto mientras no hay sesión. */
export const DEFAULT_THEME: Theme = 'dark';

const ThemeContext = createContext<ThemeContextValue>({
  theme: DEFAULT_THEME, setTheme: () => {}, toggle: () => {}, reset: () => {},
});

export function useTheme() {
  return useContext(ThemeContext);
}

/**
 * Tema inicial.
 *
 * La preferencia es del usuario, no del dispositivo: `prefers-color-scheme` se
 * ignora a propósito. Sin sesión abierta —login, o justo después de cerrar
 * sesión— el producto arranca siempre en oscuro; con sesión se recupera la
 * preferencia guardada de ese usuario, para no mostrar un parpadeo de tema
 * mientras el backend confirma sus preferencias.
 */
export function resolveInitialTheme(): Theme {
  try {
    if (!localStorage.getItem(TOKEN_KEY)) return DEFAULT_THEME;
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'dark' || stored === 'light') return stored;
  } catch {
    /* Storage bloqueado (modo privado): se usa el tema por defecto. */
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
      // La preferencia sólo se recuerda mientras hay sesión: sin token el tema
      // es el default del producto y no hay nada de quién recordarlo.
      if (localStorage.getItem(TOKEN_KEY)) localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      /* Sin storage el tema sigue funcionando; solo no se recuerda. */
    }
  }, [theme]);

  const setTheme = useCallback((newTheme: Theme) => {
    setThemeState(newTheme);
    // La preferencia también viaja al backend para que siga al usuario entre
    // dispositivos; si falla, el localStorage ya cubrió el caso local.
    import('../services/api').then(({ updatePreferencias }) => {
      if (localStorage.getItem('token')) {
        // El fallo no rompe la sesión —el tema ya se aplicó y se guardó local—
        // pero sí se anota: un 403 aquí significa que la preferencia no
        // sobrevive al cierre de sesión, y en silencio eso no se nota.
        updatePreferencias({ tema: newTheme }).catch(err => {
          console.warn('[tema] no se pudo guardar la preferencia en el servidor:', err);
        });
      }
    }).catch(() => {});
  }, []);

  const toggle = useCallback(() => setTheme(theme === 'dark' ? 'light' : 'dark'), [setTheme, theme]);

  /** Cierre de sesión: se olvida la preferencia local y se vuelve al default.
      No avisa al backend — la preferencia del usuario allí queda intacta y se
      recupera en su próximo login. */
  const reset = useCallback(() => {
    setThemeState(DEFAULT_THEME);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* Sin storage no hay nada que olvidar. */
    }
  }, []);

  const value = useMemo(() => ({ theme, setTheme, toggle, reset }), [theme, setTheme, toggle, reset]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
