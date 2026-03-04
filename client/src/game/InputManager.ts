export interface PlayerInput {
  forward: boolean;
  backward: boolean;
  left: boolean;
  right: boolean;
  useItem: boolean;
  lookBack: boolean;
  drift: boolean;
  sacrificeBoost: boolean;
}

const PLAYER_KEYS = [
  { // P1: WASD
    forward: 'KeyW',
    backward: 'KeyS',
    left: 'KeyA',
    right: 'KeyD',
    useItem: 'Space',
    lookBack: 'KeyQ',
    drift: 'ShiftLeft',
    sacrificeBoost: 'KeyE',
  },
  { // P2: Arrows
    forward: 'ArrowUp',
    backward: 'ArrowDown',
    left: 'ArrowLeft',
    right: 'ArrowRight',
    useItem: 'Enter',
    lookBack: 'ShiftRight',
    drift: 'Numpad0',
    sacrificeBoost: 'NumpadDecimal',
  },
  { // P3: IJKL
    forward: 'KeyI',
    backward: 'KeyK',
    left: 'KeyJ',
    right: 'KeyL',
    useItem: 'KeyO',
    lookBack: 'KeyU',
    drift: 'KeyP',
    sacrificeBoost: 'KeyY',
  },
  { // P4: Numpad 8456
    forward: 'Numpad8',
    backward: 'Numpad5',
    left: 'Numpad4',
    right: 'Numpad6',
    useItem: 'NumpadAdd',
    lookBack: 'Numpad7',
    drift: 'NumpadEnter',
    sacrificeBoost: 'Numpad9',
  },
];

const MOBILE_LEFT_HANDED_KEY = 'blockkart_mobile_left_handed';
const MOBILE_CONTROL_SCALE_KEY = 'blockkart_mobile_control_scale';
const MOBILE_CONTROL_OPACITY_KEY = 'blockkart_mobile_control_opacity';

export class InputManager {
  private keys = new Set<string>();
  private itemJustPressed: boolean[] = [false, false, false, false];
  private sacrificeJustPressed: boolean[] = [false, false, false, false];
  private container: HTMLElement | null = null;
  private mobileEnabled = false;
  private mobileOverlay: HTMLDivElement | null = null;
  private mobileLeftZone: HTMLDivElement | null = null;
  private mobileSteerBase: HTMLDivElement | null = null;
  private mobileSteerNub: HTMLDivElement | null = null;
  private mobileSteerPointerId: number | null = null;
  private mobileSteerStartX = 0;
  private mobileSteerStartY = 0;
  private mobileSteerX = 0;
  private mobileSteerY = 0;
  private mobileDriftPressed = false;
  private mobileItemPressed = false;
  private mobileSacrificePressed = false;
  private mobileLookBackPressed = false;
  private mobileLeftHanded = false;
  private mobileControlScale = 1;
  private mobileControlOpacity = 0.62;
  private readonly onKeyDownBound: (e: KeyboardEvent) => void;
  private readonly onKeyUpBound: (e: KeyboardEvent) => void;

  constructor(container?: HTMLElement) {
    this.container = container ?? null;
    this.onKeyDownBound = (e: KeyboardEvent) => {
      this.keys.add(e.code);
      for (let i = 0; i < 4; i++) {
        if (e.code === PLAYER_KEYS[i].useItem) this.itemJustPressed[i] = true;
        if (e.code === PLAYER_KEYS[i].sacrificeBoost) this.sacrificeJustPressed[i] = true;
      }
      e.preventDefault();
    };
    this.onKeyUpBound = (e: KeyboardEvent) => {
      this.keys.delete(e.code);
    };

    window.addEventListener('keydown', this.onKeyDownBound);
    window.addEventListener('keyup', this.onKeyUpBound);

    if (this.shouldEnableMobileControls()) {
      this.mobileEnabled = true;
      this.setupMobileControls();
    }
  }

  getInput(playerIndex: number): PlayerInput {
    const mapping = PLAYER_KEYS[playerIndex];
    const keyboardForward = this.keys.has(mapping.forward);
    const keyboardBackward = this.keys.has(mapping.backward);
    const keyboardLeft = this.keys.has(mapping.left);
    const keyboardRight = this.keys.has(mapping.right);
    const mobile = this.getMobileInput(playerIndex);
    return {
      forward: keyboardForward || mobile.forward,
      backward: keyboardBackward || mobile.backward,
      left: keyboardLeft || mobile.left,
      right: keyboardRight || mobile.right,
      useItem: this.keys.has(mapping.useItem) || mobile.useItem,
      lookBack: this.keys.has(mapping.lookBack) || mobile.lookBack,
      drift: this.keys.has(mapping.drift) || mobile.drift,
      sacrificeBoost: this.keys.has(mapping.sacrificeBoost) || mobile.sacrificeBoost,
    };
  }

