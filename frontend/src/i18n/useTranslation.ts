import { useContext } from 'react';
import { LanguageContext } from '../context/LanguageContext';
import { translations } from './translations';

export function useTranslation() {
  const { language } = useContext(LanguageContext);

  const t = (key: string, fallback?: string): string => {
    return translations[language]?.[key] ?? fallback ?? key;
  };

  return { t, language };
}
