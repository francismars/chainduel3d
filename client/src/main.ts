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

setupPWA();

const SPONSOR_LOGO_IMPORTS = import.meta.glob('./assets/sponsors/*.{png,jpg,jpeg,webp,svg}', {
  eager: true,
  import: 'default',
}) as Record<string, string>;

const SPONSOR_LOGO_URLS = Object.values(SPONSOR_LOGO_IMPORTS);
const UI_FONT_FAMILY = "'Inter', 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif";

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

type AppState = 'mode' | 'lobby' | 'online_entry' | 'online_room' | 'admin' | 'how_to_play' | 'payment' | 'racing' | 'result';
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

  constructor() {
    this.container = document.getElementById('app')!;
    this.lobbyUI = new LobbyUI(this.container, this.showModeMenu.bind(this), this.onStartGame.bind(this));
    this.onlineLobbyUI = new OnlineLobbyUI(this.container);
    this.paymentUI = new PaymentUI(this.container);
    this.resultUI = new ResultUI(this.container);
    this.roomClient = new RoomClient();
    this.sessionApi = new SessionApi();
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

  private showHowToPlay() {
    this.state = 'how_to_play';
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
    this.container.innerHTML = '';
    this.lobbyUI.show();
  }

  private showOnlineEntry(prefillCode = '') {
    this.state = 'online_entry';
    this.onlineLobbyUI.showEntry({
      onBackToMode: () => this.showModeMenu(),
      onCreate: async (name) => {
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
    this.onlineRoom = room;
    if (!this.onlineMemberId) return;
    this.onlineLobbyUI.showRoom(room, this.onlineMemberId, {
      onBack: () => {
        this.roomClient.leave();
        this.roomClient.disconnect();
        this.onlineRoom = null;
        this.onlineMemberId = null;
        this.clearInviteQueryParam();
        this.showModeMenu();
      },
      onPatchSettings: async s => {
        await this.runWithLoading(
          'online:patch-settings',
          'Saving settings...',
          () => this.roomClient.patchSettings(s),
          { timeoutMs: 4000, timeoutMessage: 'Still saving settings...' },
        );
      },
      onStart: async () => {
        await this.runWithLoading(
          'online:start-race',
          'Starting race...',
          () => this.roomClient.startRace(null, room.settings.routeId),
          { timeoutMs: 4000, timeoutMessage: 'Still starting race...' },
        );
      },
      onSendChat: txt => this.roomClient.sendChat(txt),
      onKick: async memberId => {
        await this.runWithLoading(
          `online:kick:${memberId}`,
          'Removing player...',
          () => this.roomClient.kickMember(memberId),
          { timeoutMs: 4000, timeoutMessage: 'Still removing player...' },
        );
      },
      onSetReady: async ready => {
        await this.runWithLoading(
          'online:set-ready',
          ready ? 'Marking ready...' : 'Marking unready...',
          () => this.roomClient.setReady(ready),
          { timeoutMs: 4000, timeoutMessage: 'Still updating ready state...' },
        );
      },
      onSetName: async name => {
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
          () => (isOnlineFlow ? this.returnOnlineToLobby() : this.showModeMenu()),
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
        () => (isOnlineFlow ? this.returnOnlineToLobby() : this.showModeMenu()),
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
      () => (isOnlineFlow ? this.returnOnlineToLobby() : this.showModeMenu()),
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
