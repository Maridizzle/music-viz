import { defaultPresetParams, defaultSettings, SETTINGS_VERSION, type Settings } from './Settings';

const KEY = 'music-viz:settings';

/** Load settings, merging saved values over defaults so new fields never break an old save. */
export function loadSettings(): Settings {
  const base = defaultSettings();
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    return base;
  }
  if (!raw) return base;
  try {
    const saved = JSON.parse(raw) as Partial<Settings>;
    // On a version bump, reset the audio tuning to the new (snappier) defaults but
    // keep the user's visual choices and per-preset params.
    const audio = saved.version === SETTINGS_VERSION ? { ...base.audio, ...saved.audio } : base.audio;
    return {
      version: SETTINGS_VERSION,
      audio,
      visual: { ...base.visual, ...saved.visual },
      presetParams: mergePresetParams(base.presetParams, saved.presetParams),
    };
  } catch {
    return base;
  }
}

function mergePresetParams(
  base: Settings['presetParams'],
  saved: Settings['presetParams'] | undefined,
): Settings['presetParams'] {
  const out = defaultPresetParams();
  for (const id of Object.keys(base)) {
    out[id] = { ...base[id], ...(saved?.[id] ?? {}) };
  }
  return out;
}

let timer: ReturnType<typeof setTimeout> | null = null;

/** Debounced persistence. */
export function saveSettings(settings: Settings): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(settings));
    } catch {
      /* storage unavailable (private mode / disabled) — ignore */
    }
  }, 300);
}

export function clearSettings(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
