import { LobbyUI } from './lobby/LobbyUI';
import { OnlineLobbyUI } from './lobby/OnlineLobbyUI';
import { Game } from './game/Game';
import { ChainClass } from './game/ChainRider';
import {
  Route,
  SPONSOR_BANNER_MIN_ASPECT_RATIO,
  SPONSOR_FLAG_MAX_ASPECT_RATIO,
  type SponsorSurfaceKind,
} from './game/Route';
import { PaymentUI } from './lobby/PaymentUI';
import { ResultUI } from './lobby/ResultUI';
import { ChatMessage, GAME_CONFIG, GameMode, OnlineRaceSnapshot, RaceItemStats, RoomState, RouteCustomLayout, RouteDefinition } from 'shared/types';
import { RoomClient } from './online/RoomClient';
import { setupPWA } from './pwa';
import { SessionApi } from './services/SessionApi';
import {
  AudioDirector,
  defaultMusicLabPreset,
  normalizeMusicLabPreset,
  renderMusicLabLoop,
  type DynamicRangeMode,
  type MusicLabPreset,
  type MusicLabTrack,
} from './audio';

setupPWA();

const SPONSOR_LOGO_IMPORTS = import.meta.glob('./assets/sponsors/*.{png,jpg,jpeg,webp,svg}', {
  eager: true,
  import: 'default',
}) as Record<string, string>;

const SPONSOR_LOGO_URLS = Object.values(SPONSOR_LOGO_IMPORTS);
const UI_FONT_FAMILY = "'Inter', 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif";
const MUSIC_LAB_STORAGE_KEY = 'chainduel3d.audio.musiclab.v1';

interface SponsorPreviewRow {
  sourcePath: string;
  filename: string;
  width: number | null;
  height: number | null;
  ratio: number | null;
  kind: SponsorSurfaceKind | 'invalid';
  issue?: string;
}

const formatSponsorThresholds = () =>
  `flag <= ${SPONSOR_FLAG_MAX_ASPECT_RATIO.toFixed(2)} | banner >= ${SPONSOR_BANNER_MIN_ASPECT_RATIO.toFixed(2)} | else billboard`;

const classifySponsorKind = (ratio: number): SponsorSurfaceKind => {
  if (ratio >= SPONSOR_BANNER_MIN_ASPECT_RATIO) return 'banner';
  if (ratio <= SPONSOR_FLAG_MAX_ASPECT_RATIO) return 'flag';
  return 'billboard';
};

const parseSponsorFilename = (sourcePath: string): string => {
  const normalized = sourcePath.replace(/\\/g, '/');
  const segments = normalized.split('/');
  return segments[segments.length - 1] ?? sourcePath;
};

const loadImageMeta = (url: string): Promise<{ width: number; height: number }> =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => reject(new Error('Image failed to load'));
    img.src = url;
  });

const loadSponsorPreviewRows = async (): Promise<SponsorPreviewRow[]> => {
  const tasks = Object.entries(SPONSOR_LOGO_IMPORTS).map(async ([sourcePath, url]) => {
    const filename = parseSponsorFilename(sourcePath);
    try {
      const { width, height } = await loadImageMeta(url);
      const ratio = width / Math.max(1, height);
      return {
        sourcePath,
        filename,
        width,
        height,
        ratio,
        kind: classifySponsorKind(ratio),
      } satisfies SponsorPreviewRow;
    } catch {
      return {
        sourcePath,
        filename,
        width: null,
        height: null,
        ratio: null,
        kind: 'invalid',
        issue: 'load failed',
      } satisfies SponsorPreviewRow;
    }
  });
  const rows = await Promise.all(tasks);
  rows.sort((a, b) => a.filename.localeCompare(b.filename));
  return rows;
};

type AppState = 'mode' | 'lobby' | 'online_entry' | 'online_room' | 'admin' | 'how_to_play' | 'settings' | 'payment' | 'racing' | 'result';
type RouteOption = { id: string; name: string };

class ChainDuel3DApp {
  private container: HTMLElement;
  private state: AppState = 'mode';
  private lobbyUI: LobbyUI;
  private onlineLobbyUI: OnlineLobbyUI;
  private paymentUI: PaymentUI;
  private resultUI: ResultUI;
  private roomClient: RoomClient;
  private sessionApi: SessionApi;
  private game: Game | null = null;
  private sessionId: string | null = null;
  private wagerAmount: number = GAME_CONFIG.MIN_WAGER;
  private totalLaps: number = GAME_CONFIG.TOTAL_LAPS;
  private playerNames: string[] = Array.from({ length: GAME_CONFIG.MAX_PLAYERS }, (_, i) => `Player ${i + 1}`);
  private isAI: boolean[] = Array.from({ length: GAME_CONFIG.MAX_PLAYERS }, (_, i) => i !== 0);
  private chainClasses: ChainClass[] = Array.from({ length: GAME_CONFIG.MAX_PLAYERS }, () => 'balanced');
  private localActiveSlots: boolean[] = Array.from({ length: GAME_CONFIG.MAX_PLAYERS }, (_, i) => i < 4);
  private onlineRoom: RoomState | null = null;
  private onlineMemberId: string | null = null;
  private onlineInviteCodeFromUrl: string | null = null;
  private latestRoomSnapshot: OnlineRaceSnapshot | null = null;
  private onlineFinishHandled = false;
  private onlineFinishTransitionTimeoutId: number | null = null;
  private selectedRouteId = 'default';
  private routes: RouteOption[] = [{ id: 'default', name: 'Genesis Route' }];
  private sponsorPreviewRows: SponsorPreviewRow[] | null = null;
  private sponsorPreviewLoading = false;
  private gameMode: GameMode = 'classic';
  private lastRaceItemStats: RaceItemStats[] = [];
  private bootLoading = true;
  private bootLoadFailed = false;
  private loadingOverlayEl: HTMLDivElement | null = null;
  private loadingTitleEl: HTMLDivElement | null = null;
  private loadingSubEl: HTMLDivElement | null = null;
  private loadingShownAt = 0;
  private inFlightActions = new Set<string>();
  private audio: AudioDirector;
  private audioDiagOverlayEl: HTMLDivElement | null = null;
  private audioDiagOverlayEnabled = false;
  private audioDiagRaf = 0;
  private menuMusicPreset: MusicLabPreset = defaultMusicLabPreset('menu');
  private raceMusicPreset: MusicLabPreset = defaultMusicLabPreset('race');

  constructor() {
    this.container = document.getElementById('app')!;
    this.lobbyUI = new LobbyUI(
      this.container,
      () => {
        this.audio.events.onUiClick('back');
        this.showModeMenu();
      },
      (...args) => {
        this.audio.events.onUiClick('confirm');
        return this.onStartGame(...args);
      },
    );
    this.onlineLobbyUI = new OnlineLobbyUI(this.container);
    this.paymentUI = new PaymentUI(this.container);
    this.resultUI = new ResultUI(this.container);
    this.roomClient = new RoomClient();
    this.sessionApi = new SessionApi();
    this.audio = new AudioDirector();
    this.loadMusicLabPresets();
    this.applyMusicLabPresetToEngine('menu');
    this.applyMusicLabPresetToEngine('race');
    this.lobbyUI.setRoutes(this.routes);
    this.onlineLobbyUI.setRoutes(this.routes);
    this.roomClient.setHandlers({
      onRoomState: room => this.onRoomState(room),
      onChatMessage: (_roomId, msg) => this.onRoomChat(msg),
      onRaceSnapshot: (_roomId, snapshot) => {
        this.latestRoomSnapshot = snapshot;
        if (this.game && this.state === 'racing') {
          this.game.setOnlineSnapshot(snapshot);
        }
      },
      onMemberPing: (roomId, memberId, pingMs) => this.onMemberPing(roomId, memberId, pingMs),
      onConnectionState: state => {
        if (this.state !== 'online_entry' && this.state !== 'online_room') return;
        if (state === 'connecting') this.onlineLobbyUI.setStatus('Connecting to lobby server...');
        if (state === 'connected') this.onlineLobbyUI.setStatus('Connected. Subscribing to room...');
        if (state === 'subscribing') this.onlineLobbyUI.setStatus('Subscribing to room updates...');
        if (state === 'subscribed') this.onlineLobbyUI.setStatus('Lobby synced.');
        if (state === 'reconnecting') this.onlineLobbyUI.setStatus('Reconnecting...');
      },
      onError: msg => this.onlineLobbyUI.setStatus(msg),
    });
    const url = new URL(window.location.href);
    this.onlineInviteCodeFromUrl = url.searchParams.get('room');
    void this.refreshRoutes();
    void this.audio.init().then(() => this.audio.setAppState('menu'));
    this.attachAudioUiDelegates();
    this.showModeMenu();
  }

  private showGlobalLoading(message: string, subMessage = '') {
    if (!this.loadingOverlayEl) {
      const overlay = document.createElement('div');
      overlay.style.cssText = `
        position:absolute; inset:0; z-index:200; display:flex; align-items:center; justify-content:center;
        background:rgba(0,0,0,0.66); backdrop-filter: blur(2px);
      `;
      const card = document.createElement('div');
      card.style.cssText = `
        min-width:min(420px,88vw); border:1px solid #2f2f2f; border-radius:10px; background:#090909;
        padding:16px 18px; color:#efefef; font-family:${UI_FONT_FAMILY}; box-shadow:0 0 26px rgba(255,255,255,0.1);
      `;
      const title = document.createElement('div');
      title.style.cssText = 'font-size:15px;font-weight:700;letter-spacing:0.8px;color:#fff;';
      const sub = document.createElement('div');
      sub.style.cssText = 'margin-top:6px;font-size:12px;color:#9f9f9f;min-height:16px;';
      const spinner = document.createElement('div');
      spinner.style.cssText = `
        width:24px;height:24px;border-radius:50%;margin-top:12px;
        border:2px solid #2f2f2f;border-top-color:#f0f0f0;animation:chainduelSpin 0.85s linear infinite;
      `;
      const style = document.createElement('style');
      style.textContent = '@keyframes chainduelSpin { to { transform: rotate(360deg); } }';
      card.appendChild(title);
      card.appendChild(sub);
      card.appendChild(spinner);
      card.appendChild(style);
      overlay.appendChild(card);
      this.container.appendChild(overlay);
      this.loadingOverlayEl = overlay;
      this.loadingTitleEl = title;
      this.loadingSubEl = sub;
    }
    this.loadingShownAt = Date.now();
    if (this.loadingTitleEl) this.loadingTitleEl.textContent = message;
    if (this.loadingSubEl) this.loadingSubEl.textContent = subMessage;
  }

  private updateGlobalLoading(message: string, subMessage = '') {
    if (!this.loadingOverlayEl) {
      this.showGlobalLoading(message, subMessage);
      return;
    }
    if (this.loadingTitleEl) this.loadingTitleEl.textContent = message;
    if (this.loadingSubEl) this.loadingSubEl.textContent = subMessage;
  }

  private async hideGlobalLoading() {
    const minVisibleMs = 250;
    const elapsed = Date.now() - this.loadingShownAt;
    if (elapsed < minVisibleMs) {
      await new Promise(resolve => setTimeout(resolve, minVisibleMs - elapsed));
    }
    this.loadingOverlayEl?.remove();
    this.loadingOverlayEl = null;
    this.loadingTitleEl = null;
    this.loadingSubEl = null;
  }

