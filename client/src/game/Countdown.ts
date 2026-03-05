import { GAME_CONFIG } from 'shared/types';
import { HUD } from './HUD';

export class Countdown {
  private hud: HUD;
  private count: number;
  private timer = 0;
  private started = false;
  private onCountChanged?: (count: number) => void;
  public finished = false;

  constructor(hud: HUD, onCountChanged?: (count: number) => void) {
    this.hud = hud;
    this.count = GAME_CONFIG.COUNTDOWN_SECONDS;
    this.onCountChanged = onCountChanged;
  }

  start() {
    this.started = true;
    this.count = GAME_CONFIG.COUNTDOWN_SECONDS;
    this.timer = 0;
    this.finished = false;
    this.hud.showCountdown(this.count);
    this.onCountChanged?.(this.count);
  }

  update(dt: number) {
    if (!this.started || this.finished) return;

    this.timer += dt;
    if (this.timer >= 1) {
      this.timer -= 1;
      this.count--;

      if (this.count > 0) {
        this.hud.showCountdown(this.count);
        this.onCountChanged?.(this.count);
      } else if (this.count === 0) {
        this.hud.showCountdown(0);
        this.onCountChanged?.(0);
        this.finished = true;
        this.started = false;
      }
    }
  }

  show(count: number) {
    this.started = false;
    this.finished = false;
    this.hud.showCountdown(count);
    this.onCountChanged?.(count);
  }

  hide() {
    this.started = false;
    this.finished = false;
    this.hud.hideCountdown();
  }
}
