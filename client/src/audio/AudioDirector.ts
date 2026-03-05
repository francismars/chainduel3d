import { AudioAssetRegistry } from './AudioAssetRegistry';
import { AudioEngine } from './AudioEngine';
import { AudioEventRouter, type AppAudioState } from './AudioEventRouter';
import { AudioSettingsStore } from './AudioSettingsStore';
import type { AudioDiagnosticsSnapshot, AudioSettingsState } from './types';

export class AudioDirector {
  readonly settingsStore = new AudioSettingsStore();
  readonly registry = new AudioAssetRegistry();
  readonly engine = new AudioEngine(this.registry);
  readonly events = new AudioEventRouter(this.engine);

  private unlockHandlersAttached = false;
  private currentAppState: AppAudioState = 'menu';
  private readonly disabledCueKey = 'chainduel3d.audio.disabledCues.v1';
  private disabledCueIds = new Set<string>();

  async init() {
    this.loadDisabledCues();
    this.engine.applySettings(this.settingsStore.getState());
    for (const cueId of this.disabledCueIds) this.engine.setCueDisabled(cueId, true);
    await this.engine.preloadCritical();
    this.attachUnlockHandlers();
  }

  getSettings(): AudioSettingsState {
    return this.settingsStore.getState();
  }

  updateSettings(patch: Partial<AudioSettingsState>): AudioSettingsState {
    const next = this.settingsStore.update(patch);
    this.engine.applySettings(next);
    return next;
  }

  setAppState(state: AppAudioState) {
    this.currentAppState = state;
    void this.events.onAppStateChanged(state);
  }

  async unlockFromGesture() {
    const ok = await this.engine.unlock();
    if (ok) {
      this.engine.applySettings(this.settingsStore.getState());
      void this.engine.preloadTieredInBackground();
      // Retry the most recent state music after unlock, since earlier
      // autoplay-blocked attempts may have been ignored by the browser.
      void this.events.onAppStateChanged(this.currentAppState);
    }
    return ok;
  }

  async handleVisibilityChange() {
    if (document.visibilityState === 'hidden') {
      await this.engine.suspend();
      return;
    }
    if (document.visibilityState === 'visible') {
      await this.engine.resume();
      this.engine.applySettings(this.settingsStore.getState());
    }
  }

  getDiagnostics(): AudioDiagnosticsSnapshot {
    return this.engine.getDiagnostics();
  }

  getCues() {
    return this.registry.getAllCues();
  }

  setCueDisabled(cueId: string, disabled: boolean) {
    this.engine.setCueDisabled(cueId, disabled);
    if (disabled) this.disabledCueIds.add(cueId);
    else this.disabledCueIds.delete(cueId);
    this.saveDisabledCues();
  }

  isCueDisabled(cueId: string): boolean {
    return this.engine.isCueDisabled(cueId);
  }

  private attachUnlockHandlers() {
    if (this.unlockHandlersAttached) return;
    this.unlockHandlersAttached = true;
    const tryUnlock = () => {
      void this.unlockFromGesture();
    };
    window.addEventListener('pointerdown', tryUnlock, { passive: true });
    window.addEventListener('keydown', tryUnlock, { passive: true });
    document.addEventListener('visibilitychange', () => {
      void this.handleVisibilityChange();
    });
  }

  private loadDisabledCues() {
    try {
      const raw = window.localStorage.getItem(this.disabledCueKey);
      if (!raw) return;
      const parsed = JSON.parse(raw) as string[];
      if (!Array.isArray(parsed)) return;
      this.disabledCueIds = new Set(parsed.filter(x => typeof x === 'string'));
    } catch {
      this.disabledCueIds = new Set();
    }
  }

  private saveDisabledCues() {
    try {
      window.localStorage.setItem(this.disabledCueKey, JSON.stringify(Array.from(this.disabledCueIds)));
    } catch {
      // Ignore storage issues.
    }
  }
}