  private async runWithLoading<T>(
    actionId: string,
    title: string,
    task: () => Promise<T>,
    opts?: { subMessage?: string; timeoutMs?: number; timeoutMessage?: string; onTimeout?: () => void },
  ): Promise<T> {
    if (this.inFlightActions.has(actionId)) {
      throw new Error('Action already in progress');
    }
    this.inFlightActions.add(actionId);
    this.showGlobalLoading(title, opts?.subMessage ?? '');
    let timeoutId: number | null = null;
    if ((opts?.timeoutMs ?? 0) > 0) {
      timeoutId = window.setTimeout(() => {
        this.updateGlobalLoading(title, opts?.timeoutMessage ?? 'Still working... server is taking longer than usual.');
        opts?.onTimeout?.();
      }, opts?.timeoutMs);
    }
    try {
      return await task();
    } finally {
      if (timeoutId !== null) clearTimeout(timeoutId);
      this.inFlightActions.delete(actionId);
      await this.hideGlobalLoading();
    }
  }

  private showModeMenu() {
    this.state = 'mode';
    this.audio.setAppState('menu');
    this.container.innerHTML = '';
    const compactLayout = window.innerHeight < 860;
    const wrap = document.createElement('div');
    wrap.style.cssText = `
      width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:${compactLayout ? 'flex-start' : 'center'};
      background:radial-gradient(circle at center,#080808 0%,#000 70%);
      color:#f0f0f0;font-family:${UI_FONT_FAMILY}; overflow:auto;
      padding:${compactLayout ? '10px 10px 14px' : '18px 14px 22px'}; box-sizing:border-box;
    `;
    const hero = document.createElement('div');
    hero.style.cssText = `width:min(900px,96vw);margin-bottom:${compactLayout ? '8px' : '12px'};`;
    wrap.appendChild(hero);
    const card = document.createElement('div');
    card.style.cssText = `
      width:min(520px,92vw);background:#090909;border:1px solid #2b2b2b;border-radius:10px;
      padding:${compactLayout ? '16px' : '24px'};box-shadow:0 0 24px rgba(255,255,255,0.08);
    `;
    wrap.appendChild(card);
    const title = document.createElement('h1');
    title.textContent = 'CHAINDUEL3D';
    title.style.cssText = `
      font-size: clamp(42px, 9vw, 72px);
      margin: 0 0 6px 0;
      letter-spacing: clamp(5px, 1.4vw, 12px);
      color: #fff;
      text-align: center;
      text-shadow: 0 0 28px rgba(255,255,255,0.28), 0 0 70px rgba(255,255,255,0.08);
      animation: pulse 2s ease-in-out infinite;
    `;
    hero.appendChild(title);
    const subtitle = document.createElement('div');
    subtitle.textContent = 'ANATOMY OF BITCOIN CHAINS';
    subtitle.style.cssText = `
      font-size: clamp(11px, 1.6vw, 14px);
      color: #9f9f9f;
      margin-bottom: ${compactLayout ? '10px' : '14px'};
      letter-spacing: clamp(2px, 0.6vw, 6px);
      text-shadow: 0 0 18px rgba(255,255,255,0.1);
      text-align: center;
    `;
    hero.appendChild(subtitle);
    const localBtn = document.createElement('button');
    localBtn.textContent = 'LOCAL';
    localBtn.style.cssText = this.modeBtnCss(true);
    localBtn.onclick = () => this.showLobby();
    card.appendChild(localBtn);
    const onlineBtn = document.createElement('button');
    onlineBtn.textContent = 'ONLINE';
    onlineBtn.style.cssText = this.modeBtnCss(false);
    onlineBtn.onclick = () => this.showOnlineEntry();
    card.appendChild(onlineBtn);
    const adminBtn = document.createElement('button');
    adminBtn.textContent = 'ADMIN';
    adminBtn.style.cssText = this.modeBtnCss(false);
    adminBtn.onclick = () => this.showAdminMenu();
    card.appendChild(adminBtn);
    const howBtn = document.createElement('button');
    howBtn.textContent = 'HOW TO PLAY';
    howBtn.style.cssText = this.modeBtnCss(false);
    howBtn.onclick = () => this.showHowToPlay();
    card.appendChild(howBtn);
    const settingsBtn = document.createElement('button');
    settingsBtn.textContent = 'SETTINGS';
    settingsBtn.style.cssText = this.modeBtnCss(false);
    settingsBtn.onclick = () => this.showSettingsMenu();
    card.appendChild(settingsBtn);
    if (this.bootLoading || this.bootLoadFailed) {
      const bootStatus = document.createElement('div');
      bootStatus.style.cssText = 'margin-top:10px;font-size:12px;color:#9f9f9f;min-height:18px;';
      bootStatus.textContent = this.bootLoading
        ? 'Loading game shell...'
        : 'Using offline defaults. Route service unavailable.';
      card.appendChild(bootStatus);
    }
    const style = document.createElement('style');
    style.textContent = `
      @keyframes pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.82; }
      }
    `;
    wrap.appendChild(style);
    this.decorateInteractiveElements(card);
    this.container.appendChild(wrap);
    if (this.onlineInviteCodeFromUrl) {
      const invite = this.onlineInviteCodeFromUrl;
      this.onlineInviteCodeFromUrl = null;
      setTimeout(() => this.showOnlineEntry(invite), 50);
    }
  }

  private modeBtnCss(primary: boolean): string {
    return `
      width:100%;padding:14px;margin-top:10px;border-radius:6px;cursor:pointer;
      border:1px solid ${primary ? '#efefef' : '#2f2f2f'};
      background:${primary ? 'linear-gradient(135deg,#efefef,#cdcdcd)' : '#101010'};
      color:${primary ? '#000' : '#ddd'};
      font-size:18px;letter-spacing:1px;font-family:${UI_FONT_FAMILY};
      transition:transform 0.12s ease, box-shadow 0.2s ease, border-color 0.2s ease;
    `;
  }

  private showSettingsMenu() {
    this.state = 'settings';
    this.audio.setAppState('menu');
    this.container.innerHTML = '';
    const compactLayout = window.innerHeight < 860;
    const wrap = document.createElement('div');
    wrap.style.cssText = `
      width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:${compactLayout ? 'flex-start' : 'center'};
      background:radial-gradient(circle at center,#080808 0%,#000 70%);
      color:#f0f0f0;font-family:${UI_FONT_FAMILY}; overflow:auto;
      padding:${compactLayout ? '10px 10px 14px' : '18px 14px 22px'}; box-sizing:border-box;
    `;

    const card = document.createElement('div');
    card.style.cssText = `
      width:min(560px,92vw);background:#090909;border:1px solid #2b2b2b;border-radius:10px;
      padding:${compactLayout ? '14px' : '20px'};box-shadow:0 0 24px rgba(255,255,255,0.08);
    `;
    const title = document.createElement('div');
    title.textContent = 'SETTINGS';
    title.style.cssText = 'font-size:18px;letter-spacing:2px;color:#fff;margin-bottom:8px;';
    card.appendChild(title);
    this.renderAudioSettingsCard(card);
    const labBox = document.createElement('div');
    labBox.style.cssText = 'margin-top:10px;padding:10px;border:1px solid #2d2d2d;border-radius:8px;background:#0d0d0d;';
    const labTitle = document.createElement('div');
    labTitle.textContent = 'MUSIC LAB';
    labTitle.style.cssText = 'color:#fff;font-size:12px;letter-spacing:1px;margin-bottom:8px;';
    labBox.appendChild(labTitle);
    const labDesc = document.createElement('div');
    labDesc.textContent = 'Build and edit your own menu/race techno loops.';
    labDesc.style.cssText = 'font-size:11px;color:#a8a8a8;margin-bottom:8px;';
    labBox.appendChild(labDesc);
    const menuBtn = document.createElement('button');
    menuBtn.textContent = 'EDIT MENU MUSIC';
    menuBtn.style.cssText = this.modeBtnCss(false);
    menuBtn.onclick = () => this.openMusicBuilder('menu');
    labBox.appendChild(menuBtn);
    const raceBtn = document.createElement('button');
    raceBtn.textContent = 'EDIT RACE MUSIC';
    raceBtn.style.cssText = this.modeBtnCss(false);
    raceBtn.onclick = () => this.openMusicBuilder('race');
    labBox.appendChild(raceBtn);
    card.appendChild(labBox);

    const backBtn = document.createElement('button');
    backBtn.textContent = 'BACK';
    backBtn.style.cssText = this.backBtnCss();
    backBtn.onclick = () => this.showModeMenu();
    card.appendChild(backBtn);

    wrap.appendChild(card);
    this.decorateInteractiveElements(card);
    this.container.appendChild(wrap);
  }