  consumeItemPress(playerIndex: number): boolean {
    const pressed = this.itemJustPressed[playerIndex];
    this.itemJustPressed[playerIndex] = false;
    return pressed;
  }

  consumeSacrificePress(playerIndex: number): boolean {
    const pressed = this.sacrificeJustPressed[playerIndex];
    this.sacrificeJustPressed[playerIndex] = false;
    return pressed;
  }

  dispose() {
    window.removeEventListener('keydown', this.onKeyDownBound);
    window.removeEventListener('keyup', this.onKeyUpBound);
    this.mobileOverlay?.remove();
    this.mobileOverlay = null;
    this.mobileLeftZone = null;
    this.mobileSteerPointerId = null;
  }

  private shouldEnableMobileControls(): boolean {
    if (typeof window === 'undefined') return false;
    const coarsePointer = typeof window.matchMedia === 'function'
      ? window.matchMedia('(pointer: coarse)').matches
      : false;
    return coarsePointer || window.innerWidth <= 900;
  }

  private setupMobileControls() {
    if (!this.container || this.mobileOverlay) return;
    this.loadMobilePreferences();

    const root = document.createElement('div');
    root.id = 'mobile-controls-overlay';
    root.style.cssText = `
      position:absolute; inset:0; z-index:70; pointer-events:none;
      touch-action:none; user-select:none; -webkit-user-select:none;
    `;

    const leftZone = document.createElement('div');
    leftZone.style.cssText = `
      position:absolute; bottom:0; width:58%; height:62%;
      pointer-events:auto; touch-action:none;
    `;
    root.appendChild(leftZone);
    this.mobileLeftZone = leftZone;

    const steerBase = document.createElement('div');
    steerBase.style.cssText = `
      position:absolute; width:${Math.round(120 * this.mobileControlScale)}px; height:${Math.round(120 * this.mobileControlScale)}px;
      border-radius:999px; border:1px solid rgba(255,255,255,0.24);
      background:rgba(10,10,10,0.24); opacity:0;
      transition:opacity 90ms ease; pointer-events:none;
      transform:translate(-50%,-50%);
    `;
    const steerNub = document.createElement('div');
    steerNub.style.cssText = `
      position:absolute; width:${Math.round(54 * this.mobileControlScale)}px; height:${Math.round(54 * this.mobileControlScale)}px;
      border-radius:999px; border:1px solid rgba(255,255,255,0.36);
      background:rgba(255,255,255,0.2); left:50%; top:50%;
      transform:translate(-50%,-50%); pointer-events:none;
    `;
    steerBase.appendChild(steerNub);
    root.appendChild(steerBase);
    this.mobileSteerBase = steerBase;
    this.mobileSteerNub = steerNub;

    const rightWrap = document.createElement('div');
    rightWrap.style.cssText = `
      position:absolute;
      bottom:max(10px, env(safe-area-inset-bottom));
      display:flex; flex-direction:column; align-items:flex-end; gap:8px;
      pointer-events:none;
    `;

    const driftBtn = this.createMobileButton('DRIFT', 86, 86, 'rgba(255,255,255,0.2)', '#ffffff');
    const itemBtn = this.createMobileButton('ITEM', 70, 70, 'rgba(255,255,255,0.18)', '#f1f1f1');
    const sacBtn = this.createMobileButton('SAC', 58, 58, 'rgba(255,255,255,0.16)', '#dddddd');
    const lookBtn = this.createMobileButton('LOOK', 54, 54, 'rgba(255,255,255,0.14)', '#d0d0d0');
    rightWrap.append(driftBtn, itemBtn, sacBtn, lookBtn);
    root.appendChild(rightWrap);

    const controlMiniBar = document.createElement('div');
    controlMiniBar.style.cssText = `
      position:absolute; top:max(8px, env(safe-area-inset-top)); right:max(8px, env(safe-area-inset-right));
      display:flex; gap:6px; pointer-events:none;
    `;
    const handBtn = this.createMobileButton('HAND', 52, 30, 'rgba(8,8,8,0.5)', '#f3f3f3');
    handBtn.style.borderRadius = '7px';
    handBtn.style.fontSize = '10px';
    const viewBtn = this.createMobileButton('HUD', 44, 30, 'rgba(8,8,8,0.5)', '#f3f3f3');
    viewBtn.style.borderRadius = '7px';
    viewBtn.style.fontSize = '10px';
    controlMiniBar.append(handBtn, viewBtn);
    root.appendChild(controlMiniBar);

    this.applyMobileControlDock(leftZone, rightWrap);

    const steerStart = (e: PointerEvent) => {
      if (this.mobileSteerPointerId !== null) return;
      this.mobileSteerPointerId = e.pointerId;
      this.mobileSteerStartX = e.clientX;
      this.mobileSteerStartY = e.clientY;
      this.mobileSteerX = e.clientX;
      this.mobileSteerY = e.clientY;
      this.updateSteeringVisual();
      this.haptic(8);
      e.preventDefault();
    };
    const steerMove = (e: PointerEvent) => {
      if (this.mobileSteerPointerId !== e.pointerId) return;
      this.mobileSteerX = e.clientX;
      this.mobileSteerY = e.clientY;
      this.updateSteeringVisual();
      e.preventDefault();
    };
    const steerEnd = (e: PointerEvent) => {
      if (this.mobileSteerPointerId !== e.pointerId) return;
      this.mobileSteerPointerId = null;
      this.mobileSteerX = this.mobileSteerStartX;
      this.mobileSteerY = this.mobileSteerStartY;
      this.updateSteeringVisual();
      e.preventDefault();
    };

    leftZone.addEventListener('pointerdown', steerStart);
    leftZone.addEventListener('pointermove', steerMove);
    leftZone.addEventListener('pointerup', steerEnd);
    leftZone.addEventListener('pointercancel', steerEnd);
    leftZone.addEventListener('contextmenu', e => e.preventDefault());

    this.bindHoldButton(driftBtn, (pressed) => { this.mobileDriftPressed = pressed; }, 6);
    this.bindTapButton(itemBtn, () => { this.mobileItemPressed = true; }, () => { this.mobileItemPressed = false; }, 12);
    this.bindTapButton(sacBtn, () => { this.mobileSacrificePressed = true; }, () => { this.mobileSacrificePressed = false; }, 10);
    this.bindHoldButton(lookBtn, (pressed) => { this.mobileLookBackPressed = pressed; }, 5);
    this.bindTapButton(handBtn, () => {
      this.mobileLeftHanded = !this.mobileLeftHanded;
      this.saveMobilePreferences();
      this.applyMobileControlDock(leftZone, rightWrap);
    });
    this.bindTapButton(viewBtn, () => {
      const next = this.mobileControlOpacity >= 0.78 ? 0.5 : this.mobileControlOpacity >= 0.62 ? 0.82 : 0.66;
      this.mobileControlOpacity = next;
      this.saveMobilePreferences();
      this.refreshMobileControlOpacity();
    });

    this.container.appendChild(root);
    this.mobileOverlay = root;
    this.refreshMobileControlOpacity();
  }

