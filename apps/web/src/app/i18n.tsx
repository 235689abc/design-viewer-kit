import { createContext, useContext, useState, type ReactNode } from 'react';

export type Locale = 'zh' | 'en';

const LOCALE_STORAGE_KEY = 'scaffold_locale';

export function getInitialLocale(): Locale {
  try {
    const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    if (stored === 'zh' || stored === 'en') {
      return stored;
    }
  } catch {
    // localStorage 不可用时按默认语言
  }
  return 'zh';
}

const LocaleContext = createContext<Locale>('zh');
const SetLocaleContext = createContext<(locale: Locale) => void>(() => undefined);

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(getInitialLocale);

  const setLocale = (next: Locale) => {
    setLocaleState(next);
    try {
      window.localStorage.setItem(LOCALE_STORAGE_KEY, next);
    } catch {
      // 忽略持久化失败,仅本次会话生效
    }
  };

  return (
    <LocaleContext.Provider value={locale}>
      <SetLocaleContext.Provider value={setLocale}>
        {children}
      </SetLocaleContext.Provider>
    </LocaleContext.Provider>
  );
}

export function useLocale(): readonly [Locale, (locale: Locale) => void] {
  return [useContext(LocaleContext), useContext(SetLocaleContext)];
}

export function useLocaleValue(): Locale {
  return useContext(LocaleContext);
}

/** 双语词条:按当前 locale 取一,消灭「EN / 中文」逐词堆叠 */
export function bi(locale: Locale, en: string, zh: string): string {
  return locale === 'zh' ? zh : en;
}
