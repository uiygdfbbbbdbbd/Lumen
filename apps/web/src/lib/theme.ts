import { create } from 'zustand';
import {
  BUILTIN_THEMES,
  DEFAULT_DARK_THEME_ID,
  DEFAULT_LIGHT_THEME_ID,
  getBuiltinTheme,
  themeSchema,
  themeToCssVars,
  type Theme,
} from '@lumen/shared';

export type ThemeMode = 'light' | 'dark' | 'system' | 'time';

export interface ThemePrefs {
  mode: ThemeMode;
  lightThemeId: string;
  darkThemeId: string;
  /** Custom themes saved locally (synced to the account once the theme module ships). */
  custom: Record<string, Theme>;
  /** Hours for time-based switching. */
  dayStartHour: number;
  nightStartHour: number;
}

const STORAGE_KEY = 'lumen.theme.prefs';
const VARS_KEY = 'lumen.theme.vars';

const DEFAULTS: ThemePrefs = { mode: 'system', lightThemeId: DEFAULT_LIGHT_THEME_ID, darkThemeId: DEFAULT_DARK_THEME_ID, custom: {}, dayStartHour: 7, nightStartHour: 19 };

function load(): ThemePrefs {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Partial<ThemePrefs>;
    const custom: Record<string, Theme> = {};
    for (const [id, t] of Object.entries(raw.custom ?? {})) {
      const parsed = themeSchema.safeParse(t);
      if (parsed.success) custom[id] = parsed.data;
    }
    return { ...DEFAULTS, ...raw, custom };
  } catch {
    return DEFAULTS;
  }
}

export function resolveTheme(prefs: ThemePrefs, opts: { systemDark: boolean; hour: number }): { id: string; theme: Theme } {
  let dark: boolean;
  if (prefs.mode === 'light') dark = false;
  else if (prefs.mode === 'dark') dark = true;
  else if (prefs.mode === 'time') dark = opts.hour < prefs.dayStartHour || opts.hour >= prefs.nightStartHour;
  else dark = opts.systemDark;
  const id = dark ? prefs.darkThemeId : prefs.lightThemeId;
  const theme = prefs.custom[id] ?? getBuiltinTheme(id) ?? getBuiltinTheme(dark ? DEFAULT_DARK_THEME_ID : DEFAULT_LIGHT_THEME_ID)!;
  return { id, theme };
}

export function applyTheme(theme: Theme, root: HTMLElement = document.documentElement) {
  const vars = themeToCssVars(theme);
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
  root.dataset.theme = theme.mode;
  root.style.colorScheme = theme.mode;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme.colors.background);
  try {
    localStorage.setItem(VARS_KEY, JSON.stringify(vars));
  } catch {
    /* storage full or disabled: theme still applies for this session */
  }
}

interface ThemeStore extends ThemePrefs {
  set: (patch: Partial<ThemePrefs>) => void;
  saveCustom: (id: string, theme: Theme) => void;
  deleteCustom: (id: string) => void;
  /** Temporarily show a theme without saving (previews in onboarding / builder). */
  preview: (theme: Theme | null) => void;
  previewing: Theme | null;
}

export const useThemeStore = create<ThemeStore>((set, get) => ({
  ...load(),
  previewing: null,
  set: (patch) => {
    set(patch);
    persist(get());
  },
  saveCustom: (id, theme) => {
    set({ custom: { ...get().custom, [id]: themeSchema.parse(theme) } });
    persist(get());
  },
  deleteCustom: (id) => {
    const { [id]: _drop, ...rest } = get().custom;
    const p = get();
    set({
      custom: rest,
      lightThemeId: p.lightThemeId === id ? DEFAULT_LIGHT_THEME_ID : p.lightThemeId,
      darkThemeId: p.darkThemeId === id ? DEFAULT_DARK_THEME_ID : p.darkThemeId,
    });
    persist(get());
  },
  preview: (theme) => set({ previewing: theme }),
}));

function persist(s: ThemePrefs) {
  const { mode, lightThemeId, darkThemeId, custom, dayStartHour, nightStartHour } = s;
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ mode, lightThemeId, darkThemeId, custom, dayStartHour, nightStartHour }));
}

/** Keep the document in sync with preferences, the OS color scheme and the clock. */
export function startThemeEngine(): () => void {
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const render = () => {
    const s = useThemeStore.getState();
    const { theme } = s.previewing ? { theme: s.previewing } : resolveTheme(s, { systemDark: mq.matches, hour: new Date().getHours() });
    applyTheme(theme);
  };
  render();
  const unsub = useThemeStore.subscribe(render);
  mq.addEventListener('change', render);
  const timer = window.setInterval(() => useThemeStore.getState().mode === 'time' && render(), 60_000);
  return () => {
    unsub();
    mq.removeEventListener('change', render);
    window.clearInterval(timer);
  };
}

export const ALL_BUILTIN_THEMES = BUILTIN_THEMES;
