import type { AudioSettingsState, DynamicRangeMode } from './types';

const SETTINGS_KEY = 'chainduel3d.audio.settings.v1';

const clamp01 = (value: number): number => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 1));

const normalizeDynamicRangeMode = (value: unknown): DynamicRangeMode => {
  if (value === 'low' || value === 'medium') return value;
  return 'full';
};

const defaults: AudioSettingsState = {
  masterVolume: 0.9,
  musicVolume: 0.7,
  sfxGameplayVolume: 0.95,
  sfxUiVolume: 0.8,
  ambienceVolume: 0.6,
  masterMuted: false,
  reducedSensoryMode: false,
  dynamicRangeMode: 'full',
};

export class AudioSettingsStore {
  private state: AudioSettingsState;

  constructor() {
    this.state = this.readFromStorage();
  }

  getState(): AudioSettingsState {
    return { ...this.state };
  }

  update(patch: Partial<AudioSettingsState>): AudioSettingsState {
    this.state = this.normalizeState({ ...this.state, ...patch });
    this.writeToStorage(this.state);
    return this.getState();
  }

  private readFromStorage(): AudioSettingsState {
    try {
      const raw = window.localStorage.getItem(SETTINGS_KEY);
      if (!raw) return { ...defaults };
      const parsed = JSON.parse(raw) as Partial<AudioSettingsState>;
      return this.normalizeState({ ...defaults, ...parsed });
    } catch {
      return { ...defaults };
    }
  }

  private writeToStorage(state: AudioSettingsState) {
    try {
      window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(state));
    } catch {
      // Ignore storage quota/errors; audio still works with runtime defaults.
    }
  }

  private normalizeState(state: AudioSettingsState): AudioSettingsState {
    return {
      masterVolume: clamp01(state.masterVolume),
      musicVolume: clamp01(state.musicVolume),
      sfxGameplayVolume: clamp01(state.sfxGameplayVolume),
      sfxUiVolume: clamp01(state.sfxUiVolume),
      ambienceVolume: clamp01(state.ambienceVolume),
      masterMuted: !!state.masterMuted,
      reducedSensoryMode: !!state.reducedSensoryMode,
      dynamicRangeMode: normalizeDynamicRangeMode(state.dynamicRangeMode),
    };
  }
}