  private attachAudioUiDelegates() {
    window.addEventListener('keydown', event => {
      if (event.key !== 'F8') return;
      event.preventDefault();
      this.audioDiagOverlayEnabled = !this.audioDiagOverlayEnabled;
      if (this.audioDiagOverlayEnabled) {
        this.ensureAudioDiagnosticsOverlay();
      } else {
        this.disableAudioDiagnosticsOverlay();
      }
    });
    this.container.addEventListener('pointerover', event => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      if (target.closest('button,[role="button"],summary')) {
        this.audio.events.onUiHover();
      }
    });
    this.container.addEventListener('click', event => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      const button = target.closest('button,[role="button"],summary') as HTMLElement | null;
      if (!button) return;
      const text = (button.textContent ?? '').toLowerCase();
      if (text.includes('back') || text.includes('leave')) {
        this.audio.events.onUiClick('back');
        return;
      }
      if (
        text.includes('start')
        || text.includes('join')
        || text.includes('create')
        || text.includes('save')
        || text.includes('apply')
        || text.includes('publish')
        || text.includes('continue')
      ) {
        this.audio.events.onUiClick('confirm');
        return;
      }
      this.audio.events.onUiClick('default');
    });
  }

  private ensureAudioDiagnosticsOverlay() {
    if (!this.audioDiagOverlayEl) {
      const panel = document.createElement('div');
      panel.style.cssText = `
        position:fixed;right:10px;top:10px;z-index:9999;pointer-events:none;
        font:11px 'Courier New', monospace;color:#dcdcdc;background:rgba(0,0,0,0.78);
        border:1px solid #333;padding:6px 8px;border-radius:6px;min-width:220px;
      `;
      document.body.appendChild(panel);
      this.audioDiagOverlayEl = panel;
    }
    if (this.audioDiagRaf) cancelAnimationFrame(this.audioDiagRaf);
    const tick = () => {
      if (!this.audioDiagOverlayEnabled || !this.audioDiagOverlayEl) return;
      const d = this.audio.getDiagnostics();
      this.audioDiagOverlayEl.textContent =
        `audio ${d.unlocked ? 'ready' : 'locked'} | voices ${d.activeVoices} | dropped ${d.droppedByVoiceLimit}/${d.droppedByCueLimit} | decodeErr ${d.failedDecodes}`;
      this.audioDiagRaf = requestAnimationFrame(tick);
    };
    tick();
  }

  private disableAudioDiagnosticsOverlay() {
    if (this.audioDiagRaf) {
      cancelAnimationFrame(this.audioDiagRaf);
      this.audioDiagRaf = 0;
    }
    this.audioDiagOverlayEl?.remove();
    this.audioDiagOverlayEl = null;
  }

  private renderAudioSettingsCard(parent: HTMLElement) {
    const settings = this.audio.getSettings();
    const box = document.createElement('div');
    box.style.cssText = 'margin-top:10px;padding:10px;border:1px solid #2d2d2d;border-radius:8px;background:#0d0d0d;';
    const title = document.createElement('div');
    title.textContent = 'AUDIO';
    title.style.cssText = 'color:#fff;font-size:12px;letter-spacing:1px;margin-bottom:8px;';
    box.appendChild(title);
    const makeSlider = (label: string, key: 'masterVolume' | 'musicVolume' | 'sfxGameplayVolume' | 'sfxUiVolume') => {
      const row = document.createElement('label');
      row.style.cssText = 'display:grid;grid-template-columns:98px 1fr 34px;gap:8px;align-items:center;margin-top:6px;font-size:11px;color:#a9a9a9;';
      const name = document.createElement('span');
      name.textContent = label;
      const input = document.createElement('input');
      input.type = 'range';
      input.min = '0';
      input.max = '100';
      input.value = String(Math.round(settings[key] * 100));
      input.style.cssText = 'accent-color:#dfdfdf;';
      const out = document.createElement('span');
      out.textContent = `${input.value}%`;
      input.oninput = () => {
        out.textContent = `${input.value}%`;
        this.audio.updateSettings({ [key]: Number(input.value) / 100 });
      };
      row.appendChild(name);
      row.appendChild(input);
      row.appendChild(out);
      return row;
    };
    box.appendChild(makeSlider('MASTER', 'masterVolume'));
    box.appendChild(makeSlider('MUSIC', 'musicVolume'));
    box.appendChild(makeSlider('GAME SFX', 'sfxGameplayVolume'));
    box.appendChild(makeSlider('UI SFX', 'sfxUiVolume'));

    const toggles = document.createElement('div');
    toggles.style.cssText = 'display:flex;gap:10px;flex-wrap:wrap;margin-top:8px;';
    const makeCheck = (label: string, checked: boolean, onToggle: (next: boolean) => void) => {
      const wrap = document.createElement('label');
      wrap.style.cssText = 'display:flex;align-items:center;gap:5px;font-size:11px;color:#c4c4c4;';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = checked;
      input.style.cssText = 'accent-color:#e0e0e0;';
      input.onchange = () => onToggle(input.checked);
      wrap.appendChild(input);
      wrap.appendChild(document.createTextNode(label));
      return wrap;
    };
    toggles.appendChild(makeCheck('MUTE', settings.masterMuted, next => this.audio.updateSettings({ masterMuted: next })));
    toggles.appendChild(makeCheck('REDUCED SENSORY', settings.reducedSensoryMode, next => {
      this.audio.updateSettings({
        reducedSensoryMode: next,
        sfxGameplayVolume: next ? Math.min(0.75, this.audio.getSettings().sfxGameplayVolume) : this.audio.getSettings().sfxGameplayVolume,
      });
    }));
    box.appendChild(toggles);

    const rangeRow = document.createElement('div');
    rangeRow.style.cssText = 'display:grid;grid-template-columns:98px 1fr;gap:8px;align-items:center;margin-top:8px;font-size:11px;color:#a9a9a9;';
    const rangeLabel = document.createElement('span');
    rangeLabel.textContent = 'DYNAMICS';
    const rangeSelect = document.createElement('select');
    rangeSelect.style.cssText = 'background:#101010;border:1px solid #2f2f2f;border-radius:4px;color:#ddd;padding:4px;';
    rangeSelect.innerHTML = `
      <option value="full">FULL</option>
      <option value="medium">MEDIUM</option>
      <option value="low">LOW</option>
    `;
    rangeSelect.value = settings.dynamicRangeMode;
    rangeSelect.onchange = () => this.audio.updateSettings({ dynamicRangeMode: rangeSelect.value as DynamicRangeMode });
    rangeRow.appendChild(rangeLabel);
    rangeRow.appendChild(rangeSelect);
    box.appendChild(rangeRow);

    const diagRow = document.createElement('div');
    diagRow.style.cssText = 'margin-top:8px;font-size:10px;color:#7e7e7e;';
    const updateDiag = () => {
      if (!diagRow.isConnected) return;
      const diag = this.audio.getDiagnostics();
      diagRow.textContent =
        `audio: ${diag.unlocked ? 'ready' : 'locked'} | voices ${diag.activeVoices} | dropped ${diag.droppedByVoiceLimit}/${diag.droppedByCueLimit} | buffers ${diag.decodedBufferCount}`;
      setTimeout(updateDiag, 750);
    };
    updateDiag();
    box.appendChild(diagRow);

    const quickFixRow = document.createElement('div');
    quickFixRow.style.cssText = 'margin-top:8px;display:flex;gap:8px;flex-wrap:wrap;';
    const flattenMenuLeadBtn = document.createElement('button');
    flattenMenuLeadBtn.textContent = 'REMOVE MENU SCALE MELODY';
    flattenMenuLeadBtn.style.cssText = 'padding:6px 10px;border:1px solid #3a3a3a;border-radius:4px;background:#121212;color:#e3e3e3;font-size:10px;cursor:pointer;letter-spacing:0.4px;';
    flattenMenuLeadBtn.onclick = () => {
      this.menuMusicPreset = {
        ...this.menuMusicPreset,
        lead: 0,
        brightness: Math.min(this.menuMusicPreset.brightness, 0.45),
        leadPattern: new Array(16).fill(-1),
      };
      this.applyMusicLabPresetToEngine('menu');
      this.saveMusicLabPresets();
      this.audio.setAppState('menu');
      flattenMenuLeadBtn.textContent = 'MENU MELODY REMOVED';
      setTimeout(() => {
        if (flattenMenuLeadBtn.isConnected) flattenMenuLeadBtn.textContent = 'REMOVE MENU SCALE MELODY';
      }, 1400);
    };
    quickFixRow.appendChild(flattenMenuLeadBtn);

    const chimeToggle = document.createElement('label');
    chimeToggle.style.cssText = 'display:flex;align-items:center;gap:6px;padding:6px 8px;border:1px solid #3a3a3a;border-radius:4px;background:#121212;color:#e3e3e3;font-size:10px;letter-spacing:0.3px;';
    const chimeInput = document.createElement('input');
    chimeInput.type = 'checkbox';
    chimeInput.style.cssText = 'accent-color:#efefef;';
    const uiChimeCues = ['ui_hover', 'ui_click', 'ui_back', 'ui_confirm'];
    chimeInput.checked = uiChimeCues.every(cue => this.audio.isCueDisabled(cue));
    chimeInput.onchange = () => {
      for (const cueId of uiChimeCues) this.audio.setCueDisabled(cueId, chimeInput.checked);
    };
    chimeToggle.appendChild(chimeInput);
    chimeToggle.appendChild(document.createTextNode('MUTE MENU CHIMES'));
    quickFixRow.appendChild(chimeToggle);
    box.appendChild(quickFixRow);

    const cueSection = document.createElement('details');
    cueSection.style.cssText = 'margin-top:10px;border:1px solid #282828;border-radius:6px;background:#0a0a0a;';
    const cueSummary = document.createElement('summary');
    cueSummary.textContent = 'SOUND LIBRARY (mute sounds you hate)';
    cueSummary.style.cssText = 'cursor:pointer;padding:8px 10px;font-size:11px;color:#d7d7d7;letter-spacing:0.5px;';
    cueSection.appendChild(cueSummary);
    const cueBody = document.createElement('div');
    cueBody.style.cssText = 'padding:8px 10px;display:grid;gap:6px;';
    const cues = this.audio.getCues();
    for (const cue of cues) {
      const row = document.createElement('div');
      row.style.cssText = 'display:grid;grid-template-columns:1fr auto auto;gap:8px;align-items:center;font-size:11px;color:#c2c2c2;';
      const label = document.createElement('span');
      label.textContent = `${cue.id} (${cue.category})`;
      const previewBtn = document.createElement('button');
      previewBtn.textContent = 'TEST';
      previewBtn.style.cssText = 'padding:4px 7px;border:1px solid #353535;border-radius:4px;background:#121212;color:#d7d7d7;font-size:10px;cursor:pointer;';
      previewBtn.onclick = () => {
        if (cue.loop) {
          void this.audio.engine.playLoop(cue.id);
          setTimeout(() => this.audio.engine.stopCue(cue.id), 1800);
        } else {
          void this.audio.engine.playCue(cue.id);
        }
      };
      const mute = document.createElement('label');
      mute.style.cssText = 'display:flex;align-items:center;gap:4px;font-size:10px;color:#d0d0d0;';
      const muteInput = document.createElement('input');
      muteInput.type = 'checkbox';
      muteInput.checked = this.audio.isCueDisabled(cue.id);
      muteInput.style.cssText = 'accent-color:#efefef;';
      muteInput.onchange = () => {
        this.audio.setCueDisabled(cue.id, muteInput.checked);
      };
      mute.appendChild(muteInput);
      mute.appendChild(document.createTextNode('MUTE'));
      row.appendChild(label);
      row.appendChild(previewBtn);
      row.appendChild(mute);
      cueBody.appendChild(row);
    }
    cueSection.appendChild(cueBody);
    box.appendChild(cueSection);

    parent.appendChild(box);
  }

  private loadMusicLabPresets() {
    try {
      const raw = window.localStorage.getItem(MUSIC_LAB_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<Record<MusicLabTrack, Partial<MusicLabPreset>>>;
      if (parsed.menu) this.menuMusicPreset = normalizeMusicLabPreset(parsed.menu, 'menu');
      if (parsed.race) this.raceMusicPreset = normalizeMusicLabPreset(parsed.race, 'race');
    } catch {
      // Keep defaults if preset parsing fails.
    }
  }

  private saveMusicLabPresets() {
    try {
      window.localStorage.setItem(MUSIC_LAB_STORAGE_KEY, JSON.stringify({
        menu: this.menuMusicPreset,
        race: this.raceMusicPreset,
      }));
    } catch {
      // Ignore storage quota/permission errors.
    }
  }

  private applyMusicLabPresetToEngine(track: MusicLabTrack) {
    const preset = track === 'menu' ? this.menuMusicPreset : this.raceMusicPreset;
    const samples = renderMusicLabLoop(44100, 8, track, preset);
    const cueId = track === 'menu' ? 'music_menu_loop' : 'music_race_loop';
    this.audio.engine.setCustomLoopBuffer(cueId, samples, 44100);
  }

  private drawMusicLabWaveform(canvas: HTMLCanvasElement, track: MusicLabTrack, preset: MusicLabPreset) {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#090909';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#252525';
    ctx.beginPath();
    ctx.moveTo(0, h / 2);
    ctx.lineTo(w, h / 2);
    ctx.stroke();
    const samples = renderMusicLabLoop(1200, 2, track, preset);
    ctx.strokeStyle = '#efefef';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    for (let x = 0; x < w; x++) {
      const idx = Math.floor((x / (w - 1)) * (samples.length - 1));
      const y = h * 0.5 - samples[idx] * (h * 0.36);
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  private openMusicBuilder(track: MusicLabTrack) {
    const base = track === 'menu' ? this.menuMusicPreset : this.raceMusicPreset;
    const draft: MusicLabPreset = { ...base };
    const modal = document.createElement('div');
    modal.style.cssText = `
      position:absolute; inset:0; z-index:260; display:flex; align-items:center; justify-content:center;
      background:rgba(0,0,0,0.78); font-family:${UI_FONT_FAMILY};
    `;
    const card = document.createElement('div');
    const closeBuilder = () => {
      modal.remove();
      // Music Lab lives inside settings/menu flow, so always restore menu-state
      // routing after preview/apply interactions to avoid stuck/incorrect loops.
      this.audio.setAppState('menu');
    };

    card.style.cssText = `
      width:min(720px,96vw); max-height:92vh; overflow:auto;
      background:#0a0a0a;border:1px solid #2e2e2e;border-radius:10px;padding:14px;
      color:#efefef; box-shadow:0 0 24px rgba(255,255,255,0.08);
    `;
    const title = document.createElement('div');
    title.textContent = track === 'menu' ? 'MUSIC LAB - MENU LOOP' : 'MUSIC LAB - RACE LOOP';
    title.style.cssText = 'font-size:14px;letter-spacing:1px;color:#fff;margin-bottom:8px;';
    card.appendChild(title);
    const wave = document.createElement('canvas');
    wave.width = 640;
    wave.height = 180;
    wave.style.cssText = 'width:100%;height:180px;border:1px solid #2d2d2d;border-radius:8px;background:#090909;';
    card.appendChild(wave);
    this.drawMusicLabWaveform(wave, track, draft);

    const controls = document.createElement('div');
    controls.style.cssText = 'margin-top:10px;display:grid;grid-template-columns:1fr 1fr;gap:8px;';
    type NumericKey =
      | 'bpm'
      | 'energy'
      | 'brightness'
      | 'bass'
      | 'lead'
      | 'swing'
      | 'kickLevel'
      | 'kickPitchStart'
      | 'kickPitchEnd'
      | 'kickDecay'
      | 'bassLevel'
      | 'leadLevel'
      | 'hatLevel'
      | 'leadAir'
      | 'rootMidi';
    const defs: Array<{ key: NumericKey; label: string; min: number; max: number; step: number }> = [
      { key: 'bpm', label: 'BPM', min: 90, max: 170, step: 1 },
      { key: 'energy', label: 'ENERGY', min: 0, max: 1, step: 0.01 },
      { key: 'brightness', label: 'BRIGHTNESS', min: 0, max: 1, step: 0.01 },
      { key: 'bass', label: 'BASS', min: 0, max: 1, step: 0.01 },
      { key: 'lead', label: 'LEAD', min: 0, max: 1, step: 0.01 },
      { key: 'swing', label: 'SWING', min: 0, max: 1, step: 0.01 },
      { key: 'kickPitchStart', label: 'KICK TONE', min: 0, max: 1, step: 0.01 },
      { key: 'kickPitchEnd', label: 'KICK BODY', min: 0, max: 1, step: 0.01 },
      { key: 'kickDecay', label: 'KICK DECAY', min: 0, max: 1, step: 0.01 },
      { key: 'rootMidi', label: 'ROOT MIDI', min: 36, max: 72, step: 1 },
    ];
    for (const d of defs) {
      const row = document.createElement('label');
      row.style.cssText = 'display:grid;grid-template-columns:90px 1fr 48px;gap:8px;align-items:center;font-size:11px;color:#bcbcbc;';
      const name = document.createElement('span');
      name.textContent = d.label;
      const input = document.createElement('input');
      input.type = 'range';
      input.min = String(d.min);
      input.max = String(d.max);
      input.step = String(d.step);
      input.value = String(draft[d.key]);
      input.style.cssText = 'accent-color:#efefef;';
      const out = document.createElement('span');
      out.textContent = d.key === 'bpm' ? String(draft[d.key]) : Number(draft[d.key]).toFixed(2);
      input.oninput = () => {
        draft[d.key] = d.key === 'bpm' ? Number(input.value) : Number(input.value);
        out.textContent = d.key === 'bpm' ? String(Math.round(draft[d.key])) : Number(draft[d.key]).toFixed(2);
        this.drawMusicLabWaveform(wave, track, draft);
      };
      row.appendChild(name);
      row.appendChild(input);
      row.appendChild(out);
      controls.appendChild(row);
    }
    card.appendChild(controls);

    const kickDesigner = document.createElement('div');
    kickDesigner.style.cssText = 'margin-top:10px;padding-top:10px;border-top:1px solid #252525;';
    const kickTitle = document.createElement('div');
    kickTitle.textContent = 'KICK DESIGNER (drag dot)';
    kickTitle.style.cssText = 'font-size:11px;color:#dfdfdf;letter-spacing:0.8px;margin-bottom:6px;';
    kickDesigner.appendChild(kickTitle);
    const kickHint = document.createElement('div');
    kickHint.textContent = 'X = tone start, Y = body depth. Kick decay uses slider above.';
    kickHint.style.cssText = 'font-size:10px;color:#8d8d8d;margin-bottom:6px;';
    kickDesigner.appendChild(kickHint);
    const kickPad = document.createElement('canvas');
    kickPad.width = 300;
    kickPad.height = 110;
    kickPad.style.cssText = 'width:100%;height:110px;border:1px solid #2f2f2f;border-radius:8px;background:#0e0e0e;cursor:crosshair;';
    const drawKickPad = () => {
      const ctx = kickPad.getContext('2d');
      if (!ctx) return;
      const w = kickPad.width;
      const h = kickPad.height;
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = '#0c0c0c';
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = '#1f1f1f';
      for (let i = 1; i < 6; i++) {
        const x = (w / 6) * i;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
      }
      for (let i = 1; i < 4; i++) {
        const y = (h / 4) * i;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }
      const px = draft.kickPitchStart * w;
      const py = (1 - draft.kickPitchEnd) * h;
      ctx.fillStyle = '#f0f0f0';
      ctx.beginPath();
      ctx.arc(px, py, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#000';
      ctx.stroke();
    };
    const updateKickPadFromPointer = (clientX: number, clientY: number) => {
      const rect = kickPad.getBoundingClientRect();
      const nx = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      const ny = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
      draft.kickPitchStart = nx;
      draft.kickPitchEnd = 1 - ny;
      drawKickPad();
      this.drawMusicLabWaveform(wave, track, draft);
    };
    kickPad.addEventListener('pointerdown', event => {
      event.preventDefault();
      kickPad.setPointerCapture(event.pointerId);
      updateKickPadFromPointer(event.clientX, event.clientY);
    });
    kickPad.addEventListener('pointermove', event => {
      if ((event.buttons & 1) === 0) return;
      updateKickPadFromPointer(event.clientX, event.clientY);
    });
    drawKickPad();
    kickDesigner.appendChild(kickPad);
    card.appendChild(kickDesigner);

    const mixer = document.createElement('div');
    mixer.style.cssText = 'margin-top:10px;padding-top:10px;border-top:1px solid #252525;';
    const mixerTitle = document.createElement('div');
    mixerTitle.textContent = 'GRAPHICAL MIXER (drag up/down)';
    mixerTitle.style.cssText = 'font-size:11px;color:#dfdfdf;letter-spacing:0.8px;margin-bottom:8px;';
    mixer.appendChild(mixerTitle);
    const mixerGrid = document.createElement('div');
    mixerGrid.style.cssText = 'display:grid;grid-template-columns:repeat(5,1fr);gap:10px;align-items:end;';
    const syncMixerFromDraft = () => {
      const strips = mixerGrid.querySelectorAll<HTMLDivElement>('[data-mixer-key]');
      for (const stripWrap of strips) {
        const key = stripWrap.dataset.mixerKey as 'kickLevel' | 'bassLevel' | 'leadLevel' | 'hatLevel' | 'leadAir';
        const fill = stripWrap.querySelector<HTMLDivElement>('[data-role="fill"]');
        const valueText = stripWrap.querySelector<HTMLDivElement>('[data-role="value"]');
        if (!fill || !valueText) continue;
        const value = draft[key];
        fill.style.height = `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`;
        valueText.textContent = `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`;
      }
    };
    const createMixerStrip = (label: string, key: 'kickLevel' | 'bassLevel' | 'leadLevel' | 'hatLevel' | 'leadAir') => {
      const stripWrap = document.createElement('div');
      stripWrap.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:5px;';
      stripWrap.dataset.mixerKey = key;
      const strip = document.createElement('div');
      strip.style.cssText = 'position:relative;width:34px;height:132px;border:1px solid #303030;border-radius:8px;background:#101010;cursor:ns-resize;';
      const fill = document.createElement('div');
      fill.style.cssText = 'position:absolute;left:0;right:0;bottom:0;border-radius:7px;background:linear-gradient(180deg,#e2e2e2,#8f8f8f);';
      fill.dataset.role = 'fill';
      const valueText = document.createElement('div');
      valueText.style.cssText = 'font-size:10px;color:#a9a9a9;';
      valueText.dataset.role = 'value';
      const cap = document.createElement('div');
      cap.textContent = label;
      cap.style.cssText = 'font-size:10px;color:#d2d2d2;letter-spacing:0.5px;';
      const applyLevel = (level: number) => {
        const clamped = Math.max(0, Math.min(1, level));
        draft[key] = clamped;
        fill.style.height = `${Math.round(clamped * 100)}%`;
        valueText.textContent = `${Math.round(clamped * 100)}%`;
      };
      applyLevel(draft[key]);
      const updateFromPointer = (clientY: number) => {
        const rect = strip.getBoundingClientRect();
        const ratio = 1 - (clientY - rect.top) / rect.height;
        applyLevel(ratio);
        this.drawMusicLabWaveform(wave, track, draft);
      };
      strip.addEventListener('pointerdown', event => {
        event.preventDefault();
        strip.setPointerCapture(event.pointerId);
        updateFromPointer(event.clientY);
      });
      strip.addEventListener('pointermove', event => {
        if ((event.buttons & 1) === 0) return;
        updateFromPointer(event.clientY);
      });
      fill.style.pointerEvents = 'none';
      strip.appendChild(fill);
      stripWrap.appendChild(strip);
      stripWrap.appendChild(valueText);
      stripWrap.appendChild(cap);
      return stripWrap;
    };
    mixerGrid.appendChild(createMixerStrip('KICK', 'kickLevel'));
    mixerGrid.appendChild(createMixerStrip('BASS', 'bassLevel'));
    mixerGrid.appendChild(createMixerStrip('LEAD', 'leadLevel'));
    mixerGrid.appendChild(createMixerStrip('HAT', 'hatLevel'));
    mixerGrid.appendChild(createMixerStrip('AIR', 'leadAir'));
    mixer.appendChild(mixerGrid);
    card.appendChild(mixer);

    const advanced = document.createElement('div');
    advanced.style.cssText = 'margin-top:10px;padding-top:10px;border-top:1px solid #252525;';
    const advTitle = document.createElement('div');
    advTitle.textContent = 'ADVANCED SYNTH/SEQUENCER';
    advTitle.style.cssText = 'font-size:11px;color:#dfdfdf;letter-spacing:0.8px;margin-bottom:8px;';
    advanced.appendChild(advTitle);

    const selectRow = document.createElement('div');
    selectRow.style.cssText = 'display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;';
    const mkSelect = (
      label: string,
      options: Array<{ value: string; label: string }>,
      value: string,
      onChange: (value: string) => void,
    ) => {
      const wrap = document.createElement('label');
      wrap.style.cssText = 'display:grid;grid-template-columns:1fr;gap:4px;font-size:10px;color:#b0b0b0;';
      const cap = document.createElement('span');
      cap.textContent = label;
      const sel = document.createElement('select');
      sel.style.cssText = 'background:#101010;border:1px solid #2f2f2f;border-radius:4px;color:#ddd;padding:5px;';
      for (const opt of options) {
        const el = document.createElement('option');
        el.value = opt.value;
        el.textContent = opt.label;
        if (opt.value === value) el.selected = true;
        sel.appendChild(el);
      }
      sel.onchange = () => {
        onChange(sel.value);
        this.drawMusicLabWaveform(wave, track, draft);
      };
      wrap.appendChild(cap);
      wrap.appendChild(sel);
      return wrap;
    };
    selectRow.appendChild(mkSelect(
      'SCALE',
      [
        { value: 'minor', label: 'MINOR' },
        { value: 'major', label: 'MAJOR' },
        { value: 'dorian', label: 'DORIAN' },
        { value: 'phrygian', label: 'PHRYGIAN' },
      ],
      draft.scale,
      value => { draft.scale = value as MusicLabPreset['scale']; },
    ));
    selectRow.appendChild(mkSelect(
      'BASS WAVE',
      [
        { value: 'sawtooth', label: 'SAW' },
        { value: 'triangle', label: 'TRI' },
        { value: 'square', label: 'SQR' },
        { value: 'sine', label: 'SIN' },
      ],
      draft.bassWave,
      value => { draft.bassWave = value as MusicLabPreset['bassWave']; },
    ));
    selectRow.appendChild(mkSelect(
      'LEAD WAVE',
      [
        { value: 'sawtooth', label: 'SAW' },
        { value: 'triangle', label: 'TRI' },
        { value: 'square', label: 'SQR' },
        { value: 'sine', label: 'SIN' },
      ],
      draft.leadWave,
      value => { draft.leadWave = value as MusicLabPreset['leadWave']; },
    ));
    advanced.appendChild(selectRow);

    const noteOptions = [
      { value: '-1', label: 'OFF' },
      { value: '0', label: 'R' },
      { value: '1', label: '2' },
      { value: '2', label: 'b3' },
      { value: '3', label: '4' },
      { value: '4', label: '5' },
      { value: '5', label: 'b6' },
      { value: '6', label: 'b7' },
      { value: '7', label: '8' },
      { value: '8', label: '9' },
    ];
    const noteLabel = (value: number) => noteOptions.find(x => Number(x.value) === value)?.label ?? 'OFF';
    const buildPatternGrid = (titleText: string, key: 'bassPattern' | 'leadPattern') => {
      const wrap = document.createElement('div');
      wrap.style.cssText = 'margin-top:10px;';
      const label = document.createElement('div');
      label.textContent = titleText;
      label.style.cssText = 'font-size:10px;color:#afafaf;margin-bottom:4px;';
      wrap.appendChild(label);
      const hint = document.createElement('div');
      hint.textContent = 'Drag a note from palette and drop on a step';
      hint.style.cssText = 'font-size:10px;color:#7f7f7f;margin-bottom:5px;';
      wrap.appendChild(hint);
      const palette = document.createElement('div');
      palette.style.cssText = 'display:flex;gap:4px;flex-wrap:wrap;margin-bottom:6px;';
      for (const opt of noteOptions) {
        const chip = document.createElement('div');
        chip.textContent = opt.label;
        chip.draggable = true;
        chip.style.cssText = 'padding:3px 6px;border:1px solid #333;border-radius:4px;background:#141414;color:#d8d8d8;font-size:10px;cursor:grab;';
        chip.addEventListener('dragstart', event => {
          event.dataTransfer?.setData('text/plain', opt.value);
        });
        palette.appendChild(chip);
      }
      wrap.appendChild(palette);
      const grid = document.createElement('div');
      grid.style.cssText = 'display:grid;grid-template-columns:repeat(8,minmax(0,1fr));gap:4px;';
      for (let i = 0; i < 16; i++) {
        const cell = document.createElement('div');
        cell.style.cssText = `
          background:${i % 4 === 0 ? '#1a1a1a' : '#101010'};
          border:1px solid #2f2f2f;border-radius:4px;color:#ddd;padding:8px 4px;font-size:10px;
          text-align:center;user-select:none;
        `;
        cell.textContent = `${i + 1}:${noteLabel(draft[key][i])}`;
        cell.addEventListener('dragover', event => {
          event.preventDefault();
          cell.style.borderColor = '#efefef';
        });
        cell.addEventListener('dragleave', () => {
          cell.style.borderColor = '#2f2f2f';
        });
        cell.addEventListener('drop', event => {
          event.preventDefault();
          cell.style.borderColor = '#2f2f2f';
          const dropped = Number(event.dataTransfer?.getData('text/plain') ?? '-1');
          draft[key][i] = Number.isFinite(dropped) ? dropped : -1;
          cell.textContent = `${i + 1}:${noteLabel(draft[key][i])}`;
          this.drawMusicLabWaveform(wave, track, draft);
        });
        cell.addEventListener('click', () => {
          const current = draft[key][i];
          const idx = noteOptions.findIndex(opt => Number(opt.value) === current);
          const next = noteOptions[(idx + 1 + noteOptions.length) % noteOptions.length];
          draft[key][i] = Number(next.value);
          cell.textContent = `${i + 1}:${next.label}`;
          this.drawMusicLabWaveform(wave, track, draft);
        });
        grid.appendChild(cell);
      }
      wrap.appendChild(grid);
      return wrap;
    };
    advanced.appendChild(buildPatternGrid('BASS STEP PATTERN (16) - DRAG & DROP', 'bassPattern'));
    advanced.appendChild(buildPatternGrid('LEAD STEP PATTERN (16) - DRAG & DROP', 'leadPattern'));
    card.appendChild(advanced);

    const buttonRow = document.createElement('div');
    buttonRow.style.cssText = 'display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-top:12px;';
    const mkBtn = (label: string, onClick: () => void, primary = false) => {
      const b = document.createElement('button');
      b.textContent = label;
      b.style.cssText = primary ? this.modeBtnCss(true) : this.modeBtnCss(false);
      b.onclick = onClick;
      return b;
    };
    buttonRow.appendChild(mkBtn('PREVIEW', () => {
      if (track === 'menu') {
        this.audio.engine.stopCue('music_race_loop');
        this.audio.engine.setCustomLoopBuffer('music_menu_loop', renderMusicLabLoop(44100, 8, track, draft), 44100);
        this.audio.setAppState('menu');
      } else {
        this.audio.engine.stopCue('music_menu_loop');
        this.audio.engine.setCustomLoopBuffer('music_race_loop', renderMusicLabLoop(44100, 8, track, draft), 44100);
        void this.audio.engine.playLoop('music_race_loop');
      }
    }, true));
    buttonRow.appendChild(mkBtn('APPLY', () => {
      const normalized = normalizeMusicLabPreset(draft, track);
      if (track === 'menu') this.menuMusicPreset = normalized;
      else this.raceMusicPreset = normalized;
      this.applyMusicLabPresetToEngine(track);
      this.saveMusicLabPresets();
    }, true));
    buttonRow.appendChild(mkBtn('RESET', () => {
      const reset = defaultMusicLabPreset(track);
      Object.assign(draft, JSON.parse(JSON.stringify(reset)));
      this.drawMusicLabWaveform(wave, track, draft);
      for (const input of controls.querySelectorAll<HTMLInputElement>('input[type="range"]')) {
        const key = defs.find(x => x.label === (input.parentElement?.firstChild as HTMLElement)?.textContent)?.key;
        if (!key) continue;
        input.value = String(draft[key]);
        const valueEl = input.parentElement?.querySelector('span:last-child');
        if (valueEl) valueEl.textContent = key === 'bpm' ? String(Math.round(draft[key])) : Number(draft[key]).toFixed(2);
      }
      for (const select of advanced.querySelectorAll<HTMLSelectElement>('select')) {
        const label = select.parentElement?.firstChild?.textContent ?? '';
        if (label === 'SCALE') select.value = draft.scale;
        if (label === 'BASS WAVE') select.value = draft.bassWave;
        if (label === 'LEAD WAVE') select.value = draft.leadWave;
      }
      for (const row of advanced.querySelectorAll<HTMLDivElement>('div[style*="grid-template-columns:repeat(8"] > div')) {
        const txt = row.textContent ?? '';
        const idx = Number((txt.split(':')[0] ?? '1')) - 1;
        const isBass = row.parentElement?.previousElementSibling?.textContent?.includes('BASS') ?? false;
        const source = isBass ? draft.bassPattern : draft.leadPattern;
        const note = source[Math.max(0, Math.min(15, idx))];
        row.textContent = `${idx + 1}:${noteLabel(note)}`;
      }
      syncMixerFromDraft();
      drawKickPad();
    }));
    buttonRow.appendChild(mkBtn('CLOSE', () => closeBuilder()));
    card.appendChild(buttonRow);

    modal.addEventListener('click', event => {
      if (event.target === modal) closeBuilder();
    });
    modal.appendChild(card);
    this.container.appendChild(modal);
    this.decorateInteractiveElements(card);
  }

  private showHowToPlay() {
    this.state = 'how_to_play';
    this.audio.setAppState('menu');
    this.container.innerHTML = '';
    const compactLayout = window.innerHeight < 860;
    const wrap = document.createElement('div');
    wrap.style.cssText = `
      width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:${compactLayout ? 'flex-start' : 'center'};
      background:radial-gradient(circle at center,#080808 0%,#000 70%);
      color:#f0f0f0;font-family:${UI_FONT_FAMILY}; overflow:auto;
      padding:${compactLayout ? '10px 10px 14px' : '18px 14px 22px'}; box-sizing:border-box;
    `;
    const card = document.createElement('div');
    card.style.cssText = `
      width:min(760px,96vw);background:#090909;border:1px solid #2b2b2b;border-radius:10px;
      padding:${compactLayout ? '14px' : '22px'};box-shadow:0 0 24px rgba(255,255,255,0.08);
    `;
    wrap.appendChild(card);

    const title = document.createElement('div');
    title.textContent = 'HOW TO PLAY';
    title.style.cssText = `font-size:clamp(20px,4.6vw,30px);letter-spacing:2px;color:#fff;margin-bottom:${compactLayout ? '10px' : '14px'};`;
    card.appendChild(title);

    const content = document.createElement('div');
    content.style.cssText = `
      display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:10px;
      font-size:13px;line-height:1.5;color:#d7d7d7;
    `;
    const section = (heading: string, body: string) => {
      const box = document.createElement('div');
      box.style.cssText = 'border:1px solid #2b2b2b;border-radius:8px;padding:10px 12px;background:#0d0d0d;';
      box.innerHTML = `<div style="color:#fff;letter-spacing:1px;font-size:12px;margin-bottom:6px">${heading}</div><div>${body}</div>`;
      return box;
    };
    content.appendChild(section(
      'OBJECTIVE',
      'Classic: finish laps as fast as possible.<br/>Derby: survive and build chain advantage while opponents are eliminated.',
    ));
    content.appendChild(section(
      'CONTROLS',
      'P1: W/A/S/D + Drift + Space (item)<br/>P2: Arrows + Drift + Enter (item)<br/>Look back is available in-race; use it for awareness.',
    ));
    content.appendChild(section(
      'ITEMS',
      'Lightning Turbo: short speed burst.<br/>Mempool Mine: drop hazard behind.<br/>Fee Spike: slow nearest rival.<br/>Sats Siphon: steal 1 chain block.<br/>Nostr Zapwave: short-range area slow.',
    ));
    content.appendChild(section(
      'CHAIN BASICS',
      'Your chain is your health/power resource. Losing all blocks eliminates you. Some abilities trade or steal blocks, so pick item timing carefully.',
    ));
    content.appendChild(section(
      'RACE TIPS',
      'Use drift to build boosts for exits.<br/>Take item gates with side-by-side boxes when racing in packs.<br/>Save disruptive items for tight clusters.',
    ));
    content.appendChild(section(
      'MODES',
      'Local: split-screen with AI/humans.<br/>Online: room-based races with host settings and rematches.<br/>Admin: route tools and layout publishing.',
    ));
    card.appendChild(content);

    const backBtn = document.createElement('button');
    backBtn.textContent = 'BACK';
    backBtn.style.cssText = this.backBtnCss();
    backBtn.onclick = () => this.showModeMenu();
    card.appendChild(backBtn);

    this.decorateInteractiveElements(card);
    this.container.appendChild(wrap);
  }

  private showLobby() {
    this.state = 'lobby';
    this.audio.setAppState('lobby');
    this.container.innerHTML = '';
    this.lobbyUI.show();
  }

  private showOnlineEntry(prefillCode = '') {
    this.state = 'online_entry';
    this.audio.setAppState('lobby');
    this.onlineLobbyUI.showEntry({
      onBackToMode: () => this.showModeMenu(),
      onCreate: async (name) => {
        this.audio.events.onUiClick('confirm');
        try {
          this.selectedRouteId = 'default';
          this.gameMode = 'classic';
          const created = await this.runWithLoading(
            'online:create-room',
            'Creating room...',
            () => this.roomClient.createRoom(
              name,
              GAME_CONFIG.TOTAL_LAPS,
              2,
              false,
              this.selectedRouteId,
              this.gameMode,
            ),
            {
              subMessage: 'Allocating lobby and opening socket...',
              timeoutMs: 4000,
              timeoutMessage: 'Still working... server is taking longer than usual.',
            },
          );
          this.onlineMemberId = created.memberId;
          this.showOnlineRoom(created.room);
        } catch (err: any) {
          this.onlineLobbyUI.setStatus(err?.message ?? 'Failed to create room');
        }
      },
      onJoin: async (code, name) => {
        this.audio.events.onUiClick('confirm');
        const joinCode = code || prefillCode;
        if (!joinCode) {
          this.onlineLobbyUI.setStatus('Enter a room code');
          return;
        }
        try {
          const joined = await this.runWithLoading(
            'online:join-room',
            'Joining room...',
            () => this.roomClient.joinRoom(joinCode, name),
            {
              subMessage: 'Verifying code and syncing room...',
              timeoutMs: 4000,
              timeoutMessage: 'Still working... server is taking longer than usual.',
            },
          );
          this.onlineMemberId = joined.memberId;
          this.showOnlineRoom(joined.room);
        } catch (err: any) {
          this.onlineLobbyUI.setStatus(err?.message ?? 'Failed to join room');
        }
      },
    }, prefillCode);
  }

  private showOnlineRoom(room: RoomState) {
    this.state = 'online_room';
    this.audio.setAppState('lobby');
    this.onlineRoom = room;
    if (!this.onlineMemberId) return;
    this.onlineLobbyUI.showRoom(room, this.onlineMemberId, {
      onBack: () => {
        this.audio.events.onUiClick('back');
        this.roomClient.leave();
        this.roomClient.disconnect();
        this.onlineRoom = null;
        this.onlineMemberId = null;
        this.clearInviteQueryParam();
        this.showModeMenu();
      },
      onPatchSettings: async s => {
        this.audio.events.onUiClick('confirm');
        await this.runWithLoading(
          'online:patch-settings',
          'Saving settings...',
          () => this.roomClient.patchSettings(s),
          { timeoutMs: 4000, timeoutMessage: 'Still saving settings...' },
        );
      },
      onStart: async () => {
        this.audio.events.onUiClick('confirm');
        await this.runWithLoading(
          'online:start-race',
          'Starting race...',
          () => this.roomClient.startRace(null, room.settings.routeId),
          { timeoutMs: 4000, timeoutMessage: 'Still starting race...' },
        );
      },
      onSendChat: txt => this.roomClient.sendChat(txt),
      onKick: async memberId => {
        this.audio.events.onUiClick('confirm');
        await this.runWithLoading(
          `online:kick:${memberId}`,
          'Removing player...',
          () => this.roomClient.kickMember(memberId),
          { timeoutMs: 4000, timeoutMessage: 'Still removing player...' },
        );
      },
      onSetReady: async ready => {
        this.audio.events.onUiClick('confirm');
        await this.runWithLoading(
          'online:set-ready',
          ready ? 'Marking ready...' : 'Marking unready...',
          () => this.roomClient.setReady(ready),
          { timeoutMs: 4000, timeoutMessage: 'Still updating ready state...' },
        );
      },
      onSetName: async name => {
        this.audio.events.onUiClick('confirm');
        await this.runWithLoading(
          'online:set-name',
          'Updating name...',
          () => this.roomClient.setName(name),
          { timeoutMs: 4000, timeoutMessage: 'Still updating name...' },
        );
      },
      onCreateDeposit: () => this.roomClient.createDepositInvoice(),
      onRefreshDeposits: () => this.roomClient.getDepositStatus(),
    });
  }

  private async onStartGame(
    playerNames: string[],
    isAI: boolean[],
    chainClasses: ChainClass[],
    activeSlots: boolean[],
    wager: number,
    laps: number,
    skipPayment: boolean,
    routeId: string,
    mode: GameMode,
  ) {
    this.playerNames = playerNames;
    this.isAI = isAI;
    this.chainClasses = chainClasses;
    this.localActiveSlots = activeSlots;
    this.wagerAmount = wager;
    this.totalLaps = laps;
    this.selectedRouteId = routeId || 'default';
    this.gameMode = mode ?? 'classic';

    if (!skipPayment) {
      this.state = 'payment';
      this.container.innerHTML = '';
      try {
        const data = await this.runWithLoading(
          'payment:create-session',
          'Creating payment session...',
          () => this.sessionApi.createSession(wager, playerNames),
          {
            subMessage: 'Requesting invoice from server...',
            timeoutMs: 4000,
            timeoutMessage: 'Still working... server is taking longer than usual.',
          },
        );
        this.sessionId = data.sessionId;
        const paid = await this.paymentUI.show(data);
        if (!paid) {
          this.showLobby();
          return;
        }
      } catch {
        void this.startRace();
        return;
      }
    }

    void this.startRace();
  }

  private async startRace() {
    await this.runWithLoading(
      'local:start-race',
      'Loading route...',
      async () => {
        const routeLayout = await this.resolveRouteLayout(this.selectedRouteId);
        this.updateGlobalLoading('Building arena...', 'Preparing scene and track geometry...');
        this.state = 'racing';
        this.audio.setAppState('racing');
        this.container.innerHTML = '';
        this.game = new Game(
          this.container,
          this.playerNames,
          this.isAI,
          this.chainClasses,
          this.totalLaps,
          undefined,
          routeLayout,
          SPONSOR_LOGO_URLS,
          this.gameMode,
          this.localActiveSlots,
          this.audio,
          this.onRaceFinished.bind(this),
        );
        this.updateGlobalLoading('Preparing racers...', 'Finalizing physics and HUD...');
        this.game.start();
        this.updateGlobalLoading('Starting countdown...', 'Race starts in a moment.');
      },
      {
        subMessage: 'Fetching route layout...',
        timeoutMs: 4500,
        timeoutMessage: 'Still working... route loading is taking longer than usual.',
      },
    );
  }

  private startOnlineRace(room: RoomState) {
    if (!this.onlineMemberId) return;
    const membersBySlot = [...room.members].sort((a, b) => a.slotIndex - b.slotIndex);
    const names = Array.from({ length: GAME_CONFIG.MAX_PLAYERS }, (_, i) => `Player ${i + 1}`);
    const isAI = new Array(GAME_CONFIG.MAX_PLAYERS).fill(true);
    const activeSlots = new Array(GAME_CONFIG.MAX_PLAYERS).fill(false);
    for (const m of membersBySlot) {
      if (m.slotIndex < 0 || m.slotIndex >= GAME_CONFIG.MAX_PLAYERS) continue;
      names[m.slotIndex] = m.name;
      isAI[m.slotIndex] = false;
      activeSlots[m.slotIndex] = true;
    }
    let aiToFill = room.settings.aiCount;
    for (let i = 0; i < GAME_CONFIG.MAX_PLAYERS; i++) {
      if (!isAI[i]) continue;
      if (aiToFill > 0) {
        names[i] = `AI ${i + 1}`;
        isAI[i] = true;
        activeSlots[i] = true;
        aiToFill--;
      }
    }
    this.playerNames = [...names];
    this.isAI = [...isAI];
    this.chainClasses = Array.from(
      { length: GAME_CONFIG.MAX_PLAYERS },
      (_, i) => room.settings.chainClasses?.[i] ?? 'balanced',
    );
    this.localActiveSlots = activeSlots;
    this.totalLaps = room.settings.laps;
    this.selectedRouteId = room.settings.routeId || 'default';
    const localSlot = room.members.find(m => m.memberId === this.onlineMemberId)?.slotIndex ?? -1;
    this.gameMode = room.settings.mode ?? 'classic';
    this.state = 'racing';
    this.audio.setAppState('racing');
    this.onlineFinishHandled = false;
    this.container.innerHTML = '';
    this.game = new Game(
      this.container,
      names,
      isAI,
      this.chainClasses,
      room.settings.laps,
      {
        enabled: true,
        roomId: room.roomId,
        memberId: this.onlineMemberId,
        localSlot,
        sendInput: input => this.roomClient.sendInput(input),
        getOnlineStartAt: () => this.onlineRoom?.race?.startedAt ?? null,
        routeLayout: room.race?.routeLayout ?? null,
      },
      null,
      SPONSOR_LOGO_URLS,
      this.gameMode,
      activeSlots,
      this.audio,
      this.onRaceFinished.bind(this),
    );
    if (this.latestRoomSnapshot) {
      this.game.setOnlineSnapshot(this.latestRoomSnapshot);
    }
    this.game.setOnlineStandings(room.race?.standings?.placementOrder ?? null);
    this.game.setOnlineRoster(room.members);
    this.game.setOnlineStartAt(room.race?.startedAt ?? null);
    this.game.start();
  }

  private async onRaceFinished(top3Ids: number[]) {
    this.onlineFinishHandled = false;
    if (this.onlineFinishTransitionTimeoutId !== null) {
      clearTimeout(this.onlineFinishTransitionTimeoutId);
      this.onlineFinishTransitionTimeoutId = null;
    }
    this.state = 'result';
    this.audio.setAppState('result');
    this.lastRaceItemStats = this.game ? this.game.getItemStats() : [];
    if (this.game) {
      this.game.dispose();
      this.game = null;
    }
    const isOnlineFlow = !!this.onlineRoom && !!this.onlineMemberId;
    this.latestRoomSnapshot = null;

    const winnerId = top3Ids[0] ?? 0;
    const winnerName = this.playerNames[winnerId];
    const top3Names = top3Ids
      .slice(0, 3)
      .map(id => this.playerNames[id] ?? `Player ${id + 1}`);

    if (this.sessionId) {
      try {
        const data = await this.sessionApi.submitResult(this.sessionId, `player${winnerId + 1}`);
        this.resultUI.show(
          winnerName,
          top3Names,
          data.amount,
          data.lnurl,
        () => {
          this.audio.events.onUiClick('confirm');
          if (isOnlineFlow) {
            void this.returnOnlineToLobby();
          } else {
            this.showModeMenu();
          }
        },
          this.gameMode,
          this.lastRaceItemStats,
          this.playerNames,
        );
        return;
      } catch { /* fall through to simple result */ }
    }

    if (isOnlineFlow && this.onlineRoom && this.onlineMemberId) {
      let payoutAmount = 0;
      let payoutLnurl: string | null = null;
      try {
        const claim = await this.roomClient.createClaimTicket();
        payoutAmount = claim.amountSat;
        const payout = await this.roomClient.redeemClaimTicket(claim.claimToken);
        payoutAmount = payout.amount;
        payoutLnurl = payout.lnurl;
      } catch {
        // No winnings for this member or settlement not enabled.
      }
      this.resultUI.show(
        winnerName,
        top3Names,
        payoutAmount,
        payoutLnurl,
        () => {
          this.audio.events.onUiClick('confirm');
          if (isOnlineFlow) {
            void this.returnOnlineToLobby();
          } else {
            this.showModeMenu();
          }
        },
        this.gameMode,
        this.lastRaceItemStats,
        this.playerNames,
      );
      return;
    }

    this.resultUI.show(
      winnerName,
      top3Names,
      this.wagerAmount * 2 * (1 - GAME_CONFIG.REVENUE_SPLIT_PERCENT / 100),
      null,
      () => {
        this.audio.events.onUiClick('confirm');
        if (isOnlineFlow) {
          void this.returnOnlineToLobby();
        } else {
          this.showModeMenu();
        }
      },
      this.gameMode,
      this.lastRaceItemStats,
      this.playerNames,
    );
  }

  private async returnOnlineToLobby() {
    if (!this.onlineRoom || !this.onlineMemberId) {
      this.showModeMenu();
      return;
    }
    try {
      const res = await this.runWithLoading(
        'online:rematch',
        'Syncing rematch...',
        () => this.roomClient.rematch(),
        { timeoutMs: 4000, timeoutMessage: 'Still syncing rematch...' },
      );
      this.onlineRoom = res.room;
      this.showOnlineRoom(res.room);
    } catch (err: any) {
      this.showOnlineRoom(this.onlineRoom);
      this.onlineLobbyUI.setStatus(err?.message ?? 'Waiting for host to reopen lobby');
    }
  }

  private async refreshRoutes() {
    this.bootLoading = true;
    this.bootLoadFailed = false;
    if (this.state === 'mode') this.showModeMenu();
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 4500);
      const res = await fetch('/api/routes', { signal: controller.signal }).finally(() => clearTimeout(timer));
      if (!res.ok) return;
      const data = await res.json() as { routes?: Array<{ id: string; name: string }> };
      const routes = Array.isArray(data.routes) && data.routes.length > 0
        ? data.routes.map(t => ({ id: t.id, name: t.name }))
        : [{ id: 'default', name: 'Genesis Route' }];
      this.routes = routes;
      if (!this.routes.some(t => t.id === this.selectedRouteId)) this.selectedRouteId = this.routes[0].id;
      this.lobbyUI.setRoutes(this.routes);
      this.onlineLobbyUI.setRoutes(this.routes);
    } catch {
      this.bootLoadFailed = true;
      // Keep defaults offline.
    } finally {
      this.bootLoading = false;
      if (this.state === 'mode') this.showModeMenu();
    }
  }

  private async resolveRouteLayout(routeId: string): Promise<RouteCustomLayout | null> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 4500);
      const res = await fetch(
        `/api/routes/${encodeURIComponent(routeId || 'default')}`,
        { signal: controller.signal },
      ).finally(() => clearTimeout(timer));
      if (!res.ok) return null;
      const data = await res.json() as { route?: RouteDefinition };
      return data.route?.layout ?? null;
    } catch {
      return null;
    }
  }

  private showAdminMenu() {
    this.state = 'admin';
    this.container.innerHTML = '';
    const compactLayout = window.innerHeight < 900;
    const narrowLayout = window.innerWidth < 700;
    const wrap = document.createElement('div');
    wrap.style.cssText = `
      width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:${compactLayout ? 'flex-start' : 'center'};
      background:radial-gradient(circle at center,#080808 0%,#000 70%);
      color:#f0f0f0;font-family:${UI_FONT_FAMILY}; overflow:auto;
      padding:${compactLayout ? '10px 10px 14px' : '18px 14px 22px'}; box-sizing:border-box;
    `;
    const card = document.createElement('div');
    card.style.cssText = `
      width:min(680px,94vw);background:#090909;border:1px solid #2b2b2b;border-radius:10px;
      padding:${compactLayout ? '14px' : '22px'};box-shadow:0 0 24px rgba(255,255,255,0.08);
    `;
    wrap.appendChild(card);
    const title = document.createElement('div');
    title.textContent = 'ADMIN ROUTE CATALOG';
    title.style.cssText = `font-size:clamp(18px,4vw,24px);letter-spacing:2px;color:#fff;margin-bottom:${compactLayout ? '8px' : '12px'};`;
    card.appendChild(title);

    const secretInput = document.createElement('input');
    secretInput.type = 'password';
    secretInput.placeholder = 'ROUTE ADMIN SECRET';
    const adminSecretStorageKey = 'chainduel3d.adminRouteSecret.v1';
    secretInput.value = localStorage.getItem(adminSecretStorageKey) ?? '';
    secretInput.addEventListener('input', () => {
      localStorage.setItem(adminSecretStorageKey, secretInput.value);
    });
    secretInput.style.cssText = 'width:100%;padding:10px;border-radius:6px;border:1px solid #333;background:#101010;color:#e8e8e8;';
    card.appendChild(secretInput);

    const status = document.createElement('div');
    status.style.cssText = 'min-height:18px;color:#9b9b9b;font-size:12px;margin:8px 0 12px;';
    card.appendChild(status);
    const setAdminStatus = (text: string) => {
      status.textContent = text;
    };
    const runAdminLoading = async <T,>(
      actionId: string,
      title: string,
      task: () => Promise<T>,
      timeoutMessage = 'Still working... server is taking longer than usual.',
    ) => {
      setAdminStatus(title);
      return this.runWithLoading(
        actionId,
        title,
        task,
        {
          timeoutMs: 4000,
          timeoutMessage,
          onTimeout: () => setAdminStatus(timeoutMessage),
        },
      );
    };
    const sponsorDetails = document.createElement('details');
    sponsorDetails.style.cssText = 'margin-bottom:12px;border:1px solid #2f2f2f;border-radius:6px;background:#0d0d0d;';
    const sponsorSummary = document.createElement('summary');
    sponsorSummary.innerHTML = '<span id="sponsor-chevron" style="display:inline-block;width:14px;color:#9f9f9f;">▸</span>SPONSOR PREVIEW / DEBUG';
    sponsorSummary.style.cssText = `
      cursor:pointer; list-style:none; padding:10px; font-size:12px; color:#d9d9d9;
      letter-spacing:0.4px; border-bottom:1px solid #1f1f1f;
    `;
    sponsorDetails.addEventListener('toggle', () => {
      const chev = sponsorSummary.querySelector('#sponsor-chevron');
      if (chev) chev.textContent = sponsorDetails.open ? '▾' : '▸';
    });
    sponsorDetails.appendChild(sponsorSummary);
    const sponsorPanel = document.createElement('div');
    sponsorPanel.style.cssText = `
      padding:10px;
      font-size:11px;line-height:1.35;color:#d9d9d9;
    `;
    sponsorDetails.appendChild(sponsorPanel);
    card.appendChild(sponsorDetails);
    this.renderSponsorPreviewPanel(sponsorPanel);
    const getAdminSecret = () => secretInput.value.trim();
    let adminBearerToken: string | null = null;
    let adminBearerTokenExpiresAt = 0;

    const getAdminAuthHeaders = async (includeJsonContentType = true): Promise<Record<string, string>> => {
      const secret = getAdminSecret();
      if (!secret) throw new Error('Enter admin secret first.');
      if (!adminBearerToken || Date.now() + 5_000 >= adminBearerTokenExpiresAt) {
        const loginRes = await fetch('/api/admin/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ secret }),
        });
        if (!loginRes.ok) {
          throw new Error('Admin login failed');
        }
        const loginData = await loginRes.json() as { token?: string; expiresAt?: number };
        if (!loginData.token || !loginData.expiresAt) {
          throw new Error('Admin login returned invalid token payload');
        }
        adminBearerToken = loginData.token;
        adminBearerTokenExpiresAt = loginData.expiresAt;
      }
      const headers: Record<string, string> = {
        Authorization: `Bearer ${adminBearerToken}`,
      };
      if (includeJsonContentType) {
        headers['Content-Type'] = 'application/json';
      }
      return headers;
    };

    const routeSelect = document.createElement('select');
    routeSelect.style.cssText = 'width:100%;padding:10px;border-radius:6px;border:1px solid #333;background:#101010;color:#e8e8e8;';
    for (const t of this.routes) {
      const opt = document.createElement('option');
      opt.value = t.id;
      opt.textContent = `${t.name} (${t.id})`;
      routeSelect.appendChild(opt);
    }
    card.appendChild(routeSelect);

    const nameInput = document.createElement('input');
    nameInput.placeholder = 'Route name (for save/update)';
    nameInput.style.cssText = 'width:100%;padding:10px;border-radius:6px;border:1px solid #333;background:#101010;color:#e8e8e8;margin-top:8px;';
    card.appendChild(nameInput);

    const row = document.createElement('div');
    row.style.cssText = 'display:grid;grid-template-columns:1fr;gap:8px;margin-top:10px;';
    const openBuilderBtn = document.createElement('button');
    openBuilderBtn.textContent = 'OPEN GRAPHICAL BUILDER';
    openBuilderBtn.style.cssText = this.modeBtnCss(true);
    openBuilderBtn.onclick = () => this.lobbyUI.showGraphicalRouteBuilder();
    row.appendChild(openBuilderBtn);
    card.appendChild(row);

    const loadSelectedBtn = document.createElement('button');
    loadSelectedBtn.textContent = 'LOAD SELECTED ROUTE INTO BUILDER';
    loadSelectedBtn.style.cssText = this.modeBtnCss(false);
    loadSelectedBtn.onclick = async () => {
      const selectedId = routeSelect.value || 'default';
      try {
        const res = await runAdminLoading(
          `admin:load-route:${selectedId}`,
          'Loading selected route...',
          () => fetch(`/api/routes/${encodeURIComponent(selectedId)}`),
          'Still loading selected route...',
        );
        if (!res.ok) {
          status.textContent = `Load failed: ${res.status}`;
          return;
        }
        const data = await res.json() as { route?: RouteDefinition };
        if (!data.route?.layout) {
          status.textContent = 'Selected route has no layout.';
          return;
        }
        Route.setCustomLayout(data.route.layout);
        status.textContent = `Loaded "${data.route.name}" into builder draft.`;
      } catch {
        status.textContent = 'Failed to load selected route.';
      }
    };
    card.appendChild(loadSelectedBtn);

    const saveBtn = document.createElement('button');
    saveBtn.textContent = 'UPDATE SELECTED ROUTE FROM BUILDER';
    saveBtn.style.cssText = this.modeBtnCss(true);
    saveBtn.onclick = async () => {
      const layout = Route.getCustomLayout();
      if (!layout) {
        status.textContent = 'No local builder layout found. Build one first.';
        return;
      }
      const selectedId = routeSelect.value || '';
      if (!selectedId || selectedId === 'default') {
        status.textContent = 'Select a non-default route to update, or use Publish as New.';
        return;
      }
      const payload = {
        id: selectedId,
        name: nameInput.value.trim() || this.routes.find(t => t.id === selectedId)?.name || 'Custom Route',
        layout,
      };
      if (!getAdminSecret()) {
        status.textContent = 'Enter admin secret first.';
        return;
      }
      const method = 'PUT';
      const url = `/api/admin/routes/${encodeURIComponent(selectedId)}`;
      let headers: Record<string, string>;
      try {
        headers = await runAdminLoading(
          'admin:login:update',
          'Authenticating admin...',
          () => getAdminAuthHeaders(true),
          'Still authenticating admin...',
        );
      } catch (err: any) {
        status.textContent = err?.message ?? 'Admin login failed.';
        return;
      }
      const res = await runAdminLoading(
        `admin:update-route:${selectedId}`,
        'Saving route...',
        () => fetch(url, {
          method,
          headers,
          body: JSON.stringify(payload),
        }),
        'Still saving route...',
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Unknown error' }));
        status.textContent = `Save failed: ${res.status} ${err.error ?? ''}`.trim();
        return;
      }
      status.textContent = 'Route saved.';
      await this.refreshRoutes();
      this.showAdminMenu();
    };
    card.appendChild(saveBtn);

    const publishNewBtn = document.createElement('button');
    publishNewBtn.textContent = 'PUBLISH BUILDER AS NEW ROUTE';
    publishNewBtn.style.cssText = this.modeBtnCss(true);
    publishNewBtn.onclick = async () => {
      const layout = Route.getCustomLayout();
      if (!layout) {
        status.textContent = 'No local builder layout found. Build one first.';
        return;
      }
      const customName = nameInput.value.trim();
      const generatedName = `Custom Route ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`;
      const payload = {
        name: customName || generatedName,
        layout,
      };
      if (!getAdminSecret()) {
        status.textContent = 'Enter admin secret first.';
        return;
      }
      let headers: Record<string, string>;
      try {
        headers = await runAdminLoading(
          'admin:login:publish',
          'Authenticating admin...',
          () => getAdminAuthHeaders(true),
          'Still authenticating admin...',
        );
      } catch (err: any) {
        status.textContent = err?.message ?? 'Admin login failed.';
        return;
      }
      const res = await runAdminLoading(
        'admin:publish-route',
        'Publishing route...',
        () => fetch('/api/admin/routes', {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
        }),
        'Still publishing route...',
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Unknown error' }));
        status.textContent = `Publish failed: ${res.status} ${err.error ?? ''}`.trim();
        return;
      }
      status.textContent = 'New route published.';
      await this.refreshRoutes();
      this.showAdminMenu();
    };
    card.appendChild(publishNewBtn);

    const deleteBtn = document.createElement('button');
    deleteBtn.textContent = 'DELETE SELECTED ROUTE';
    deleteBtn.style.cssText = this.modeBtnCss(false);
    deleteBtn.onclick = async () => {
      const selectedId = routeSelect.value;
      if (!selectedId || selectedId === 'default') {
        status.textContent = 'Default route cannot be deleted.';
        return;
      }
      if (!getAdminSecret()) {
        status.textContent = 'Enter admin secret first.';
        return;
      }
      let headers: Record<string, string>;
      try {
        headers = await runAdminLoading(
          'admin:login:delete',
          'Authenticating admin...',
          () => getAdminAuthHeaders(false),
          'Still authenticating admin...',
        );
      } catch (err: any) {
        status.textContent = err?.message ?? 'Admin login failed.';
        return;
      }
      const res = await runAdminLoading(
        `admin:delete-route:${selectedId}`,
        'Deleting route...',
        () => fetch(`/api/admin/routes/${encodeURIComponent(selectedId)}`, {
          method: 'DELETE',
          headers,
        }),
        'Still deleting route...',
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Unknown error' }));
        status.textContent = `Delete failed: ${res.status} ${err.error ?? ''}`.trim();
        return;
      }
      status.textContent = 'Route deleted.';
      await this.refreshRoutes();
      this.showAdminMenu();
    };
    card.appendChild(deleteBtn);

    const backBtn = document.createElement('button');
    backBtn.textContent = 'BACK';
    backBtn.style.cssText = this.backBtnCss();
    backBtn.onclick = () => this.showModeMenu();
    card.appendChild(backBtn);

    this.decorateInteractiveElements(card);
    this.container.appendChild(wrap);
  }

  private decorateInteractiveElements(root: HTMLElement) {
    const fields = root.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input, select');
    for (const field of fields) {
      field.style.transition = 'border-color 0.15s ease, box-shadow 0.15s ease, background-color 0.15s ease';
      field.style.fontFamily = UI_FONT_FAMILY;
      const idleBorder = field.style.borderColor || '#333';
      const hoverBorder = '#5a5a5a';
      const focusBorder = '#e9e9e9';
      field.addEventListener('mouseenter', () => {
        if (document.activeElement !== field && !field.disabled) field.style.borderColor = hoverBorder;
      });
      field.addEventListener('mouseleave', () => {
        if (document.activeElement !== field) field.style.borderColor = idleBorder;
      });
      field.addEventListener('focus', () => {
        if (field.disabled) return;
        field.style.borderColor = focusBorder;
        field.style.boxShadow = '0 0 0 2px rgba(255,255,255,0.15)';
      });
      field.addEventListener('blur', () => {
        field.style.borderColor = idleBorder;
        field.style.boxShadow = 'none';
      });
    }

    const buttons = root.querySelectorAll<HTMLButtonElement>('button');
    for (const button of buttons) {
      button.style.transition = 'transform 0.12s ease, box-shadow 0.2s ease, border-color 0.2s ease, opacity 0.2s ease';
      button.style.fontFamily = UI_FONT_FAMILY;
      button.addEventListener('mouseenter', () => {
        if (button.disabled) return;
        button.style.transform = 'translateY(-1px)';
        button.style.boxShadow = '0 6px 18px rgba(255,255,255,0.12)';
      });
      button.addEventListener('mouseleave', () => {
        button.style.transform = 'translateY(0)';
        button.style.boxShadow = 'none';
      });
      button.addEventListener('focus', () => {
        if (button.disabled) return;
        button.style.boxShadow = '0 0 0 2px rgba(255,255,255,0.18)';
      });
      button.addEventListener('blur', () => {
        button.style.boxShadow = 'none';
      });
    }
  }

  private backBtnCss(): string {
    return `
      width:100%;
      margin-top:8px;
      padding:10px 12px;
      border-radius:4px;
      cursor:pointer;
      border:1px solid #2f2f2f;
      background:#090909;
      color:#9e9e9e;
      font-family:${UI_FONT_FAMILY};
      font-size:12px;
      letter-spacing:0.8px;
    `;
  }

  private async ensureSponsorPreviewRows(): Promise<SponsorPreviewRow[]> {
    if (this.sponsorPreviewRows) return this.sponsorPreviewRows;
    if (!this.sponsorPreviewLoading) {
      this.sponsorPreviewLoading = true;
      try {
        this.sponsorPreviewRows = await loadSponsorPreviewRows();
      } finally {
        this.sponsorPreviewLoading = false;
      }
    }
    return this.sponsorPreviewRows ?? [];
  }

  private renderSponsorPreviewPanel(panel: HTMLElement) {
    panel.innerHTML = `
      <div style="font-size:12px;color:#fff;margin-bottom:4px;">SPONSOR PREVIEW / DEBUG</div>
      <div style="color:#9f9f9f;margin-bottom:6px;">${formatSponsorThresholds()}</div>
      <div style="color:#8f8f8f;">Loading sponsor assets...</div>
    `;
    void this.populateSponsorPreviewPanel(panel);
  }

  private async populateSponsorPreviewPanel(panel: HTMLElement) {
    const rows = await this.ensureSponsorPreviewRows();
    if (!panel.isConnected) return;
    const counts = {
      flag: rows.filter(r => r.kind === 'flag').length,
      billboard: rows.filter(r => r.kind === 'billboard').length,
      banner: rows.filter(r => r.kind === 'banner').length,
      invalid: rows.filter(r => r.kind === 'invalid').length,
    };
    const header = `
      <div style="font-size:12px;color:#fff;margin-bottom:4px;">SPONSOR PREVIEW / DEBUG</div>
      <div style="color:#9f9f9f;margin-bottom:6px;">${formatSponsorThresholds()}</div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;color:#cfcfcf;margin-bottom:6px;">
        <span>total ${rows.length}</span>
        <span>flags ${counts.flag}</span>
        <span>billboards ${counts.billboard}</span>
        <span>banners ${counts.banner}</span>
        ${counts.invalid > 0 ? `<span style="color:#ff8c8c;">invalid ${counts.invalid}</span>` : ''}
      </div>
    `;
    if (rows.length === 0) {
      panel.innerHTML = `${header}<div style="color:#8f8f8f;">No files found in <code>client/src/assets/sponsors</code>.</div>`;
      return;
    }
    const rowHtml = rows
      .map(row => {
        const size = row.width && row.height ? `${row.width}x${row.height}` : '-';
        const ratio = row.ratio ? row.ratio.toFixed(2) : '-';
        const kindColor = row.kind === 'flag'
          ? '#92e7ff'
          : row.kind === 'billboard'
            ? '#b5ff9a'
            : row.kind === 'banner'
              ? '#ffd289'
              : '#ff8c8c';
        const issue = row.issue ? ` (${row.issue})` : '';
        return `
          <div style="display:grid;grid-template-columns:1fr auto auto auto;gap:8px;padding:4px 0;border-top:1px solid #1f1f1f;">
            <span title="${row.sourcePath}" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${row.filename}</span>
            <span style="color:#9d9d9d;">${size}</span>
            <span style="color:#9d9d9d;">r:${ratio}</span>
            <span style="color:${kindColor};">${row.kind}${issue}</span>
          </div>
        `;
      })
      .join('');
    panel.innerHTML = `${header}<div style="max-height:168px;overflow:auto;padding-right:4px;">${rowHtml}</div>`;
  }

  private onRoomState(room: RoomState) {
    if (this.onlineMemberId && !room.members.some(m => m.memberId === this.onlineMemberId)) {
      if (this.game) {
        this.game.dispose();
        this.game = null;
      }
      this.roomClient.disconnect();
      this.onlineRoom = null;
      this.onlineMemberId = null;
      this.latestRoomSnapshot = null;
      this.clearInviteQueryParam();
      this.showOnlineEntry();
      this.onlineLobbyUI.setStatus('You were removed from the lobby.');
      return;
    }
    this.onlineRoom = room;
    if (this.game && this.state === 'racing') {
      this.game.setOnlineStandings(room.race?.standings?.placementOrder ?? null);
      this.game.setOnlineRoster(room.members);
      this.game.setOnlineStartAt(room.race?.startedAt ?? null);
      if (room.phase === 'finished' && !this.onlineFinishHandled) {
        this.onlineFinishHandled = true;
        const top3 = (room.race?.standings?.placementOrder ?? []).slice(0, 3);
        const top3Resolved = top3.length > 0 ? top3 : [0, 1, 2];
        this.game.applyAuthoritativeRaceFinished(top3Resolved);
        this.onlineFinishTransitionTimeoutId = window.setTimeout(() => {
          this.onlineFinishTransitionTimeoutId = null;
          void this.onRaceFinished(top3Resolved);
        }, 2000);
      }
    }
    if (this.state === 'online_room' && this.onlineMemberId) {
      this.showOnlineRoom(room);
      if (room.phase === 'countdown' || room.phase === 'racing') {
        this.startOnlineRace(room);
      }
    }
    if (this.state === 'online_entry' && this.onlineMemberId) {
      this.showOnlineRoom(room);
    }
    if (this.state === 'result' && this.onlineMemberId) {
      if (room.phase === 'lobby') {
        this.showOnlineRoom(room);
      } else if (room.phase === 'countdown' || room.phase === 'racing') {
        this.startOnlineRace(room);
      }
    }
  }

  private onRoomChat(msg: ChatMessage) {
    if (this.state === 'online_room') this.onlineLobbyUI.pushChat(msg);
  }

  private onMemberPing(roomId: string, memberId: string, pingMs: number) {
    if (!this.onlineRoom || this.onlineRoom.roomId !== roomId) return;
    const member = this.onlineRoom.members.find(m => m.memberId === memberId);
    if (member) member.pingMs = pingMs;
    if (this.state === 'online_room') {
      this.onlineLobbyUI.updateMemberPing(memberId, pingMs);
    }
  }

  private clearInviteQueryParam() {
    try {
      const url = new URL(window.location.href);
      if (!url.searchParams.has('room')) return;
      url.searchParams.delete('room');
      window.history.replaceState({}, '', url.toString());
    } catch {
      // no-op
    }
  }
}

new ChainDuel3DApp();
