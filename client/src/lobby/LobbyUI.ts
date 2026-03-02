import { GAME_CONFIG, GameMode } from 'shared/types';
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { ChainClass } from '../game/ChainRider';
import {
  DEFAULT_ROUTE_EDITOR_PARAMS,
  Route,
  RouteControlPoint,
  RouteCustomLayout,
  RouteEditorParams,
  RouteShortcutControlPoint,
} from '../game/Route';

type RouteOption = { id: string; name: string };

export class LobbyUI {
  private container: HTMLElement;
  private routes: RouteOption[] = [{ id: 'default', name: 'Genesis Route' }];
  private onStart: (
    playerNames: string[],
    isAI: boolean[],
    chainClasses: ChainClass[],
    wager: number,
    laps: number,
    skipPayment: boolean,
    routeId: string,
    mode: GameMode,
  ) => void;

  constructor(
    container: HTMLElement,
    onStart: (
      playerNames: string[],
      isAI: boolean[],
      chainClasses: ChainClass[],
      wager: number,
      laps: number,
      skipPayment: boolean,
      routeId: string,
      mode: GameMode,
    ) => void,
  ) {
    this.container = container;
    this.onStart = onStart;
  }

  setRoutes(routes: RouteOption[]) {
    this.routes = routes.length > 0 ? routes : [{ id: 'default', name: 'Genesis Route' }];
  }

  show() {
    this.container.innerHTML = '';

    const wrapper = document.createElement('div');
    wrapper.style.cssText = `
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      width: 100%; height: 100%; background: radial-gradient(circle at center, #080808 0%, #000 70%);
      font-family: 'Courier New', monospace; color: #e8e8e8;
    `;

    // Title with glow
    const title = document.createElement('h1');
    title.textContent = 'CHAINDUEL3D';
    title.style.cssText = `
      font-size: 72px; margin: 0 0 8px 0; letter-spacing: 12px;
      text-shadow: 0 0 28px rgba(255,255,255,0.28), 0 0 70px rgba(255,255,255,0.08);
      animation: pulse 2s ease-in-out infinite;
    `;
    wrapper.appendChild(title);

    const subtitle = document.createElement('div');
    subtitle.textContent = 'ANATOMY OF BITCOIN CHAINS';
    subtitle.style.cssText = `
      font-size: 14px; color: #9f9f9f; margin-bottom: 34px; letter-spacing: 6px;
      text-shadow: 0 0 18px rgba(255,255,255,0.1);
    `;
    wrapper.appendChild(subtitle);

    // Form container
    const form = document.createElement('div');
    form.style.cssText = `
      background: rgba(8,8,8,0.94); border: 1px solid #2a2a2a;
      border-radius: 8px; padding: 30px; width: 420px;
      box-shadow: 0 0 30px rgba(255,255,255,0.05);
    `;

    const makePlayerField = (num: number, id: string, defaultVal: string, defaultAI: boolean) => {
      const group = document.createElement('div');
      group.style.cssText = 'margin-bottom: 12px;';
      const lbl = document.createElement('label');
      lbl.textContent = `PLAYER ${num} NAME`;
      lbl.style.cssText = 'display: block; margin-bottom: 4px; font-size: 12px; color: #8a8a8a;';
      group.appendChild(lbl);

      const row = document.createElement('div');
      row.style.cssText = 'display: flex; align-items: center; gap: 8px;';

      const input = document.createElement('input');
      input.id = id;
      input.type = 'text';
      input.value = defaultVal;
      input.style.cssText = `
        flex: 1; padding: 10px; background: #111; border: 1px solid #333;
        border-radius: 4px; color: #f1f1f1; font-family: 'Courier New', monospace;
        font-size: 16px; outline: none;
      `;
      input.onfocus = () => input.style.borderColor = '#f1f1f1';
      input.onblur = () => input.style.borderColor = '#333';
      row.appendChild(input);

      const aiLabel = document.createElement('label');
      aiLabel.style.cssText = `
        display: flex; align-items: center; gap: 4px;
        font-size: 12px; color: #d7d7d7; cursor: pointer; white-space: nowrap;
      `;
      const aiCheck = document.createElement('input');
      aiCheck.type = 'checkbox';
      aiCheck.id = `${id}_ai`;
      aiCheck.checked = defaultAI;
      aiCheck.style.cssText = 'cursor: pointer; accent-color: #d7d7d7;';
      aiLabel.appendChild(aiCheck);
      aiLabel.appendChild(document.createTextNode('AI'));
      row.appendChild(aiLabel);

      const cls = document.createElement('select');
      cls.id = `${id}_class`;
      cls.style.cssText = `
        background:#0f0f0f;border:1px solid #333;color:#e6e6e6;
        font-size:11px;padding:4px 6px;border-radius:4px;
      `;
      cls.innerHTML = `
        <option value="balanced" selected>BAL</option>
        <option value="light">LGT</option>
        <option value="heavy">HVY</option>
      `;
      row.appendChild(cls);

      group.appendChild(row);
      return group;
    };

    const makeField = (label: string, id: string, defaultVal: string, type = 'text') => {
      const group = document.createElement('div');
      group.style.cssText = 'margin-bottom: 16px;';
      const lbl = document.createElement('label');
      lbl.textContent = label;
      lbl.style.cssText = 'display: block; margin-bottom: 4px; font-size: 12px; color: #8a8a8a;';
      const input = document.createElement('input');
      input.id = id;
      input.type = type;
      input.value = defaultVal;
      input.style.cssText = `
        width: 100%; padding: 10px; background: #111; border: 1px solid #333;
        border-radius: 4px; color: #f1f1f1; font-family: 'Courier New', monospace;
        font-size: 16px; outline: none;
      `;
      input.onfocus = () => input.style.borderColor = '#f1f1f1';
      input.onblur = () => input.style.borderColor = '#333';
      group.appendChild(lbl);
      group.appendChild(input);
      return group;
    };

    form.appendChild(makePlayerField(1, 'p1name', 'Satoshi', false));
    form.appendChild(makePlayerField(2, 'p2name', 'Hal', true));
    form.appendChild(makePlayerField(3, 'p3name', 'Nick', true));
    form.appendChild(makePlayerField(4, 'p4name', 'Wei', true));
    form.appendChild(makeField('LAPS [1-9]', 'laps', String(GAME_CONFIG.TOTAL_LAPS), 'number'));
    form.appendChild(makeField(`WAGER (sats) [${GAME_CONFIG.MIN_WAGER}-${GAME_CONFIG.MAX_WAGER}]`, 'wager', '1000', 'number'));
    const trackSelect = document.createElement('select');
    trackSelect.id = 'route_id';
    trackSelect.style.cssText = `
      width: 100%; padding: 10px; background: #111; border: 1px solid #333;
      border-radius: 4px; color: #f1f1f1; font-family: 'Courier New', monospace;
      font-size: 14px; outline: none;
    `;
    for (const route of this.routes) {
      const opt = document.createElement('option');
      opt.value = route.id;
      opt.textContent = route.name;
      trackSelect.appendChild(opt);
    }
    const trackWrap = document.createElement('div');
    trackWrap.style.cssText = 'margin-bottom: 16px;';
    const trackLabel = document.createElement('label');
    trackLabel.textContent = 'ROUTE';
    trackLabel.style.cssText = 'display: block; margin-bottom: 4px; font-size: 12px; color: #8a8a8a;';
    trackWrap.appendChild(trackLabel);
    trackWrap.appendChild(trackSelect);
    form.appendChild(trackWrap);
    const modeSelect = document.createElement('select');
    modeSelect.id = 'game_mode';
    modeSelect.style.cssText = trackSelect.style.cssText;
    modeSelect.innerHTML = `
      <option value="classic" selected>CLASSIC RACE</option>
      <option value="derby">DERBY MODE</option>
    `;
    const modeWrap = document.createElement('div');
    modeWrap.style.cssText = 'margin-bottom: 16px;';
    const modeLabel = document.createElement('label');
    modeLabel.textContent = 'GAME MODE';
    modeLabel.style.cssText = 'display: block; margin-bottom: 4px; font-size: 12px; color: #8a8a8a;';
    modeWrap.appendChild(modeLabel);
    modeWrap.appendChild(modeSelect);
    form.appendChild(modeWrap);

    // Race button
    const raceBtn = document.createElement('button');
    raceBtn.textContent = 'START CHAIN DUEL';
    raceBtn.style.cssText = `
      width: 100%; padding: 14px; margin-top: 8px;
      background: linear-gradient(135deg, #efefef, #cfcfcf);
      border: none; border-radius: 4px; color: #000; font-weight: bold;
      font-family: 'Courier New', monospace; font-size: 18px;
      cursor: pointer; letter-spacing: 2px;
      transition: transform 0.1s, box-shadow 0.2s;
    `;
    raceBtn.onmouseenter = () => {
      raceBtn.style.transform = 'scale(1.02)';
      raceBtn.style.boxShadow = '0 0 16px rgba(255,255,255,0.35)';
    };
    raceBtn.onmouseleave = () => {
      raceBtn.style.transform = 'scale(1)';
      raceBtn.style.boxShadow = 'none';
    };
    raceBtn.onclick = () => this.handleStart(false);
    form.appendChild(raceBtn);

    // Practice button (skip payment)
    const practiceBtn = document.createElement('button');
    practiceBtn.textContent = 'PRACTICE MODE (no sats)';
    practiceBtn.style.cssText = `
      width: 100%; padding: 10px; margin-top: 12px;
      background: transparent; border: 1px solid #333;
      border-radius: 4px; color: #666; font-family: 'Courier New', monospace;
      font-size: 13px; cursor: pointer; transition: border-color 0.2s, color 0.2s;
    `;
    practiceBtn.onmouseenter = () => {
      practiceBtn.style.borderColor = '#d8d8d8';
      practiceBtn.style.color = '#d8d8d8';
    };
    practiceBtn.onmouseleave = () => {
      practiceBtn.style.borderColor = '#333';
      practiceBtn.style.color = '#666';
    };
    practiceBtn.onclick = () => this.handleStart(true);
    form.appendChild(practiceBtn);

    const watchAiBtn = document.createElement('button');
    watchAiBtn.textContent = 'WATCH AI MATCH (LOCAL)';
    watchAiBtn.style.cssText = `
      width: 100%; padding: 10px; margin-top: 8px;
      background: transparent; border: 1px solid #2f2f2f;
      border-radius: 4px; color: #a9a9a9; font-family: 'Courier New', monospace;
      font-size: 12px; cursor: pointer; transition: border-color 0.2s, color 0.2s;
    `;
    watchAiBtn.onmouseenter = () => {
      watchAiBtn.style.borderColor = '#d8d8d8';
      watchAiBtn.style.color = '#d8d8d8';
    };
    watchAiBtn.onmouseleave = () => {
      watchAiBtn.style.borderColor = '#2f2f2f';
      watchAiBtn.style.color = '#a9a9a9';
    };
    watchAiBtn.onclick = () => this.startAiOnlyLocalWatch();
    form.appendChild(watchAiBtn);

    // Controls info
    const controls = document.createElement('div');
    controls.style.cssText = 'margin-top: 20px; font-size: 11px; color: #555; line-height: 1.6;';
    controls.innerHTML = `
      <div style="color:#f1f1f1;margin-bottom:4px">CONTROLS</div>
      <div>P1: WASD + SPACE (item) + L-SHIFT (drift) + Q (look) + E (sacrifice boost)</div>
      <div>P2: ARROWS + ENTER (item) + NUM0 (drift) + R-SHIFT (look) + NUM . (sacrifice)</div>
      <div>P3: IJKL + O (item) + P (drift) + U (look) + Y (sacrifice boost)</div>
      <div>P4: NUM 8456 + NUM+ (item) + NUM-ENTER (drift) + NUM9 (sacrifice)</div>
    `;
    form.appendChild(controls);

    wrapper.appendChild(form);

    // CSS animation
    const style = document.createElement('style');
    style.textContent = `
      @keyframes pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.82; }
      }
    `;
    wrapper.appendChild(style);

    this.container.appendChild(wrapper);
  }

