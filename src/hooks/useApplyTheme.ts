import { useEffect } from 'react';
import { useThemeStore } from '../store/themeStore';

const THEME_COLORS = { light: '#f6f7f7', dark: '#080a0a' };

/** Applies the persisted theme preference to <html> and follows the OS setting in "system" mode. */
export function useApplyTheme(): void {
  const preference = useThemeStore((s) => s.preference);

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const dark = preference === 'dark' || (preference === 'system' && media.matches);
      document.documentElement.classList.toggle('dark', dark);
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? THEME_COLORS.dark : THEME_COLORS.light);
    };
    apply();
    if (preference !== 'system') return;
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [preference]);
}
