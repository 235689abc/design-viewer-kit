export type DiagramLocale = 'zh' | 'en';

export function dl(locale: DiagramLocale, en: string, zh: string): string {
  return locale === 'zh' ? zh : en;
}