  private handleStart(skipPayment: boolean) {
    const ids = ['p1name', 'p2name', 'p3name', 'p4name'];
    const defaults = ['Player 1', 'Player 2', 'Player 3', 'Player 4'];
    const names = ids.map((id, i) => (document.getElementById(id) as HTMLInputElement)?.value || defaults[i]);
    const isAI = ids.map(id => (document.getElementById(`${id}_ai`) as HTMLInputElement)?.checked ?? false);
    const chainClasses = ids.map(id => {
      const v = (document.getElementById(`${id}_class`) as HTMLSelectElement)?.value;
      if (v === 'light' || v === 'heavy') return v;
      return 'balanced';
    }) as ChainClass[];
    const lapsRaw = parseInt((document.getElementById('laps') as HTMLInputElement)?.value || String(GAME_CONFIG.TOTAL_LAPS), 10);
    const clampedLaps = Math.max(1, Math.min(9, Number.isFinite(lapsRaw) ? lapsRaw : GAME_CONFIG.TOTAL_LAPS));
    const wager = parseInt((document.getElementById('wager') as HTMLInputElement)?.value || '1000');
    const clampedWager = Math.max(GAME_CONFIG.MIN_WAGER, Math.min(GAME_CONFIG.MAX_WAGER, wager));
    const routeId = (document.getElementById('route_id') as HTMLSelectElement)?.value || 'default';
    const modeRaw = (document.getElementById('game_mode') as HTMLSelectElement)?.value;
    const mode: GameMode = modeRaw === 'derby' ? 'derby' : 'classic';

    this.onStart(names, isAI, chainClasses, clampedWager, clampedLaps, skipPayment, routeId, mode);
  }

  private startAiOnlyLocalWatch() {
    const lapsRaw = parseInt((document.getElementById('laps') as HTMLInputElement)?.value || String(GAME_CONFIG.TOTAL_LAPS), 10);
    const clampedLaps = Math.max(1, Math.min(9, Number.isFinite(lapsRaw) ? lapsRaw : GAME_CONFIG.TOTAL_LAPS));
    const names = ['AI 1', 'AI 2', 'AI 3', 'AI 4'];
    const isAI = [true, true, true, true];
    const chainClasses: ChainClass[] = ['balanced', 'balanced', 'balanced', 'balanced'];
    const routeId = (document.getElementById('route_id') as HTMLSelectElement)?.value || 'default';
    const modeRaw = (document.getElementById('game_mode') as HTMLSelectElement)?.value;
    const mode: GameMode = modeRaw === 'derby' ? 'derby' : 'classic';
    this.onStart(names, isAI, chainClasses, GAME_CONFIG.MIN_WAGER, clampedLaps, true, routeId, mode);
  }

