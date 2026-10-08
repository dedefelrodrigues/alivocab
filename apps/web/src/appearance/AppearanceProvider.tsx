import { DEFAULT_TARGET_LANG } from '@alivocab/shared';
import {
  APPEARANCE_STORAGE_KEY,
  COLOR_MODES,
  type ColorMode,
  getPalette,
  oklchToHex,
  type PaletteSetting,
  type ResolvedMode,
  resolveMode,
  resolvePalette,
} from '@alivocab/shared/appearance';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

type AppearanceState = {
  /** What the user chose: `'auto'` or a preset id. */
  paletteSetting: PaletteSetting;
  mode: ColorMode;
  /** Target language of the signed-in user. It drives the `auto` palette. */
  targetLang: string;
};

type AppearanceContextValue = AppearanceState & {
  /** The palette actually applied (never `'auto'`). */
  palette: string;
  resolvedMode: ResolvedMode;
  setPaletteSetting: (value: PaletteSetting) => void;
  setMode: (value: ColorMode) => void;
  /** Applies values from the account profile (source of truth once signed in). */
  hydrate: (values: Partial<AppearanceState>) => void;
};

/** Shape persisted to localStorage. It is only a first-paint cache (see index.html). */
type CachedAppearance = AppearanceState & { palette: string };

const AppearanceContext = createContext<AppearanceContextValue | null>(null);

const DARK_QUERY = '(prefers-color-scheme: dark)';

function readCache(): AppearanceState {
  const fallback: AppearanceState = {
    paletteSetting: 'auto',
    mode: 'system',
    targetLang: DEFAULT_TARGET_LANG,
  };
  try {
    const raw = JSON.parse(
      localStorage.getItem(APPEARANCE_STORAGE_KEY) ?? '{}',
    ) as Partial<CachedAppearance>;
    return {
      paletteSetting:
        typeof raw.paletteSetting === 'string' ? raw.paletteSetting : fallback.paletteSetting,
      mode: COLOR_MODES.includes(raw.mode as ColorMode) ? (raw.mode as ColorMode) : fallback.mode,
      targetLang: typeof raw.targetLang === 'string' ? raw.targetLang : fallback.targetLang,
    };
  } catch {
    return fallback;
  }
}

function usePrefersDark(): boolean {
  const [prefersDark, setPrefersDark] = useState(() => window.matchMedia(DARK_QUERY).matches);
  useEffect(() => {
    const mql = window.matchMedia(DARK_QUERY);
    const onChange = (e: MediaQueryListEvent) => setPrefersDark(e.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);
  return prefersDark;
}

/** Keeps `<meta name="theme-color">` (phone status bar / PWA title bar) in sync. */
function syncThemeColor(palette: string, mode: ResolvedMode) {
  const tokens = getPalette(palette)?.[mode];
  if (!tokens) return;
  let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement('meta');
    meta.name = 'theme-color';
    document.head.append(meta);
  }
  meta.content = oklchToHex(tokens.background);
}

/**
 * Applies the palette (`data-palette`) and light/dark mode (`.dark`) on `<html>`.
 * Signed in, the account profile is the source of truth (fed via `hydrate`); the
 * localStorage copy only avoids a flash of wrong colors on the next load (PLAN.md §7.4).
 */
export function AppearanceProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppearanceState>(readCache);
  const prefersDark = usePrefersDark();

  const palette = resolvePalette(state.paletteSetting, state.targetLang);
  const resolvedMode = resolveMode(state.mode, prefersDark);

  useEffect(() => {
    const el = document.documentElement;
    el.dataset.palette = palette;
    el.classList.toggle('dark', resolvedMode === 'dark');
    syncThemeColor(palette, resolvedMode);
    try {
      const cache: CachedAppearance = { ...state, palette };
      localStorage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify(cache));
    } catch {
      // Storage may be unavailable (private mode). Appearance still works for this session.
    }
  }, [state, palette, resolvedMode]);

  const hydrate = useCallback((values: Partial<AppearanceState>) => {
    setState((s) => {
      const next = { ...s, ...values };
      return next.paletteSetting === s.paletteSetting &&
        next.mode === s.mode &&
        next.targetLang === s.targetLang
        ? s
        : next;
    });
  }, []);

  const value = useMemo<AppearanceContextValue>(
    () => ({
      ...state,
      palette,
      resolvedMode,
      setPaletteSetting: (paletteSetting) => setState((s) => ({ ...s, paletteSetting })),
      setMode: (mode) => setState((s) => ({ ...s, mode })),
      hydrate,
    }),
    [state, palette, resolvedMode, hydrate],
  );

  return <AppearanceContext.Provider value={value}>{children}</AppearanceContext.Provider>;
}

export function useAppearance(): AppearanceContextValue {
  const ctx = useContext(AppearanceContext);
  if (!ctx) throw new Error('useAppearance must be used inside <AppearanceProvider>');
  return ctx;
}