  private bindHoldButton(button: HTMLButtonElement, onPress: (pressed: boolean) => void, hapticMs = 0) {
    const down = (e: PointerEvent) => {
      button.style.transform = 'scale(0.95)';
      button.style.filter = 'brightness(1.18)';
      onPress(true);
      if (hapticMs > 0) this.haptic(hapticMs);
      e.preventDefault();
    };
    const up = (e: PointerEvent) => {
      button.style.transform = 'scale(1)';
      button.style.filter = 'brightness(1)';
      onPress(false);
      e.preventDefault();
    };
    button.addEventListener('pointerdown', down);
    button.addEventListener('pointerup', up);
    button.addEventListener('pointercancel', up);
    button.addEventListener('pointerleave', up);
    button.addEventListener('contextmenu', e => e.preventDefault());
  }

  private bindTapButton(
    button: HTMLButtonElement,
    onTapDown: () => void,
    onTapUp?: () => void,
    hapticMs = 0,
  ) {
    const down = (e: PointerEvent) => {
      button.style.transform = 'scale(0.93)';
      button.style.filter = 'brightness(1.22)';
      onTapDown();
      if (hapticMs > 0) this.haptic(hapticMs);
      e.preventDefault();
    };
    const up = (e: PointerEvent) => {
      button.style.transform = 'scale(1)';
      button.style.filter = 'brightness(1)';
      if (onTapUp) {
        window.setTimeout(onTapUp, 80);
      }
      e.preventDefault();
    };
    button.addEventListener('pointerdown', down);
    button.addEventListener('pointerup', up);
    button.addEventListener('pointercancel', up);
    button.addEventListener('pointerleave', up);
    button.addEventListener('contextmenu', e => e.preventDefault());
  }

