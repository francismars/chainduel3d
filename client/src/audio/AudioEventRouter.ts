import type { OnlineRaceEvent } from 'shared/types';
import type { AudioEngine } from './AudioEngine';

export type AppAudioState = 'menu' | 'lobby' | 'racing' | 'result';
const MUSIC_CUES = ['music_menu_loop', 'music_race_loop'] as const;

export class AudioEventRouter {
  private readonly engine: AudioEngine;
  private activeMusicCue: string | null = null;

  constructor(engine: AudioEngine) {
    this.engine = engine;
  }

  async onAppStateChanged(state: AppAudioState) {
    if (state === 'racing') {
      await this.switchMusic('music_race_loop');
      return;
    }
    await this.switchMusic('music_menu_loop');
  }

  onCountdownTick(count: number) {
    void this.engine.playCue(count <= 0 ? 'countdown_go' : 'countdown_tick');
    if (count <= 0) {
      this.engine.mixer.duckMusic(4, 260);
    }
  }

  onUiHover() {
    void this.engine.playCue('ui_hover');
  }

  onUiClick(action: 'confirm' | 'back' | 'default' = 'default') {
    if (action === 'confirm') {
      void this.engine.playCue('ui_confirm');
      return;
    }
    if (action === 'back') {
      void this.engine.playCue('ui_back');
      return;
    }
    void this.engine.playCue('ui_click');
  }

  onRaceEvent(event: OnlineRaceEvent, localPlayerIndex: number) {
    switch (event.type) {
      case 'lap':
        void this.engine.playCue('lap_pass');
        return;
      case 'finish':
        void this.engine.playCue('finish_stinger');
        return;
      case 'item_used':
        void this.engine.playCue('item_use');
        if (event.targetPlayerIndex === localPlayerIndex) this.engine.mixer.duckMusic(3, 220);
        return;
      case 'steal_hit':
        void this.engine.playCue('chain_steal_hit');
        if (event.targetPlayerIndex === localPlayerIndex) this.engine.mixer.duckMusic(4, 260);
        return;
      case 'sacrifice_boost':
        void this.engine.playCue('item_use');
        return;
      default:
        return;
    }
  }

  onItemPickup() {
    void this.engine.playCue('item_pickup');
  }

  onRaceResult(didLocalWin: boolean) {
    void this.engine.playCue(didLocalWin ? 'win_stinger' : 'loss_stinger');
    this.engine.mixer.duckMusic(4, 320);
  }

  onFinalLapIntensity(active: boolean) {
    if (!active) return;
    void this.engine.playCue('final_lap_alert');
    this.engine.mixer.duckMusic(3, 280);
  }

  private async switchMusic(nextCue: string) {
    for (const cueId of MUSIC_CUES) {
      if (cueId !== nextCue) this.engine.stopCue(cueId);
    }
    if (this.activeMusicCue === nextCue) {
      // If autoplay blocked the first attempt, retrying same cue should still
      // attempt to start playback after unlock.
      await this.engine.playLoop(nextCue);
      return;
    }
    if (this.activeMusicCue) this.engine.stopCue(this.activeMusicCue);
    const started = await this.engine.playLoop(nextCue);
    this.activeMusicCue = started ? nextCue : null;
  }
}