  public showRouteEditor() {
    const modal = document.createElement('div');
    modal.style.cssText = `
      position:absolute; inset:0; z-index:60; display:flex; align-items:center; justify-content:center;
      background:rgba(0,0,0,0.72); font-family:'Courier New', monospace;
    `;

    const card = document.createElement('div');
    card.style.cssText = `
      width: min(760px, 92vw); max-height: 86vh; overflow:auto;
      background:#090909; border:1px solid #2f2f2f; border-radius:8px; padding:16px;
      box-shadow:0 0 36px rgba(255,255,255,0.08); color:#d8d8d8;
    `;

    const title = document.createElement('div');
    title.textContent = 'ROUTE EDITOR (APPLIES TO NEXT DUEL)';
    title.style.cssText = 'font-size:14px;letter-spacing:1px;color:#fff;margin-bottom:10px;';
    card.appendChild(title);

    const params = Route.getEditorParams();
    const controls: Array<{
      key: keyof RouteEditorParams;
      label: string;
      min: number;
      max: number;
      step: number;
    }> = [
      { key: 'numSegments', label: 'Segments', min: 220, max: 720, step: 10 },
      { key: 'baseRadius', label: 'Base Radius', min: 70, max: 170, step: 1 },
      { key: 'radiusWaveA', label: 'Radius Wave A', min: 0, max: 24, step: 0.2 },
      { key: 'radiusWaveB', label: 'Radius Wave B', min: 0, max: 18, step: 0.2 },
      { key: 'radiusWaveC', label: 'Radius Wave C', min: 0, max: 12, step: 0.2 },
      { key: 'loopLiftAmp', label: 'Loop Lift', min: 0, max: 22, step: 0.2 },
      { key: 'undulationA', label: 'Height Wave A', min: 0, max: 6, step: 0.1 },
      { key: 'undulationB', label: 'Height Wave B', min: 0, max: 6, step: 0.1 },
      { key: 'widthBase', label: 'Base Width', min: 8, max: 20, step: 0.2 },
      { key: 'widthWaveA', label: 'Width Wave A', min: 0, max: 4, step: 0.1 },
      { key: 'widthWaveB', label: 'Width Wave B', min: 0, max: 4, step: 0.1 },
    ];

    for (const cfg of controls) {
      const row = document.createElement('div');
      row.style.cssText = 'display:grid;grid-template-columns:130px 1fr 72px;gap:8px;align-items:center;margin-bottom:8px;';
      const lbl = document.createElement('div');
      lbl.textContent = cfg.label;
      lbl.style.cssText = 'font-size:12px;color:#b8b8b8;';

      const input = document.createElement('input');
      input.type = 'range';
      input.min = String(cfg.min);
      input.max = String(cfg.max);
      input.step = String(cfg.step);
      input.value = String(params[cfg.key]);
      input.style.cssText = 'width:100%; accent-color:#d9d9d9;';

      const val = document.createElement('div');
      val.textContent = String(params[cfg.key]);
      val.style.cssText = 'font-size:12px;color:#fff;text-align:right;';
      input.oninput = () => {
        const next = parseFloat(input.value);
        params[cfg.key] = next as never;
        val.textContent = cfg.step >= 1 ? String(Math.round(next)) : next.toFixed(2);
      };

      row.appendChild(lbl);
      row.appendChild(input);
      row.appendChild(val);
      card.appendChild(row);
    }

    const note = document.createElement('div');
    note.textContent = 'Tip: Start with Base Radius and Loop Lift. Changes are saved locally and used on next race start.';
    note.style.cssText = 'margin-top:8px;font-size:11px;color:#7f7f7f;';
    card.appendChild(note);

    const buttons = document.createElement('div');
    buttons.style.cssText = 'display:flex;gap:8px;margin-top:12px;';

    const saveBtn = document.createElement('button');
    saveBtn.textContent = 'SAVE';
    saveBtn.style.cssText = 'flex:1;padding:10px;background:#e5e5e5;color:#000;border:none;border-radius:4px;font-weight:bold;cursor:pointer;';
    saveBtn.onclick = () => {
      params.numSegments = Math.round(params.numSegments);
      Route.setEditorParams(params);
      saveBtn.textContent = 'SAVED';
      setTimeout(() => (saveBtn.textContent = 'SAVE'), 700);
    };

    const resetBtn = document.createElement('button');
    resetBtn.textContent = 'RESET DEFAULT';
    resetBtn.style.cssText = 'flex:1;padding:10px;background:#1a1a1a;color:#cfcfcf;border:1px solid #333;border-radius:4px;cursor:pointer;';
    resetBtn.onclick = () => {
      Route.setEditorParams({ ...DEFAULT_ROUTE_EDITOR_PARAMS });
      modal.remove();
      this.showRouteEditor();
    };

    const closeBtn = document.createElement('button');
    closeBtn.textContent = 'CLOSE';
    closeBtn.style.cssText = 'flex:1;padding:10px;background:transparent;color:#9a9a9a;border:1px solid #333;border-radius:4px;cursor:pointer;';
    closeBtn.onclick = () => modal.remove();

    buttons.appendChild(saveBtn);
    buttons.appendChild(resetBtn);
    buttons.appendChild(closeBtn);
    card.appendChild(buttons);

    modal.appendChild(card);
    this.container.appendChild(modal);
  }

  private defaultCustomLayout(): RouteCustomLayout {
    return {
      layoutType: 'loop',
      arenaShape: 'circle',
      arenaRadiusX: 84,
      arenaRadiusZ: 74,
      arenaFloorY: 4,
      arenaWallHeight: 7,
      arenaObstacleDensity: 0,
      interiorObstacles: [],
      main: [
        { x: -80, z: -20, w: 12, e: 4 },
        { x: -40, z: -88, w: 12, e: 5 },
        { x: 36, z: -98, w: 12, e: 7, ramp: true },
        { x: 94, z: -56, w: 11, e: 13, bridge: true },
        { x: 106, z: 20, w: 11, e: 16, bridge: true },
        { x: 62, z: 86, w: 12, e: 12, bridge: true },
        { x: -18, z: 102, w: 12, e: 7 },
        { x: -88, z: 62, w: 11, e: 4 },
      ],
      shortcut: [
        { x: 34, z: -56, e: 8 },
        { x: 14, z: -8, e: 10 },
        { x: -6, z: 34, e: 9 },
        { x: -38, z: 60, e: 7 },
      ],
      showCenterpiece: true,
    };
  }