  private createMobileButton(
    text: string,
    w: number,
    h: number,
    background: string,
    color: string,
  ): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = text;
    btn.style.cssText = `
      width:${Math.round(w * this.mobileControlScale)}px; height:${Math.round(h * this.mobileControlScale)}px; border-radius:999px;
      border:1px solid rgba(255,255,255,0.32);
      background:${background}; color:${color};
      font-family:'Courier New', monospace; font-size:12px; font-weight:bold;
      letter-spacing:0.5px; pointer-events:auto; touch-action:none;
      backdrop-filter: blur(2px); transition:transform 65ms ease, filter 65ms ease, opacity 120ms ease;
    `;
    return btn;
  }

  private getMobileInput(playerIndex: number): PlayerInput {
    if (!this.mobileEnabled || playerIndex !== 0) {
      return {
        forward: false,
        backward: false,
        left: false,
        right: false,
        useItem: false,
        lookBack: false,
        drift: false,
        sacrificeBoost: false,
      };
    }

    const steerActive = this.mobileSteerPointerId !== null;
    const dx = this.mobileSteerX - this.mobileSteerStartX;
    const dy = this.mobileSteerY - this.mobileSteerStartY;
    const deadzone = 12;
    const left = steerActive && dx < -deadzone;
    const right = steerActive && dx > deadzone;
    const backward = steerActive && dy > 48;
    const forward = !backward;
    return {
      forward,
      backward,
      left,
      right,
      useItem: this.mobileItemPressed,
      lookBack: this.mobileLookBackPressed,
      drift: this.mobileDriftPressed,
      sacrificeBoost: this.mobileSacrificePressed,
    };
  }

  private updateSteeringVisual() {
    if (!this.mobileSteerBase || !this.mobileSteerNub) return;
    if (this.mobileSteerPointerId === null) {
      this.mobileSteerBase.style.opacity = '0';
      this.mobileSteerNub.style.left = '50%';
      this.mobileSteerNub.style.top = '50%';
      return;
    }
    this.mobileSteerBase.style.opacity = '1';
    this.mobileSteerBase.style.left = `${this.mobileSteerStartX}px`;
    this.mobileSteerBase.style.top = `${this.mobileSteerStartY}px`;
    const max = 34 * this.mobileControlScale;
    const dx = this.mobileSteerX - this.mobileSteerStartX;
    const dy = this.mobileSteerY - this.mobileSteerStartY;
    const clampedX = Math.max(-max, Math.min(max, dx));
    const clampedY = Math.max(-max, Math.min(max, dy));
    this.mobileSteerNub.style.left = `${50 + (clampedX / (120 * this.mobileControlScale)) * 100}%`;
    this.mobileSteerNub.style.top = `${50 + (clampedY / (120 * this.mobileControlScale)) * 100}%`;
  }

  private applyMobileControlDock(leftZone: HTMLDivElement, rightWrap: HTMLDivElement) {
    if (this.mobileLeftHanded) {
      leftZone.style.left = '42%';
      rightWrap.style.left = 'max(10px, env(safe-area-inset-left))';
      rightWrap.style.right = 'auto';
      rightWrap.style.alignItems = 'flex-start';
    } else {
      leftZone.style.left = '0';
      rightWrap.style.right = 'max(10px, env(safe-area-inset-right))';
      rightWrap.style.left = 'auto';
      rightWrap.style.alignItems = 'flex-end';
    }
  }

  private refreshMobileControlOpacity() {
    if (!this.mobileOverlay) return;
    const buttons = this.mobileOverlay.querySelectorAll('button');
    buttons.forEach(b => {
      (b as HTMLButtonElement).style.opacity = this.mobileControlOpacity.toFixed(2);
    });
  }

  private loadMobilePreferences() {
    try {
      this.mobileLeftHanded = localStorage.getItem(MOBILE_LEFT_HANDED_KEY) === '1';
      const scale = Number(localStorage.getItem(MOBILE_CONTROL_SCALE_KEY) ?? '1');
      const opacity = Number(localStorage.getItem(MOBILE_CONTROL_OPACITY_KEY) ?? '0.62');
      this.mobileControlScale = Number.isFinite(scale) ? Math.max(0.82, Math.min(1.3, scale)) : 1;
      this.mobileControlOpacity = Number.isFinite(opacity) ? Math.max(0.35, Math.min(0.92, opacity)) : 0.62;
    } catch {
      this.mobileLeftHanded = false;
      this.mobileControlScale = 1;
      this.mobileControlOpacity = 0.62;
    }
  }

  private saveMobilePreferences() {
    try {
      localStorage.setItem(MOBILE_LEFT_HANDED_KEY, this.mobileLeftHanded ? '1' : '0');
      localStorage.setItem(MOBILE_CONTROL_SCALE_KEY, String(this.mobileControlScale));
      localStorage.setItem(MOBILE_CONTROL_OPACITY_KEY, String(this.mobileControlOpacity));
    } catch {
      // Ignore storage failures.
    }
  }

  private haptic(durationMs: number) {
    const nav = navigator as Navigator & { vibrate?: (pattern: number | number[]) => boolean };
    if (typeof nav.vibrate === 'function') {
      nav.vibrate(durationMs);
    }
  }
}
