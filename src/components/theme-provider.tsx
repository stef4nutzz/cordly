'use client';

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from 'react';

export type ThemeOption = 'oled' | 'dark' | 'light' | 'system';
export type ResolvedTheme = Exclude<ThemeOption, 'system'>;

const STORAGE_KEY = 'cordly-theme';
const THEME_CHANGE_EVENT = 'cordly-theme-change';
const validThemes: ThemeOption[] = ['oled', 'dark', 'light', 'system'];
let volatileTheme: ThemeOption | null = null;

function getStoredTheme(): ThemeOption {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return validThemes.includes(stored as ThemeOption)
      ? (stored as ThemeOption)
      : (volatileTheme ?? 'oled');
  } catch {
    return volatileTheme ?? 'oled';
  }
}

function listenToThemeChanges(callback: () => void) {
  window.addEventListener('storage', callback);
  window.addEventListener(THEME_CHANGE_EVENT, callback);
  return () => {
    window.removeEventListener('storage', callback);
    window.removeEventListener(THEME_CHANGE_EVENT, callback);
  };
}

function getSystemTheme(): ResolvedTheme {
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

function listenToSystemThemeChanges(callback: () => void) {
  const media = window.matchMedia('(prefers-color-scheme: light)');
  media.addEventListener('change', callback);
  return () => media.removeEventListener('change', callback);
}

const ThemeContext = createContext<{
  theme: ThemeOption;
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: ThemeOption) => void;
} | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const theme = useSyncExternalStore<ThemeOption>(
    listenToThemeChanges,
    getStoredTheme,
    (): ThemeOption => 'oled',
  );
  const systemTheme = useSyncExternalStore<ResolvedTheme>(
    listenToSystemThemeChanges,
    getSystemTheme,
    (): ResolvedTheme => 'dark',
  );
  const resolvedTheme: ResolvedTheme =
    theme === 'system' ? systemTheme : theme === 'oled' ? 'oled' : theme;

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = resolvedTheme;
    root.style.colorScheme = resolvedTheme === 'light' ? 'light' : 'dark';
  }, [resolvedTheme]);

  const value = useMemo(
    () => ({
      theme,
      resolvedTheme,
      setTheme(nextTheme: ThemeOption) {
        try {
          window.localStorage.setItem(STORAGE_KEY, nextTheme);
        } catch {
          volatileTheme = nextTheme;
        }
        window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
      },
    }),
    [resolvedTheme, theme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const value = useContext(ThemeContext);
  if (!value) throw new Error('useTheme must be used inside ThemeProvider.');
  return value;
}