  public showGraphicalRouteBuilder() {
    const stored = Route.getCustomLayout();
    const seed = stored ?? this.defaultCustomLayout();
    const state: {
      mode: 'main' | 'shortcut';
      main: RouteControlPoint[];
      shortcut: RouteShortcutControlPoint[];
      selected: number;
      draggingPoint: boolean;
      miniDraggingPoint: boolean;
      cameraLook: boolean;
      dirtyTrack: boolean;
      insertSegmentStart: number;
      insertAfterIndex: number;
      connectionMode: 'after' | 'between';
      pendingConnectFirst: number;
      showCenterpiece: boolean;
      layoutType: 'loop' | 'arena';
      arenaShape: 'circle' | 'rounded_rect';
      arenaRadiusX: number;
      arenaRadiusZ: number;
      arenaFloorY: number;
      arenaWallHeight: number;
    } = {
      mode: 'main',
      main: seed.main.map(p => ({ ...p })),
      shortcut: (seed.shortcut ?? []).map(p => ({ ...p })),
      selected: -1,
      draggingPoint: false,
      miniDraggingPoint: false,
      cameraLook: false,
      dirtyTrack: true,
      insertSegmentStart: 0,
      insertAfterIndex: -1,
      connectionMode: 'after',
      pendingConnectFirst: -1,
      showCenterpiece: seed.showCenterpiece ?? true,
      layoutType: seed.layoutType === 'arena' ? 'arena' : 'loop',
      arenaShape: seed.arenaShape === 'rounded_rect' ? 'rounded_rect' : 'circle',
      arenaRadiusX: Math.max(24, seed.arenaRadiusX ?? 84),
      arenaRadiusZ: Math.max(24, seed.arenaRadiusZ ?? 74),
      arenaFloorY: seed.arenaFloorY ?? 4,
      arenaWallHeight: Math.max(2, seed.arenaWallHeight ?? 7),
    };

    const modal = document.createElement('div');
    modal.style.cssText = `
      position:absolute; inset:0; z-index:80; background:rgba(0,0,0,0.85);
      display:flex; align-items:center; justify-content:center; font-family:'Courier New', monospace;
    `;

    const shell = document.createElement('div');
    shell.style.cssText = `
      width:min(1280px,97vw); height:min(820px,94vh);
      background:#090909; border:1px solid #303030; border-radius:8px;
      display:grid; grid-template-columns:1fr 320px; overflow:hidden;
    `;

    const stageWrap = document.createElement('div');
    stageWrap.style.cssText = 'position:relative; background:#060606;';
    const previewCanvas = document.createElement('canvas');
    previewCanvas.style.cssText = 'width:100%;height:100%;display:block;cursor:crosshair;';
    stageWrap.appendChild(previewCanvas);

    const mini2d = document.createElement('canvas');
    mini2d.width = 280;
    mini2d.height = 220;
    mini2d.style.cssText = `
      position:absolute; right:12px; bottom:12px; width:280px; height:220px;
      border:1px solid #2f2f2f; border-radius:6px; background:rgba(8,8,8,0.82);
      box-shadow:0 0 16px rgba(0,0,0,0.45);
    `;
    stageWrap.appendChild(mini2d);

    const help = document.createElement('div');
    help.style.cssText = `
      position:absolute;left:10px;top:10px;padding:8px 10px;border:1px solid #2e2e2e;
      background:rgba(6,6,6,0.82);color:#bcbcbc;font-size:11px;line-height:1.45;
    `;
    help.innerHTML = `
      3D: LMB point select/drag • LMB empty add (uses selected connection)<br/>
      Minimap: LMB point drag/select • LMB empty add • RMB point delete<br/>
      Connection: pick 1 point (after) or 2 adjacent points (between)<br/>
      MMB drag: camera look • WASD: fly • wheel: elevation (Shift+wheel width)
    `;
    stageWrap.appendChild(help);

    const panel = document.createElement('div');
    panel.style.cssText = 'padding:12px;border-left:1px solid #222;color:#d0d0d0;overflow:auto;';
    const title = document.createElement('div');
    title.textContent = 'GRAPHICAL ROUTE BUILDER';
    title.style.cssText = 'font-size:14px;color:#fff;letter-spacing:1px;margin-bottom:10px;';
    panel.appendChild(title);

    const modeRow = document.createElement('div');
    modeRow.style.cssText = 'display:flex;gap:8px;margin-bottom:10px;';
    const mainBtn = document.createElement('button');
    const shortBtn = document.createElement('button');
    const styleModeBtn = (btn: HTMLButtonElement, active: boolean) => {
      btn.style.cssText = `
        flex:1;padding:8px;border-radius:4px;cursor:pointer;
        border:1px solid ${active ? '#d8d8d8' : '#2b2b2b'};
        background:${active ? '#e7e7e7' : '#101010'};
        color:${active ? '#000' : '#adadad'};
        font-family:'Courier New', monospace;font-size:11px;
      `;
    };
    mainBtn.textContent = 'MAIN LOOP';
    shortBtn.textContent = 'SHORTCUT';
    modeRow.appendChild(mainBtn);
    modeRow.appendChild(shortBtn);
    panel.appendChild(modeRow);

    const selectedLabel = document.createElement('div');
    selectedLabel.style.cssText = 'font-size:11px;color:#8f8f8f;margin-bottom:6px;';
    panel.appendChild(selectedLabel);
    const centerpieceRow = document.createElement('label');
    centerpieceRow.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:10px;font-size:11px;color:#bdbdbd;';
    const centerpieceCheck = document.createElement('input');
    centerpieceCheck.type = 'checkbox';
    centerpieceCheck.checked = state.showCenterpiece;
    centerpieceCheck.style.cssText = 'accent-color:#d6d6d6;';
    centerpieceCheck.onchange = () => {
      state.showCenterpiece = centerpieceCheck.checked;
      state.dirtyTrack = true;
    };
    centerpieceRow.appendChild(centerpieceCheck);
    centerpieceRow.appendChild(document.createTextNode('SHOW CENTERPIECE / STATUE'));
    panel.appendChild(centerpieceRow);
    const layoutTypeRow = document.createElement('div');
    layoutTypeRow.style.cssText = 'display:grid;grid-template-columns:92px 1fr;gap:8px;align-items:center;margin-bottom:8px;';
    const layoutTypeLabel = document.createElement('div');
    layoutTypeLabel.textContent = 'LAYOUT';
    layoutTypeLabel.style.cssText = 'font-size:11px;color:#9f9f9f;';
    const layoutTypeSelect = document.createElement('select');
    layoutTypeSelect.style.cssText = 'width:100%;padding:6px;background:#111;border:1px solid #333;border-radius:4px;color:#eee;';
    layoutTypeSelect.innerHTML = `
      <option value="loop">LOOP</option>
      <option value="arena">ARENA</option>
    `;
    layoutTypeSelect.value = state.layoutType;
    layoutTypeSelect.onchange = () => {
      state.layoutType = layoutTypeSelect.value === 'arena' ? 'arena' : 'loop';
      state.dirtyTrack = true;
    };
    layoutTypeRow.appendChild(layoutTypeLabel);
    layoutTypeRow.appendChild(layoutTypeSelect);
    panel.appendChild(layoutTypeRow);

    const makeArenaNumber = (label: string, getValue: () => number, onValue: (v: number) => void) => {
      const row = document.createElement('div');
      row.style.cssText = 'display:grid;grid-template-columns:92px 1fr;gap:8px;align-items:center;margin-bottom:6px;';
      const l = document.createElement('div');
      l.textContent = label;
      l.style.cssText = 'font-size:11px;color:#9f9f9f;';
      const input = document.createElement('input');
      input.type = 'number';
      input.value = String(getValue());
      input.style.cssText = 'width:100%;padding:6px;background:#111;border:1px solid #333;border-radius:4px;color:#eee;';
      input.onchange = () => {
        onValue(parseFloat(input.value || '0'));
        state.dirtyTrack = true;
      };
      row.appendChild(l);
      row.appendChild(input);
      return row;
    };
    panel.appendChild(makeArenaNumber('ARENA RX', () => state.arenaRadiusX, v => { state.arenaRadiusX = Math.max(24, Math.min(260, v)); }));
    panel.appendChild(makeArenaNumber('ARENA RZ', () => state.arenaRadiusZ, v => { state.arenaRadiusZ = Math.max(24, Math.min(260, v)); }));
    const arenaShapeRow = document.createElement('div');
    arenaShapeRow.style.cssText = 'display:grid;grid-template-columns:92px 1fr;gap:8px;align-items:center;margin-bottom:6px;';
    const arenaShapeLabel = document.createElement('div');
    arenaShapeLabel.textContent = 'ARENA SHAPE';
    arenaShapeLabel.style.cssText = 'font-size:11px;color:#9f9f9f;';
    const arenaShapeSelect = document.createElement('select');
    arenaShapeSelect.style.cssText = 'width:100%;padding:6px;background:#111;border:1px solid #333;border-radius:4px;color:#eee;';
    arenaShapeSelect.innerHTML = `
      <option value="circle">CIRCLE</option>
      <option value="rounded_rect">ROUNDED RECT</option>
    `;
    arenaShapeSelect.value = state.arenaShape;
    arenaShapeSelect.onchange = () => {
      state.arenaShape = arenaShapeSelect.value === 'rounded_rect' ? 'rounded_rect' : 'circle';
      state.dirtyTrack = true;
    };
    arenaShapeRow.appendChild(arenaShapeLabel);
    arenaShapeRow.appendChild(arenaShapeSelect);
    panel.appendChild(arenaShapeRow);
    panel.appendChild(makeArenaNumber('ARENA Y', () => state.arenaFloorY, v => { state.arenaFloorY = Math.max(-10, Math.min(80, v)); }));
    panel.appendChild(makeArenaNumber('WALL H', () => state.arenaWallHeight, v => { state.arenaWallHeight = Math.max(2, Math.min(36, v)); }));

    const connectLabel = document.createElement('div');
    connectLabel.style.cssText = 'font-size:11px;color:#9f9f9f;margin-bottom:4px;';
    connectLabel.textContent = 'NEW POINT CONNECTION';
    panel.appendChild(connectLabel);

    const connectModeRow = document.createElement('div');
    connectModeRow.style.cssText = 'display:flex;gap:8px;margin-bottom:6px;';
    const afterBtn = document.createElement('button');
    const betweenBtn = document.createElement('button');
    const styleConnBtn = (btn: HTMLButtonElement, active: boolean) => {
      btn.style.cssText = `
        flex:1;padding:7px;border-radius:4px;cursor:pointer;
        border:1px solid ${active ? '#d8d8d8' : '#2b2b2b'};
        background:${active ? '#e7e7e7' : '#101010'};
        color:${active ? '#000' : '#adadad'};
        font-family:'Courier New', monospace;font-size:11px;
      `;
    };
    afterBtn.textContent = 'AFTER 1 POINT';
    betweenBtn.textContent = 'BETWEEN 2 POINTS';
    connectModeRow.appendChild(afterBtn);
    connectModeRow.appendChild(betweenBtn);
    panel.appendChild(connectModeRow);

    const connectHint = document.createElement('div');
    connectHint.style.cssText = 'font-size:11px;color:#8d8d8d;line-height:1.4;margin-bottom:8px;';
    panel.appendChild(connectHint);

    const fields = document.createElement('div');
    panel.appendChild(fields);

    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:12px;';
    panel.appendChild(btnRow);

    const saveBtn = document.createElement('button');
    saveBtn.textContent = 'SAVE LAYOUT';
    saveBtn.style.cssText = 'padding:10px;border:none;border-radius:4px;background:#e6e6e6;color:#000;font-weight:bold;cursor:pointer;';
    saveBtn.onclick = () => {
      Route.setCustomLayout({
        layoutType: state.layoutType,
        arenaShape: state.arenaShape,
        arenaRadiusX: parseFloat(state.arenaRadiusX.toFixed(2)),
        arenaRadiusZ: parseFloat(state.arenaRadiusZ.toFixed(2)),
        arenaFloorY: parseFloat(state.arenaFloorY.toFixed(2)),
        arenaWallHeight: parseFloat(state.arenaWallHeight.toFixed(2)),
        main: state.main.map(p => ({
          ...p,
          x: parseFloat(p.x.toFixed(2)),
          z: parseFloat(p.z.toFixed(2)),
          e: parseFloat(p.e.toFixed(2)),
          w: parseFloat(p.w.toFixed(2)),
        })),
        shortcut: state.shortcut.map(p => ({
          x: parseFloat(p.x.toFixed(2)),
          z: parseFloat(p.z.toFixed(2)),
          e: parseFloat(p.e.toFixed(2)),
        })),
        interiorObstacles: [],
        arenaObstacleDensity: 0,
        showCenterpiece: state.showCenterpiece,
      });
      saveBtn.textContent = 'SAVED';
      setTimeout(() => (saveBtn.textContent = 'SAVE LAYOUT'), 700);
    };
    btnRow.appendChild(saveBtn);

    const resetBtn = document.createElement('button');
    resetBtn.textContent = 'CLEAR CUSTOM';
    resetBtn.style.cssText = 'padding:10px;border:1px solid #333;border-radius:4px;background:#131313;color:#bbb;cursor:pointer;';
    resetBtn.onclick = () => {
      Route.resetCustomLayout();
      const d = this.defaultCustomLayout();
      state.main = d.main.map(p => ({ ...p }));
      state.shortcut = d.shortcut?.map(p => ({ ...p })) ?? [];
      state.showCenterpiece = d.showCenterpiece ?? true;
      state.layoutType = d.layoutType === 'arena' ? 'arena' : 'loop';
      state.arenaShape = d.arenaShape === 'rounded_rect' ? 'rounded_rect' : 'circle';
      state.arenaRadiusX = d.arenaRadiusX ?? 84;
      state.arenaRadiusZ = d.arenaRadiusZ ?? 74;
      state.arenaFloorY = d.arenaFloorY ?? 4;
      state.arenaWallHeight = d.arenaWallHeight ?? 7;
      centerpieceCheck.checked = state.showCenterpiece;
      state.selected = -1;
      state.dirtyTrack = true;
      refreshPanel();
      drawMiniMap();
    };
    btnRow.appendChild(resetBtn);

    const btnRow2 = document.createElement('div');
    btnRow2.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px;';
    panel.appendChild(btnRow2);

    const delBtn = document.createElement('button');
    delBtn.textContent = 'DELETE SELECTED';
    delBtn.style.cssText = 'padding:10px;border:1px solid #333;border-radius:4px;background:#101010;color:#bbb;cursor:pointer;';
    delBtn.onclick = () => {
      const arr = state.mode === 'main' ? state.main : state.shortcut;
      const minPts = state.mode === 'main' ? 4 : 0;
      if (state.selected >= 0 && arr.length > minPts) {
        arr.splice(state.selected, 1);
        state.selected = -1;
        state.dirtyTrack = true;
        refreshPanel();
        drawMiniMap();
      }
    };
    btnRow2.appendChild(delBtn);

    const closeBtn = document.createElement('button');
    closeBtn.textContent = 'CLOSE';
    closeBtn.style.cssText = 'padding:10px;border:1px solid #333;border-radius:4px;background:#0d0d0d;color:#9b9b9b;cursor:pointer;';
    btnRow2.appendChild(closeBtn);

    shell.appendChild(stageWrap);
    shell.appendChild(panel);
    modal.appendChild(shell);
    this.container.appendChild(modal);

    const worldMin = -260;
    const worldMax = 260;

    const toCanvas = (x: number, z: number, w: number, h: number) => {
      const nx = (x - worldMin) / (worldMax - worldMin);
      const nz = (z - worldMin) / (worldMax - worldMin);
      return { x: nx * w, y: (1 - nz) * h };
    };

    const toWorldFromMini = (cx: number, cy: number) => {
      const nx = cx / mini2d.width;
      const nz = 1 - cy / mini2d.height;
      return {
        x: worldMin + nx * (worldMax - worldMin),
        z: worldMin + nz * (worldMax - worldMin),
      };
    };

    const getCurrent = () => (state.mode === 'main' ? state.main : state.shortcut);
    const getSegmentCount = (arr: Array<{ x: number; z: number }>) => {
      if (arr.length < 2) return 0;
      return state.mode === 'main' ? arr.length : arr.length - 1;
    };
    const resolveSegmentFromTwoPoints = (a: number, b: number, arrLength: number) => {
      if (a < 0 || b < 0 || a === b || arrLength < 2) return -1;
      if (state.mode === 'main') {
        if ((a + 1) % arrLength === b) return a;
        if ((b + 1) % arrLength === a) return b;
        return -1;
      }
      if (a + 1 === b) return a;
      if (b + 1 === a) return b;
      return -1;
    };
    const updateConnectionFromPickedPoint = (idx: number) => {
      const arr = getCurrent();
      if (idx < 0 || idx >= arr.length) return;
      if (state.connectionMode === 'after') {
        state.insertAfterIndex = idx;
        state.pendingConnectFirst = -1;
        return;
      }
      if (state.pendingConnectFirst < 0) {
        state.pendingConnectFirst = idx;
        return;
      }
      const seg = resolveSegmentFromTwoPoints(state.pendingConnectFirst, idx, arr.length);
      if (seg >= 0) {
        state.insertSegmentStart = seg;
      }
      state.pendingConnectFirst = -1;
    };
    const hasValidConnectionTarget = () => {
      const arr = getCurrent();
      if (state.connectionMode === 'after') {
        return state.insertAfterIndex >= 0 && state.insertAfterIndex < arr.length;
      }
      const segCount = getSegmentCount(arr);
      return state.insertSegmentStart >= 0 && state.insertSegmentStart < segCount;
    };

    const findNearestMiniPoint = (cx: number, cy: number): number => {
      const arr = getCurrent();
      let best = -1;
      let bestD = Infinity;
      for (let i = 0; i < arr.length; i++) {
        const p = toCanvas(arr[i].x, arr[i].z, mini2d.width, mini2d.height);
        const dx = p.x - cx;
        const dy = p.y - cy;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
      return bestD <= 10 ? best : -1;
    };

    const insertPointAtConnection = (point: { x: number; z: number; e: number; w?: number }) => {
      const arr = getCurrent();
      if (state.mode === 'main') {
        point.w = point.w ?? 12;
      }
      if (!hasValidConnectionTarget()) return false;
      let insertIdx = 0;
      if (state.connectionMode === 'after') {
        insertIdx = Math.max(0, Math.min(arr.length, state.insertAfterIndex + 1));
      } else {
        insertIdx = state.insertSegmentStart + 1;
      }
      if (state.mode === 'main') state.main.splice(insertIdx, 0, point as RouteControlPoint);
      else state.shortcut.splice(insertIdx, 0, point as RouteShortcutControlPoint);
      state.selected = insertIdx;
      state.dirtyTrack = true;
      return true;
    };

    let lastMiniMapDrawMs = 0;
    const drawMiniMap = (force = false) => {
      const now = performance.now();
      const isDragging = state.draggingPoint || state.miniDraggingPoint;
      const minIntervalMs = isDragging ? 33 : 0; // cap redraws while dragging (~30fps)
      if (!force && now - lastMiniMapDrawMs < minIntervalMs) return;
      lastMiniMapDrawMs = now;

      const ctx = mini2d.getContext('2d')!;
      const w = mini2d.width;
      const h = mini2d.height;
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = '#080808';
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = '#171717';
      for (let g = 0; g <= 10; g++) {
        const gx = (g / 10) * w;
        const gy = (g / 10) * h;
        ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, h); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(w, gy); ctx.stroke();
      }
      const drawDetailedPath = (
        pts: Array<{ x: number; z: number; e?: number; w?: number; ramp?: boolean; bridge?: boolean; boost?: boolean; loop?: boolean; tunnel?: boolean; tunnelWall?: boolean; tunnelWallSide?: 'bottom' | 'left' | 'right' }>,
        mode: 'main' | 'shortcut',
        color: string,
      ) => {
        const segCount = pts.length < 2 ? 0 : (mode === 'main' ? pts.length : pts.length - 1);
        for (let i = 0; i < segCount; i++) {
          const j = mode === 'main' ? (i + 1) % pts.length : i + 1;
          const a = toCanvas(pts[i].x, pts[i].z, w, h);
          const b = toCanvas(pts[j].x, pts[j].z, w, h);
          const width = mode === 'main' ? Math.max(1.5, ((pts[i].w ?? 10) / 12) * 2.8) : 1.8;
          ctx.strokeStyle = color;
          ctx.lineWidth = width;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();

          const mx = (a.x + b.x) * 0.5;
          const my = (a.y + b.y) * 0.5;
          const ang = Math.atan2(b.y - a.y, b.x - a.x);
          ctx.save();
          ctx.translate(mx, my);
          ctx.rotate(ang);
          ctx.strokeStyle = 'rgba(230,230,230,0.35)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(-4, 0);
          ctx.lineTo(4, 0);
          ctx.moveTo(4, 0);
          ctx.lineTo(1, -2.5);
          ctx.moveTo(4, 0);
          ctx.lineTo(1, 2.5);
          ctx.stroke();
          ctx.restore();

          if (mode === state.mode && state.connectionMode === 'between' && i === state.insertSegmentStart) {
            ctx.strokeStyle = '#ffd54f';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
          }
        }
      };

      drawDetailedPath(state.main, 'main', '#dcdcdc');
      drawDetailedPath(state.shortcut, 'shortcut', '#7fa6ff');

      const drawPoints = (
        pts: Array<{ x: number; z: number; e?: number; ramp?: boolean; bridge?: boolean; boost?: boolean; loop?: boolean; tunnel?: boolean; tunnelWall?: boolean; tunnelWallSide?: 'bottom' | 'left' | 'right' }>,
        mode: 'main' | 'shortcut',
        baseColor: string,
      ) => {
        for (let i = 0; i < pts.length; i++) {
          const p = pts[i];
          const c = toCanvas(p.x, p.z, w, h);
          const selected = mode === state.mode && i === state.selected;
          let fill = baseColor;
          if ((p as RouteControlPoint).ramp) fill = '#ffb347';
          else if ((p as RouteControlPoint).bridge) fill = '#9bd7ff';
          else if ((p as RouteControlPoint).boost) fill = '#fff275';
          else if ((p as RouteControlPoint).loop) fill = '#8ff3ff';
          else if ((p as RouteControlPoint).tunnel) fill = '#b58cff';
          if ((p as RouteControlPoint).tunnelWall) fill = '#ff8d8d';
          ctx.beginPath();
          ctx.fillStyle = selected ? '#ffffff' : fill;
          ctx.arc(c.x, c.y, selected ? 5.8 : 4.1, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = '#090909';
          ctx.lineWidth = 1;
          ctx.stroke();
          if (
            mode === state.mode
            && ((state.connectionMode === 'after' && i === state.insertAfterIndex)
              || (state.connectionMode === 'between' && i === state.pendingConnectFirst))
          ) {
            ctx.beginPath();
            ctx.strokeStyle = '#ffd54f';
            ctx.lineWidth = 2;
            ctx.arc(c.x, c.y, 7.2, 0, Math.PI * 2);
            ctx.stroke();
          }
          ctx.fillStyle = '#8d8d8d';
          ctx.font = '10px monospace';
          ctx.fillText(String(i + 1), c.x + 6, c.y - 5);
          if (typeof p.e === 'number') {
            ctx.fillStyle = 'rgba(180,180,180,0.65)';
            ctx.font = '9px monospace';
            ctx.fillText(`z${p.e.toFixed(1)}`, c.x + 6, c.y + 8);
          }
        }
      };
      drawPoints(state.main, 'main', '#a8a8a8');
      drawPoints(state.shortcut, 'shortcut', '#7fa6ff');

      ctx.fillStyle = '#b8b8b8';
      ctx.font = '10px monospace';
      const connText = state.connectionMode === 'after'
        ? `after: ${state.insertAfterIndex >= 0 ? state.insertAfterIndex + 1 : 'pick point'}`
        : `between: seg ${state.insertSegmentStart + 1}${state.pendingConnectFirst >= 0 ? ' (pick 2nd)' : ''}`;
      ctx.fillText(`mode: ${state.mode} | ${connText}`, 8, h - 8);
    };

    const renderer = new THREE.WebGLRenderer({ canvas: previewCanvas, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(stageWrap.clientWidth, stageWrap.clientHeight);
    renderer.shadowMap.enabled = true;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000000);
    scene.fog = new THREE.FogExp2(0x000000, 0.0015);
    scene.add(new THREE.AmbientLight(0x404040, 0.3));
    const dir = new THREE.DirectionalLight(0xffffff, 0.8);
    dir.position.set(30, 50, 30);
    scene.add(dir);
    scene.add(new THREE.DirectionalLight(0xffffff, 0.3)).position.set(-10, -10, -5);

    const camera = new THREE.PerspectiveCamera(70, stageWrap.clientWidth / stageWrap.clientHeight, 0.1, 3000);
    camera.position.set(0, 90, 220);

    let world = new CANNON.World({ gravity: new CANNON.Vec3(0, -20, 0) });
    let previewRoute: Route | null = null;
    const handles = new THREE.Group();
    scene.add(handles);

    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    const dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -7);
    let selectedHandle: THREE.Mesh | null = null;
    const keys = new Set<string>();
    let yaw = Math.PI;
    let pitch = -0.2;
    let lastMX = 0;
    let lastMY = 0;

    const disposeMaterial = (mat: THREE.Material) => {
      const m = mat as THREE.Material & {
        map?: THREE.Texture;
        alphaMap?: THREE.Texture;
        emissiveMap?: THREE.Texture;
        roughnessMap?: THREE.Texture;
        metalnessMap?: THREE.Texture;
        normalMap?: THREE.Texture;
        aoMap?: THREE.Texture;
      };
      m.map?.dispose();
      m.alphaMap?.dispose();
      m.emissiveMap?.dispose();
      m.roughnessMap?.dispose();
      m.metalnessMap?.dispose();
      m.normalMap?.dispose();
      m.aoMap?.dispose();
      m.dispose();
    };
    const disposeObject3D = (root: THREE.Object3D) => {
      root.traverse(obj => {
        const mesh = obj as THREE.Mesh & { geometry?: THREE.BufferGeometry; material?: THREE.Material | THREE.Material[] };
        if (mesh.geometry) mesh.geometry.dispose();
        if (Array.isArray(mesh.material)) mesh.material.forEach(disposeMaterial);
        else if (mesh.material) disposeMaterial(mesh.material);
      });
    };

    let lastRouteRebuildMs = 0;
    const rebuildTrack = (force = false) => {
      if (!state.dirtyTrack) return;
      const now = performance.now();
      const isDragging = state.draggingPoint || state.miniDraggingPoint;
      const minIntervalMs = isDragging ? 50 : 0; // cap heavy geometry rebuilds while dragging (~20fps)
      if (!force && now - lastRouteRebuildMs < minIntervalMs) return;
      lastRouteRebuildMs = now;

      state.dirtyTrack = false;
      if (previewRoute) {
        scene.remove(previewRoute.mesh);
        disposeObject3D(previewRoute.mesh);
      }
      // Use a fresh physics world each rebuild so bodies never accumulate.
      world = new CANNON.World({ gravity: new CANNON.Vec3(0, -20, 0) });
      previewRoute = new Route(scene, world, {
        layoutType: state.layoutType,
        arenaShape: state.arenaShape,
        arenaRadiusX: state.arenaRadiusX,
        arenaRadiusZ: state.arenaRadiusZ,
        arenaFloorY: state.arenaFloorY,
        arenaWallHeight: state.arenaWallHeight,
        interiorObstacles: [],
        main: state.main,
        shortcut: state.shortcut,
        showCenterpiece: state.showCenterpiece,
      });
      rebuildHandles();
    };

    const rebuildHandles = () => {
      while (handles.children.length) handles.remove(handles.children[0]);
      const addHandles = (pts: Array<{ x: number; z: number; e: number }>, mode: 'main' | 'shortcut', color: number) => {
        for (let i = 0; i < pts.length; i++) {
          const p = pts[i];
          const sphere = new THREE.Mesh(
            new THREE.SphereGeometry(i === state.selected && mode === state.mode ? 2.1 : 1.5, 14, 10),
            new THREE.MeshBasicMaterial({ color }),
          );
          sphere.position.set(p.x, p.e + 1.4, p.z);
          (sphere as unknown as { userData: { idx: number; mode: 'main' | 'shortcut' } }).userData = { idx: i, mode };
          handles.add(sphere);
        }
      };
      addHandles(state.main, 'main', 0xffffff);
      addHandles(state.shortcut.map(p => ({ ...p, e: p.e })), 'shortcut', 0x7fa6ff);
    };

    const buildNumberInput = (label: string, value: number, onChange: (v: number) => void) => {
      const row = document.createElement('div');
      row.style.cssText = 'display:grid;grid-template-columns:60px 1fr;gap:6px;align-items:center;margin-bottom:6px;';
      const lbl = document.createElement('div');
      lbl.textContent = label;
      lbl.style.cssText = 'font-size:11px;color:#9f9f9f;';
      const input = document.createElement('input');
      input.type = 'number';
      input.value = value.toFixed(2);
      input.style.cssText = 'width:100%;padding:6px;background:#111;border:1px solid #333;border-radius:4px;color:#eee;';
      input.onchange = () => onChange(parseFloat(input.value || '0'));
      row.appendChild(lbl);
      row.appendChild(input);
      return row;
    };
    const buildCheck = (label: string, checked: boolean, onChange: (v: boolean) => void) => {
      const row = document.createElement('label');
      row.style.cssText = 'display:flex;align-items:center;gap:6px;font-size:11px;color:#bdbdbd;margin-bottom:6px;';
      const c = document.createElement('input');
      c.type = 'checkbox';
      c.checked = checked;
      c.style.cssText = 'accent-color:#d6d6d6;';
      c.onchange = () => onChange(c.checked);
      row.appendChild(c);
      row.appendChild(document.createTextNode(label));
      return row;
    };
    const buildSelect = (
      label: string,
      value: string,
      options: Array<{ value: string; label: string }>,
      onChange: (v: string) => void,
    ) => {
      const row = document.createElement('div');
      row.style.cssText = 'display:grid;grid-template-columns:60px 1fr;gap:6px;align-items:center;margin-bottom:6px;';
      const lbl = document.createElement('div');
      lbl.textContent = label;
      lbl.style.cssText = 'font-size:11px;color:#9f9f9f;';
      const sel = document.createElement('select');
      sel.style.cssText = 'width:100%;padding:6px;background:#111;border:1px solid #333;border-radius:4px;color:#eee;';
      for (const opt of options) {
        const o = document.createElement('option');
        o.value = opt.value;
        o.textContent = opt.label;
        if (opt.value === value) o.selected = true;
        sel.appendChild(o);
      }
      sel.onchange = () => onChange(sel.value);
      row.appendChild(lbl);
      row.appendChild(sel);
      return row;
    };
    const refreshPanel = () => {
      styleModeBtn(mainBtn, state.mode === 'main');
      styleModeBtn(shortBtn, state.mode === 'shortcut');
      styleConnBtn(afterBtn, state.connectionMode === 'after');
      styleConnBtn(betweenBtn, state.connectionMode === 'between');
      const arr = getCurrent();
      const segCount = getSegmentCount(arr);
      if (segCount <= 0) {
        state.insertSegmentStart = 0;
      } else {
        state.insertSegmentStart = Math.max(0, Math.min(segCount - 1, state.insertSegmentStart));
      }
      if (arr.length > 0) {
        state.insertAfterIndex = Math.max(0, Math.min(arr.length - 1, state.insertAfterIndex));
      } else {
        state.insertAfterIndex = -1;
      }
      if (state.connectionMode === 'after') {
        connectHint.textContent = state.insertAfterIndex >= 0
          ? `Pick add position: new point goes after point ${state.insertAfterIndex + 1}.`
          : 'Pick one point first. New point will be inserted after it.';
      } else {
        connectHint.textContent = state.pendingConnectFirst >= 0
          ? `Pick second adjacent point (first: ${state.pendingConnectFirst + 1}).`
          : 'Pick two adjacent points to define the insertion segment.';
      }
      selectedLabel.textContent = `Editing: ${state.mode.toUpperCase()} · points: ${arr.length} · selected: ${state.selected >= 0 ? state.selected + 1 : 'none'}`;
      fields.innerHTML = '';
      if (state.selected < 0 || state.selected >= arr.length) return;
      const pt = arr[state.selected];
      fields.appendChild(buildNumberInput('X', pt.x, v => { pt.x = v; state.dirtyTrack = true; drawMiniMap(); }));
      fields.appendChild(buildNumberInput('Z', pt.z, v => { pt.z = v; state.dirtyTrack = true; drawMiniMap(); }));
      fields.appendChild(buildNumberInput('Elev', (pt as RouteControlPoint).e, v => { (pt as RouteControlPoint).e = v; state.dirtyTrack = true; }));
      if (state.mode === 'main') {
        const m = pt as RouteControlPoint;
        fields.appendChild(buildNumberInput('Width', m.w, v => { m.w = Math.max(6, Math.min(24, v)); state.dirtyTrack = true; }));
        fields.appendChild(buildCheck('Ramp', !!m.ramp, v => { m.ramp = v; state.dirtyTrack = true; }));
        fields.appendChild(buildCheck('Bridge', !!m.bridge, v => { m.bridge = v; state.dirtyTrack = true; }));
        fields.appendChild(buildCheck('No Rails', !!m.noRails, v => { m.noRails = v; state.dirtyTrack = true; }));
        fields.appendChild(buildCheck('Boost Pad', !!m.boost, v => { m.boost = v; state.dirtyTrack = true; }));
        fields.appendChild(buildCheck('Loop Segment', !!m.loop, v => { m.loop = v; state.dirtyTrack = true; }));
        fields.appendChild(buildCheck('Tunnel', !!m.tunnel, v => { m.tunnel = v; state.dirtyTrack = true; }));
        fields.appendChild(buildCheck('Tunnel Half-Wall', !!m.tunnelWall, v => { m.tunnelWall = v; state.dirtyTrack = true; }));
        if (m.tunnelWall) {
          fields.appendChild(buildSelect(
            'Wall Side',
            m.tunnelWallSide ?? 'bottom',
            [
              { value: 'bottom', label: 'BOTTOM' },
              { value: 'left', label: 'LEFT' },
              { value: 'right', label: 'RIGHT' },
            ],
            v => {
              m.tunnelWallSide = v === 'left' || v === 'right' ? v : 'bottom';
              state.dirtyTrack = true;
            },
          ));
        }
      }
    };

    const syncMouseNdc = (ev: MouseEvent) => {
      const rect = previewCanvas.getBoundingClientRect();
      mouse.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
    };

    const onMouseDown = (ev: MouseEvent) => {
      syncMouseNdc(ev);
      if (ev.button === 1) {
        ev.preventDefault();
        state.cameraLook = true;
        lastMX = ev.clientX;
        lastMY = ev.clientY;
        return;
      }
      if (ev.button !== 0) return;
      raycaster.setFromCamera(mouse, camera);
      const hits = raycaster.intersectObjects(handles.children, false);
      if (hits.length > 0) {
        const hit = hits[0].object as THREE.Mesh & { userData: { idx: number; mode: 'main' | 'shortcut' } };
        state.mode = hit.userData.mode;
        state.selected = hit.userData.idx;
        updateConnectionFromPickedPoint(hit.userData.idx);
        selectedHandle = hit;
        state.draggingPoint = true;
        const arr = getCurrent();
        const elev = (arr[state.selected] as RouteControlPoint).e;
        dragPlane.set(new THREE.Vector3(0, 1, 0), -elev);
        refreshPanel();
        return;
      }
      // Add point from world intersection on ground-ish plane.
      const targetElev = state.mode === 'main'
        ? (state.selected >= 0 ? (state.main[state.selected].e ?? 7) : 7)
        : (state.selected >= 0 ? state.shortcut[state.selected].e : 7);
      dragPlane.set(new THREE.Vector3(0, 1, 0), -targetElev);
      const hitPoint = new THREE.Vector3();
      if (raycaster.ray.intersectPlane(dragPlane, hitPoint)) {
        const inserted = state.mode === 'main'
          ? insertPointAtConnection({ x: hitPoint.x, z: hitPoint.z, w: 12, e: targetElev })
          : insertPointAtConnection({ x: hitPoint.x, z: hitPoint.z, e: targetElev });
        if (inserted) {
          drawMiniMap();
          refreshPanel();
        }
      }
    };
    const onMouseMove = (ev: MouseEvent) => {
      if (state.cameraLook) {
        const dx = ev.clientX - lastMX;
        const dy = ev.clientY - lastMY;
        lastMX = ev.clientX;
        lastMY = ev.clientY;
        yaw -= dx * 0.003;
        pitch = Math.max(-1.2, Math.min(1.2, pitch - dy * 0.003));
        return;
      }
      if (!state.draggingPoint || state.selected < 0) return;
      syncMouseNdc(ev);
      raycaster.setFromCamera(mouse, camera);
      const hit = new THREE.Vector3();
      if (raycaster.ray.intersectPlane(dragPlane, hit)) {
        const arr = getCurrent();
        arr[state.selected].x = hit.x;
        arr[state.selected].z = hit.z;
        state.dirtyTrack = true;
        drawMiniMap();
      }
    };
    const onMouseUp = () => {
      state.cameraLook = false;
      state.draggingPoint = false;
      selectedHandle = null;
    };
    const onWheel = (ev: WheelEvent) => {
      if (state.selected < 0) return;
      ev.preventDefault();
      const arr = getCurrent();
      const pt = arr[state.selected];
      const sign = ev.deltaY > 0 ? -1 : 1;
      if (state.mode === 'main' && ev.shiftKey) {
        const m = pt as RouteControlPoint;
        m.w = Math.max(6, Math.min(24, m.w + sign * 0.25));
      } else {
        (pt as RouteControlPoint).e += sign * 0.25;
      }
      state.dirtyTrack = true;
      refreshPanel();
    };
    const onContext = (ev: MouseEvent) => {
      ev.preventDefault();
      syncMouseNdc(ev);
      raycaster.setFromCamera(mouse, camera);
      const hits = raycaster.intersectObjects(handles.children, false);
      if (hits.length === 0) return;
      const hit = hits[0].object as THREE.Mesh & { userData: { idx: number; mode: 'main' | 'shortcut' } };
      const arr = hit.userData.mode === 'main' ? state.main : state.shortcut;
      const minPts = hit.userData.mode === 'main' ? 4 : 0;
      if (arr.length <= minPts) return;
      arr.splice(hit.userData.idx, 1);
      if (state.mode === hit.userData.mode) state.selected = -1;
      state.dirtyTrack = true;
      drawMiniMap();
      refreshPanel();
    };

    const miniCanvasPos = (ev: MouseEvent) => {
      const rect = mini2d.getBoundingClientRect();
      const sx = mini2d.width / rect.width;
      const sy = mini2d.height / rect.height;
      return {
        x: (ev.clientX - rect.left) * sx,
        y: (ev.clientY - rect.top) * sy,
      };
    };
    const onMiniMouseDown = (ev: MouseEvent) => {
      const p = miniCanvasPos(ev);
      if (ev.button === 2) {
        ev.preventDefault();
        const arr = getCurrent();
        const idx = findNearestMiniPoint(p.x, p.y);
        const minPts = state.mode === 'main' ? 4 : 0;
        if (idx >= 0 && arr.length > minPts) {
          arr.splice(idx, 1);
          if (state.selected === idx) state.selected = -1;
          else if (state.selected > idx) state.selected -= 1;
          state.dirtyTrack = true;
          refreshPanel();
          drawMiniMap();
        }
        return;
      }
      const hitPointIdx = findNearestMiniPoint(p.x, p.y);
      if (hitPointIdx >= 0) {
        state.selected = hitPointIdx;
        updateConnectionFromPickedPoint(hitPointIdx);
        state.miniDraggingPoint = true;
        refreshPanel();
        drawMiniMap();
        return;
      }
      const worldPos = toWorldFromMini(p.x, p.y);
      const selectedArr = getCurrent();
      const targetElev = state.selected >= 0
        ? (selectedArr[state.selected] as RouteControlPoint).e
        : 7;
      const inserted = state.mode === 'main'
        ? insertPointAtConnection({ x: worldPos.x, z: worldPos.z, w: 12, e: targetElev })
        : insertPointAtConnection({ x: worldPos.x, z: worldPos.z, e: targetElev });
      if (inserted) {
        refreshPanel();
        drawMiniMap();
      }
    };
    const onMiniMouseMove = (ev: MouseEvent) => {
      if (!state.miniDraggingPoint || state.selected < 0) return;
      const p = miniCanvasPos(ev);
      const worldPos = toWorldFromMini(p.x, p.y);
      const arr = getCurrent();
      arr[state.selected].x = worldPos.x;
      arr[state.selected].z = worldPos.z;
      state.dirtyTrack = true;
      drawMiniMap();
    };
    const onMiniMouseUp = () => {
      state.miniDraggingPoint = false;
    };
    const onMiniContext = (ev: MouseEvent) => {
      ev.preventDefault();
    };

    const onKeyDown = (e: KeyboardEvent) => keys.add(e.code);
    const onKeyUp = (e: KeyboardEvent) => keys.delete(e.code);
    const onResize = () => {
      renderer.setSize(stageWrap.clientWidth, stageWrap.clientHeight);
      camera.aspect = stageWrap.clientWidth / stageWrap.clientHeight;
      camera.updateProjectionMatrix();
    };

    previewCanvas.addEventListener('mousedown', onMouseDown);
    previewCanvas.addEventListener('mousemove', onMouseMove);
    previewCanvas.addEventListener('mouseup', onMouseUp);
    previewCanvas.addEventListener('mouseleave', onMouseUp);
    previewCanvas.addEventListener('wheel', onWheel, { passive: false });
    previewCanvas.addEventListener('contextmenu', onContext);
    mini2d.addEventListener('mousedown', onMiniMouseDown);
    mini2d.addEventListener('mousemove', onMiniMouseMove);
    mini2d.addEventListener('mouseup', onMiniMouseUp);
    mini2d.addEventListener('mouseleave', onMiniMouseUp);
    mini2d.addEventListener('contextmenu', onMiniContext);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('resize', onResize);

    mainBtn.onclick = () => {
      state.mode = 'main';
      state.selected = -1;
      state.insertSegmentStart = 0;
      state.insertAfterIndex = -1;
      state.pendingConnectFirst = -1;
      refreshPanel();
      state.dirtyTrack = true;
      drawMiniMap();
    };
    shortBtn.onclick = () => {
      state.mode = 'shortcut';
      state.selected = -1;
      state.insertSegmentStart = 0;
      state.insertAfterIndex = -1;
      state.pendingConnectFirst = -1;
      refreshPanel();
      state.dirtyTrack = true;
      drawMiniMap();
    };
    afterBtn.onclick = () => {
      state.connectionMode = 'after';
      state.pendingConnectFirst = -1;
      refreshPanel();
      drawMiniMap();
    };
    betweenBtn.onclick = () => {
      state.connectionMode = 'between';
      state.pendingConnectFirst = -1;
      refreshPanel();
      drawMiniMap();
    };

    let raf = 0;
    let last = performance.now();
    const tick = () => {
      const now = performance.now();
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;

      const forward = new THREE.Vector3(
        Math.sin(yaw) * Math.cos(pitch),
        Math.sin(pitch),
        Math.cos(yaw) * Math.cos(pitch),
      ).normalize();
      const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
      const up = new THREE.Vector3(0, 1, 0);
      const speed = keys.has('ShiftLeft') || keys.has('ShiftRight') ? 130 : 75;
      if (keys.has('KeyW')) camera.position.addScaledVector(forward, speed * dt);
      if (keys.has('KeyS')) camera.position.addScaledVector(forward, -speed * dt);
      if (keys.has('KeyA')) camera.position.addScaledVector(right, -speed * dt);
      if (keys.has('KeyD')) camera.position.addScaledVector(right, speed * dt);
      if (keys.has('Space')) camera.position.addScaledVector(up, speed * 0.7 * dt);
      if (keys.has('ControlLeft') || keys.has('ControlRight')) camera.position.addScaledVector(up, -speed * 0.7 * dt);
      camera.lookAt(camera.position.clone().add(forward.multiplyScalar(80)));

      rebuildTrack();
      renderer.render(scene, camera);
      raf = requestAnimationFrame(tick);
    };

    const cleanup = () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('resize', onResize);
      previewCanvas.removeEventListener('mousedown', onMouseDown);
      previewCanvas.removeEventListener('mousemove', onMouseMove);
      previewCanvas.removeEventListener('mouseup', onMouseUp);
      previewCanvas.removeEventListener('mouseleave', onMouseUp);
      previewCanvas.removeEventListener('wheel', onWheel);
      previewCanvas.removeEventListener('contextmenu', onContext);
      mini2d.removeEventListener('mousedown', onMiniMouseDown);
      mini2d.removeEventListener('mousemove', onMiniMouseMove);
      mini2d.removeEventListener('mouseup', onMiniMouseUp);
      mini2d.removeEventListener('mouseleave', onMiniMouseUp);
      mini2d.removeEventListener('contextmenu', onMiniContext);
      if (previewRoute) {
        scene.remove(previewRoute.mesh);
        disposeObject3D(previewRoute.mesh);
      }
      renderer.dispose();
      modal.remove();
    };
    closeBtn.onclick = cleanup;
    modal.addEventListener('click', (e) => {
      if (e.target === modal) cleanup();
    });

    drawMiniMap();
    refreshPanel();
    tick();
  }
}
