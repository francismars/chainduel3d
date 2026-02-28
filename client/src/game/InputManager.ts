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

export class InputManager {
  private keys = new Set<string>();
  private itemJustPressed: boolean[] = [false, false, false, false];
  private sacrificeJustPressed: boolean[] = [false, false, false, false];

  constructor() {
    window.addEventListener('keydown', (e) => {
      this.keys.add(e.code);
      for (let i = 0; i < 4; i++) {
        if (e.code === PLAYER_KEYS[i].useItem) this.itemJustPressed[i] = true;
        if (e.code === PLAYER_KEYS[i].sacrificeBoost) this.sacrificeJustPressed[i] = true;
      }
      e.preventDefault();
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
    });
  }

  getInput(playerIndex: number): PlayerInput {
    const mapping = PLAYER_KEYS[playerIndex];
    return {
      forward: this.keys.has(mapping.forward),
      backward: this.keys.has(mapping.backward),
      left: this.keys.has(mapping.left),
      right: this.keys.has(mapping.right),
      useItem: this.keys.has(mapping.useItem),
      lookBack: this.keys.has(mapping.lookBack),
      drift: this.keys.has(mapping.drift),
      sacrificeBoost: this.keys.has(mapping.sacrificeBoost),
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
}
