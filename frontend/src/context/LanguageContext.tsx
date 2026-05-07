import { createContext, useContext, useState } from 'react';

export type LangKey = 'es' | 'en';

interface LanguageContextValue {
  language: LangKey;
  setLanguage: (l: LangKey) => void;
}

const LanguageContext = createContext<LanguageContextValue>({
  language: 'es',
  setLanguage: () => {},
});

export function useLanguage() {
  return useContext(LanguageContext);
}

export { LanguageContext };

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [language, setLang] = useState<LangKey>(() => {
    return (localStorage.getItem('language') as LangKey | null) ?? 'es';
  });

  const setLanguage = (l: LangKey) => {
    setLang(l);
    localStorage.setItem('language', l);
    import('../services/api').then(({ updatePreferencias }) => {
      const currentTheme = localStorage.getItem('theme') || 'dark';
      if (localStorage.getItem('token')) {
        updatePreferencias(l, currentTheme).catch(() => {});
      }
    });
  };

  return (
    <LanguageContext.Provider value={{ language, setLanguage }}>
      {children}
    </LanguageContext.Provider>
  );
}
