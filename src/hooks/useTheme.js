import { useEffect, useMemo, useState } from 'react';
import { getTheme } from '../lib/theme.js';

const STORAGE_KEY = 'sequoia-lite-theme';

export function useTheme() {
  const [mode, setMode] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) || 'dark';
    } catch {
      return 'dark';
    }
  });

  const theme = useMemo(() => getTheme(mode), [mode]);

  useEffect(() => {
    document.body.style.background = theme.bg;
    document.body.style.color = theme.text;
    try {
      localStorage.setItem(STORAGE_KEY, mode);
    } catch {}

    let meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) {
      meta = document.createElement('meta');
      meta.name = 'theme-color';
      document.head.appendChild(meta);
    }
    meta.content = theme.bg;
  }, [mode, theme]);

  return {
    mode,
    theme,
    toggleMode: () => setMode((prev) => (prev === 'dark' ? 'light' : 'dark')),
    setMode,
  };
}
