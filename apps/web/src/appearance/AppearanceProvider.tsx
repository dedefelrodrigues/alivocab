import { DEFAULT_TARGET_LANG } from '@alivocab/shared';
import {
  APPEARANCE_STORAGE_KEY,
  COLOR_MODES,
  type ColorMode,
  type PaletteSetting,
  type ResolvedMode,
  resolveMode,
  resolvePalette,
} from '@alivocab/shared/appearance';
import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from 'react';

type AppearanceState = {
  /** What the user chose: `'auto'` or a preset id. */
  paletteSetting: PaletteSetting;
  mode: ColorMode;
};

type AppearanceContextValue = AppearanceState & {
  /** The palette actually applied (never `'auto'`). */
  palette: string;
  resolvedMode: ResolvedMode;
  setPaletteSetting: (value: PaletteSetting) => void;
  setMode: (value: ColorMode) => void;
};

/** Shape persisted to localStorage. It is only a first-paint cache. */
type CachedAppearance = AppearanceState & { palette: string };

const AppearanceContext = createContext<AppearanceContextValue | null>(null);

const DARK_QUERY = '(prefers-color-scheme: dark)';

function readCache(): AppearanceState {
  try {
    const raw = JSON.parse(
      localStorage.getItem(APPEARANCE_STORAGE_KEY) ?? '{}',
    ) as Partial<CachedAppearance>;
    return {
      paletteSetting: typeof raw.paletteSetting === 'string' ? raw.paletteSetting : 'auto',
      mode: COLOR_MODES.includes(raw.mode as ColorMode) ? (raw.mode as ColorMode) : 'system',
    };
  } catch {
    return { paletteSetting: 'auto', mode: 'system' };
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

type AppearanceProviderProps = {
  children: ReactNode;
  /** Target language of the signed-in user. It drives the `auto` palette. */
  targetLang?: string;
};

/**
 * Applies the palette (`data-palette`) and light/dark mode (`.dark`) on `<html>`.
 * Phase 0 keeps state locally. From Phase 1 the account profile is the source of truth and
 * this provider is fed from `/api/me` (see PLAN.md §7.4).
 */
export function AppearanceProvider({
  children,
  targetLang = DEFAULT_TARGET_LANG,
}: AppearanceProviderProps) {
  const [state, setState] = useState<AppearanceState>(readCache);
  const prefersDark = usePrefersDark();

  const palette = resolvePalette(state.paletteSetting, targetLang);
  const resolvedMode = resolveMode(state.mode, prefersDark);

  useEffect(() => {
    const el = document.documentElement;
    el.dataset.palette = palette;
    el.classList.toggle('dark', resolvedMode === 'dark');
    try {
      const cache: CachedAppearance = { ...state, palette };
      localStorage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify(cache));
    } catch {
      // Storage may be unavailable (private mode). Appearance still works for this session.
    }
  }, [state, palette, resolvedMode]);

  const value = useMemo<AppearanceContextValue>(
    () => ({
      ...state,
      palette,
      resolvedMode,
      setPaletteSetting: (paletteSetting) => setState((s) => ({ ...s, paletteSetting })),
      setMode: (mode) => setState((s) => ({ ...s, mode })),
    }),
    [state, palette, resolvedMode],
  );

  return <AppearanceContext.Provider value={value}>{children}</AppearanceContext.Provider>;
}

export function useAppearance(): AppearanceContextValue {
  const ctx = useContext(AppearanceContext);
  if (!ctx) throw new Error('useAppearance must be used inside <AppearanceProvider>');
  return ctx;
}
