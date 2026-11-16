import { describe, expect, it } from 'vitest';
import { bi } from './i18n';

describe('bi', () => {
  it('中文 locale 取中文词条', () => {
    expect(bi('zh', 'Dashboard', '总览')).toBe('总览');
  });

  it('英文 locale 取英文词条', () => {
    expect(bi('en', 'Dashboard', '总览')).toBe('Dashboard');
  });

  it('词条可含插值(由调用方拼好)', () => {
    expect(bi('zh', `3 tables`, `3 张表`)).toBe('3 张表');
  });
});
