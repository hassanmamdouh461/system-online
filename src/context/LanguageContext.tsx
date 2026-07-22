import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import arTranslations from '../locales/ar.json';
import enTranslations from '../locales/en.json';

type Language = 'en' | 'ar';

interface LanguageContextProps {
  language: Language;
  toggleLanguage: () => void;
  t: (key: string) => string;
  isRtl: boolean;
}

const LanguageContext = createContext<LanguageContextProps | null>(null);

const translations: Record<Language, Record<string, string>> = {
  ar: arTranslations as Record<string, string>,
  en: enTranslations as Record<string, string>,
};

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguage] = useState<Language>(() => {
    try {
      const saved = localStorage.getItem('brewmaster_language');
      if (saved === 'en' || saved === 'ar') return saved;
    } catch {
      // ignore
    }
    return 'ar';
  });

  const toggleLanguage = () => {
    setLanguage(prev => {
      const next = prev === 'ar' ? 'en' : 'ar';
      try {
        localStorage.setItem('brewmaster_language', next);
        void import('../services/settingsCloudService').then((m) =>
          m.persistSetting('brewmaster_language', next)
        );
      } catch {
        // ignore
      }
      return next;
    });
  };

  const t = useCallback((key: string): string => {
    const dict = translations[language];
    if (dict && dict[key]) {
      return dict[key];
    }
    return key;
  }, [language]);

  const isRtl = language === 'ar';

  useEffect(() => {
    // Set HTML dir attribute for RTL support
    document.documentElement.dir = isRtl ? 'rtl' : 'ltr';
    document.documentElement.lang = language;
    if (isRtl) {
      document.body.classList.add('rtl');
    } else {
      document.body.classList.remove('rtl');
    }
  }, [language, isRtl]);

  return (
    <LanguageContext.Provider value={{ language, toggleLanguage, t, isRtl }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return context;
}
