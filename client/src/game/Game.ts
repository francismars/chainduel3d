import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { SplitScreen } from './SplitScreen';
import { FollowCamera } from './Camera';
import { ChainClass, Kart } from './Kart';
import { Track } from './Track';
import { InputManager } from './InputManager';
import { ItemSystem } from './ItemSystem';
import { HUD } from './HUD';
import { Countdown } from './Countdown';
import { ItemId, OnlineRaceEvent, OnlineRaceInput, OnlineRaceSnapshot, RoomMember, TrackCustomLayout } from 'shared/types';
import {
  createDefaultRuntimeState,
  createSimRandomState,
  nextSimRandom,
  buildSimMainTrackPoints,
  buildSimTrackPoints,
  buildSimCheckpoints,
  buildSimItemBoxes,
  collectNearbyItem,
  getAdvancedAiInput,
  getChainClassTuning,
  getRaceBalanceAssist,
  rollPreviewItem,
  shouldAiUseItem,
  consumeRaceActionEdges,
  stepItemBoxes,
  stepObstacles,
  shouldEnableFinalLapIntensity,
  computePlacements,
  shouldEndRace,
  useHeldItem,
  stepStealCollisions,
  trySacrificeBoost,
  stepRace,
  type SimCheckpoint,
  type SimItemBoxState,
  type SimObstacleState,
  type SimRaceEvent,
  type SimRaceActionPressState,
  type SimRandomState,
  type SimInput,
  type SimPlayerRuntimeState,
  type SimPlayerState,
  type SimRaceState,
  type SimTrackPoint,
} from 'shared/sim';

const NUM_PLAYERS = 4;
const KART_COLORS = [0xffffff, 0x888888, 0x44aaff, 0xff4444];
const START_CHAIN_BLOCKS = 5;
const STEAL_COOLDOWN_MS = 1100;
const MEMPOOL_API_BASE = 'https://mempool.space/api';
const SACRIFICE_BOOST_COOLDOWN_MS = 2200;
const SACRIFICE_BOOST_DURATION_MS = 1700;
const SHOW_ONLINE_ROOM_INTEL = false;

interface OnlineRuntime {
  enabled: boolean;
  roomId: string;
  memberId: string;
  localSlot: number;
  sendInput: (input: OnlineRaceInput) => void;
  getOnlineStartAt: () => number | null;
  trackLayout: TrackCustomLayout | null;
}

export class Game {
  private container: HTMLElement;
  private splitScreen: SplitScreen;
  private scene: THREE.Scene;
  private world: CANNON.World;
  private track: Track;
  private karts: Kart[];
  private cameras: FollowCamera[];
  private inputManager: InputManager;
  private itemSystem: ItemSystem;
  private hud: HUD;
  private countdown: Countdown;

  private onFinished: (top3Ids: number[]) => void;
  private animFrameId = 0;
  private lastTime = 0;
  private raceActive = false;
  private raceTime = 0;
  private playerNames: string[];
  private isAI: boolean[];
  private humanPlayerIndices: number[];
  private chainClasses: ChainClass[];
  private totalLaps: number;
  private chainLengths: number[];
  private eliminated: boolean[];
  private stealCooldownMs: number[][];
  private sacrificeCooldownMs: number[];
  private finalLapIntensityActive = false;
  private lapStartTimes: number[];
  private bestLapTimes: number[];
  private btcPollTimerMs = 0;
  private btcFetchInFlight = false;
  private congestionLevelTarget = 0;
  private congestionLevelSmoothed = 0;
  private spectatorMode: Array<'follow' | 'free'>;
  private spectateTarget: number[];
  private freeFlyPos: THREE.Vector3[];
  private freeFlyYaw: number[];
  private freeFlyPitch: number[];
  private cameraActionPressState: SimRaceActionPressState[];
  private localRaceActionPressState: SimRaceActionPressState[];
  private finishPovTarget: number[];
  private online: OnlineRuntime | null = null;
  private onlineRoster: Array<{ slotIndex: number; name: string; connected: boolean }> = [];
  private onlineStandings: number[] | null = null;
  private onlineRosterEl: HTMLDivElement | null = null;
  private raceEndTimeoutId: number | null = null;
  private latestOnlineSnapshot: OnlineRaceSnapshot | null = null;
  private prevOnlineSnapshot: OnlineRaceSnapshot | null = null;
  private lastProcessedOnlineEventTick = -1;
  private localAuthoritySnapshot: OnlineRaceSnapshot | null = null;
  private onlinePoseInitialized = false;
  private onlineStartAtMs: number | null = null;
  private raceAnnouncementEl: HTMLDivElement | null = null;
  private disposed = false;
  private localSimTrackMain: SimTrackPoint[] = [];
  private localSimTrackAll: SimTrackPoint[] = [];
  private localSimCheckpoints: SimCheckpoint[] = [];
  private localSimRuntime: SimPlayerRuntimeState[] = Array.from({ length: NUM_PLAYERS }, () => createDefaultRuntimeState());
  private localSimItemBoxes: SimItemBoxState[] = [];
  private localSimObstacles: SimObstacleState[] = [];
  private localSimTick = 0;
  private localSimTimeMs = 0;
  private localSimRngState: SimRandomState = createSimRandomState(1);
  private raceTrackLayout: TrackCustomLayout | null = null;

  constructor(
    container: HTMLElement,
    playerNames: string[],
    isAI: boolean[],
    chainClasses: ChainClass[],
    totalLaps: number,
    online: OnlineRuntime | undefined,
    localTrackLayout: TrackCustomLayout | null | undefined,
    onFinished: (top3Ids: number[]) => void,
  ) {
    this.container = container;
    this.playerNames = playerNames;
    this.isAI = isAI;
    this.online = online ?? null;
    this.onlineStartAtMs = this.online?.getOnlineStartAt() ?? null;
    this.humanPlayerIndices = this.online?.enabled
      ? [this.online.localSlot >= 0 ? Math.max(0, Math.min(NUM_PLAYERS - 1, this.online.localSlot)) : 0]
      : this.getHumanPlayerIndices(isAI);
    this.chainClasses = chainClasses;
    this.totalLaps = Math.max(1, Math.min(9, Math.round(totalLaps || 3)));
    this.chainLengths = new Array(NUM_PLAYERS).fill(START_CHAIN_BLOCKS);
    this.eliminated = new Array(NUM_PLAYERS).fill(false);
    this.stealCooldownMs = Array.from({ length: NUM_PLAYERS }, () => new Array(NUM_PLAYERS).fill(0));
    this.sacrificeCooldownMs = new Array(NUM_PLAYERS).fill(0);
    this.lapStartTimes = new Array(NUM_PLAYERS).fill(0);
    this.bestLapTimes = new Array(NUM_PLAYERS).fill(Infinity);
    this.spectatorMode = new Array(NUM_PLAYERS).fill('follow');
    this.spectateTarget = Array.from({ length: NUM_PLAYERS }, (_, i) => i);
    this.freeFlyPos = Array.from({ length: NUM_PLAYERS }, () => new THREE.Vector3());
    this.freeFlyYaw = new Array(NUM_PLAYERS).fill(0);
    this.freeFlyPitch = new Array(NUM_PLAYERS).fill(-0.1);
    this.cameraActionPressState = Array.from({ length: NUM_PLAYERS }, () => ({
      prevUseItemPressed: false,
      prevSacrificePressed: false,
    }));
    this.localRaceActionPressState = Array.from({ length: NUM_PLAYERS }, () => ({
      prevUseItemPressed: false,
      prevSacrificePressed: false,
    }));
    this.finishPovTarget = Array.from({ length: NUM_PLAYERS }, (_, i) => i);
    this.onFinished = onFinished;

    this.world = new CANNON.World({ gravity: new CANNON.Vec3(0, -20, 0) });
    this.world.broadphase = new CANNON.SAPBroadphase(this.world);
    this.world.defaultContactMaterial.friction = 0;
    this.world.defaultContactMaterial.restitution = 0.3;
    const solver = this.world.solver as unknown as { iterations: number; tolerance: number };
    solver.iterations = 30;
    solver.tolerance = 0.0005;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x000000);
    this.scene.fog = new THREE.FogExp2(0x000000, 0.0015);
    this.setupLighting();
    this.setupSkybox();

    this.splitScreen = new SplitScreen(container);
    this.splitScreen.setActivePlayers(this.humanPlayerIndices);

    const resolvedTrackLayout = this.online?.enabled ? (this.online.trackLayout ?? null) : (localTrackLayout ?? null);
    this.raceTrackLayout = resolvedTrackLayout;
    this.track = new Track(this.scene, this.world, resolvedTrackLayout, { useStoredCustomLayout: false });
    this.initLocalSimTrackData();
    this.localSimItemBoxes = buildSimItemBoxes(
      this.localSimTrackMain,
      10,
      () => rollPreviewItem(() => nextSimRandom(this.localSimRngState)),
    );

    this.karts = [];
    for (let i = 0; i < NUM_PLAYERS; i++) {
      const kart = new Kart(this.world, {
        color: KART_COLORS[i],
        startPosition: this.track.startPositions[i],
        startRotation: this.track.startRotation,
        chainClass: this.chainClasses[i] ?? 'balanced',
      });
      this.karts.push(kart);
      this.scene.add(kart.mesh);
    }

    const localAuthorityEnabled = !this.online?.enabled;
    for (const kart of this.karts) kart.setAuthoritativeControlEnabled(localAuthorityEnabled);

    this.cameras = [];
    for (let i = 0; i < NUM_PLAYERS; i++) {
      const cam = new FollowCamera(this.splitScreen.cameras[i]);
      cam.reset(this.karts[i].getPosition(), this.karts[i].getQuaternion());
      this.cameras.push(cam);
      this.freeFlyPos[i].copy(this.splitScreen.cameras[i].position);
    }

    this.inputManager = new InputManager();
    this.itemSystem = new ItemSystem(this.scene, this.track.itemBoxPositions);
    this.itemSystem.setLocalAuthorityEnabled(!this.online?.enabled);
    const minimapPath = this.track.trackPoints
      .filter((_, idx) => idx % 4 === 0)
      .map(tp => new THREE.Vector2(tp.position.x, tp.position.z));
    this.hud = new HUD(container, playerNames, this.humanPlayerIndices, minimapPath, this.totalLaps);
    this.countdown = new Countdown(this.hud);
    if (this.online?.enabled && SHOW_ONLINE_ROOM_INTEL) {
      this.onlineRosterEl = document.createElement('div');
      this.onlineRosterEl.style.cssText = `
        position:absolute; right:12px; bottom:12px; z-index:40; pointer-events:none;
        min-width:230px; max-width:300px;
        background:rgba(5,5,5,0.8); border:1px solid #2c2c2c; border-radius:6px;
        padding:8px; color:#d8d8d8; font-size:11px; line-height:1.4;
        font-family:'Courier New', monospace;
      `;
      this.container.appendChild(this.onlineRosterEl);
    }
  }

  setOnlineSnapshot(snapshot: OnlineRaceSnapshot) {
    if (this.latestOnlineSnapshot && snapshot.tick < this.latestOnlineSnapshot.tick) return;
    this.prevOnlineSnapshot = this.latestOnlineSnapshot;
    this.latestOnlineSnapshot = snapshot;
    if (snapshot.standings?.placementOrder) {
      this.setOnlineStandings(snapshot.standings.placementOrder);
    }
  }

  setOnlineStandings(standings: number[] | null) {
    if (!standings || standings.length === 0) {
      this.onlineStandings = null;
      return;
    }
    const rankByPlayer = new Array(NUM_PLAYERS).fill(NUM_PLAYERS - 1);
    for (let place = 0; place < standings.length && place < NUM_PLAYERS; place++) {
      const playerIndex = standings[place] | 0;
      if (playerIndex >= 0 && playerIndex < NUM_PLAYERS) {
        rankByPlayer[playerIndex] = place;
      }
    }
    this.onlineStandings = rankByPlayer;
  }

  setOnlineStartAt(startAtMs: number | null) {
    this.onlineStartAtMs = startAtMs;
  }

  setOnlineRoster(members: RoomMember[]) {
    this.onlineRoster = members.map(m => ({
      slotIndex: m.slotIndex,
      name: m.name,
      connected: m.connected,
    }));
  }

  private setupLighting() {
    this.scene.add(new THREE.AmbientLight(0x404040, 0.3));

    const dir = new THREE.DirectionalLight(0xffffff, 0.8);
    dir.position.set(30, 50, 30);
    dir.castShadow = true;
    dir.shadow.mapSize.set(2048, 2048);
    dir.shadow.camera.left = -200;
    dir.shadow.camera.right = 200;
    dir.shadow.camera.top = 200;
    dir.shadow.camera.bottom = -200;
    dir.shadow.camera.near = 1;
    dir.shadow.camera.far = 500;
    this.scene.add(dir);

    const fill1 = new THREE.DirectionalLight(0xffffff, 0.3);
    fill1.position.set(-10, -10, -5);
    this.scene.add(fill1);

    const fill2 = new THREE.DirectionalLight(0xffffff, 0.2);
    fill2.position.set(0, 20, 0);
    this.scene.add(fill2);

    const fill3 = new THREE.DirectionalLight(0xffffff, 0.15);
    fill3.position.set(0, -20, 0);
    this.scene.add(fill3);
  }

  private setupSkybox() {
    const c = document.createElement('canvas');
    c.width = 1024; c.height = 1024;
    const ctx = c.getContext('2d')!;
    const g = ctx.createRadialGradient(512, 512, 0, 512, 512, 512);
    g.addColorStop(0, '#080808');
    g.addColorStop(1, '#000000');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 1024, 1024);
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    for (let i = 0; i < 300; i++) {
      ctx.beginPath();
      ctx.arc(Math.random() * 1024, Math.random() * 1024, Math.random() * 1.2 + 0.3, 0, Math.PI * 2);
      ctx.fill();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.mapping = THREE.EquirectangularReflectionMapping;
    this.scene.background = tex;
  }

  private getHumanPlayerIndices(isAI: boolean[]): number[] {
    const humans: number[] = [];
    for (let i = 0; i < NUM_PLAYERS; i++) {
      if (!isAI[i]) humans.push(i);
    }
    return humans.length > 0 ? humans : [0];
  }

  private initLocalSimTrackData() {
    const layout = this.raceTrackLayout as {
      main: Array<{ x: number; z: number; w: number; e: number; ramp?: boolean }>;
      shortcut?: Array<{ x: number; z: number; e: number }>;
    } | null;
    this.localSimTrackMain = buildSimMainTrackPoints(layout);
    this.localSimTrackAll = buildSimTrackPoints(layout, this.localSimTrackMain);
    this.localSimCheckpoints = buildSimCheckpoints(this.localSimTrackMain);
  }

  start() {
    this.lastTime = performance.now();
    this.localSimRngState = createSimRandomState((Date.now() ^ 0x9e3779b9) >>> 0);
    this.localSimTick = 0;
    this.localSimTimeMs = 0;
    this.localSimObstacles = [];
    this.localSimItemBoxes = buildSimItemBoxes(
      this.localSimTrackMain,
      10,
      () => rollPreviewItem(() => nextSimRandom(this.localSimRngState)),
    );
    this.btcPollTimerMs = 250;
    if (!this.online?.enabled) {
      this.countdown.start();
    } else {
      this.raceActive = false;
    }
    this.gameLoop();
  }

  private gameLoop() {
    if (this.disposed) return;

    const now = performance.now();
    const dt = Math.min((now - this.lastTime) / 1000, 0.05);
    this.lastTime = now;

    if (!this.online?.enabled) {
      this.countdown.update(dt);
      if (this.countdown.finished && !this.raceActive) {
        this.raceActive = true;
      }
    } else {
      const startAt = this.onlineStartAtMs ?? Date.now();
      const remaining = Math.ceil((startAt - Date.now()) / 1000);
      if (remaining > 0) {
        this.countdown.show(remaining);
        this.raceActive = false;
      } else {
        this.countdown.hide();
        this.raceActive = true;
      }
    }

    this.world.fixedStep(1 / 60, dt);

    if (this.online?.enabled) {
      this.updateSnapshotFollowerRace(dt, { sendLocalInput: true, renderDelayMs: 100, eventSource: 'online' });
      if (this.raceActive) this.raceTime += dt;
    } else if (this.raceActive) {
      this.raceTime += dt;
      this.updateRace(dt);
      if (this.localAuthoritySnapshot) {
        this.setOnlineSnapshot(this.localAuthoritySnapshot);
        this.updateSnapshotFollowerRace(dt, { sendLocalInput: false, renderDelayMs: 0, eventSource: 'local' });
      }
    }

    if (!this.raceActive) {
      for (const kart of this.karts) {
        this.track.constrainToTrack(kart.body, false);
        kart.stabilizeIdleChain(dt);
      }
    }

    for (const kart of this.karts) {
      kart.syncMeshToPhysics();
      kart.updateEffects(dt);
    }

    for (let i = 0; i < NUM_PLAYERS; i++) {
      const k = this.karts[i];
      const panelControlled = this.humanPlayerIndices.includes(i);
      const controlledSlot = this.online?.enabled
        ? (this.online.localSlot >= 0 ? this.online.localSlot : this.humanPlayerIndices[0] ?? 0)
        : i;
      if (this.isAI[i] && !panelControlled) {
        this.cameras[i].setLookBack(false);
        this.cameras[i].update(
          k.getPosition(), k.getQuaternion(), dt,
          k.speed, k.maxSpeedPublic,
          k.drifting, k.driftDirection,
          k.speedBoostActive,
        );
        continue;
      }
      if (this.online?.enabled && i !== controlledSlot) {
        this.cameras[i].setLookBack(false);
        this.cameras[i].update(
          k.getPosition(), k.getQuaternion(), dt,
          k.speed, k.maxSpeedPublic,
          k.drifting, k.driftDirection,
          k.speedBoostActive,
        );
        continue;
      }

      if (!k.isEliminated() && !k.finished) {
        this.cameraActionPressState[i].prevUseItemPressed = false;
        this.cameraActionPressState[i].prevSacrificePressed = false;
        this.spectatorMode[i] = 'follow';
        this.spectateTarget[i] = i;
        const lookBack = this.inputManager.getInput(this.online?.enabled ? 0 : i).lookBack;
        this.cameras[i].setLookBack(lookBack);
        this.cameras[i].update(
          k.getPosition(), k.getQuaternion(), dt,
          k.speed, k.maxSpeedPublic,
          k.drifting, k.driftDirection,
          k.speedBoostActive,
        );
        continue;
      }

      if (!k.isEliminated() && k.finished) {
        const cameraEdges = consumeRaceActionEdges(
          { useItem: this.inputManager.getInput(i).useItem, sacrificeBoost: false },
          this.cameraActionPressState[i],
        );
        if (cameraEdges.useItemJustPressed) {
          this.finishPovTarget[i] = this.findNextPovTarget(i, this.finishPovTarget[i]);
          this.showGlobalFeedback(`P${i + 1} POV -> P${this.finishPovTarget[i] + 1}`);
        }
        const target = this.findValidPovTarget(i, this.finishPovTarget[i]);
        this.finishPovTarget[i] = target;
        const tk = this.karts[target];
        this.cameras[i].setLookBack(false);
        this.cameras[i].update(
          tk.getPosition(), tk.getQuaternion(), dt,
          tk.speed, tk.maxSpeedPublic,
          tk.drifting, tk.driftDirection,
          tk.speedBoostActive,
        );
        continue;
      }

      this.updateEliminatedSpectatorCamera(i, dt);
    }

    this.track.updateParticles(dt);
    this.updateBitcoinData(dt, now);
    const positions = (this.online?.enabled && this.onlineStandings && this.onlineStandings.length > 0)
      ? this.onlineStandings
      : this.getCanonicalRankByPlayer();
    this.applyCompetitiveBalance(positions);
    if (!this.online?.enabled) {
      this.itemSystem.updateOnlineVisuals(dt);
      this.itemSystem.applyOnlineItemBoxes(this.localSimItemBoxes.map(b => ({
        x: b.x, y: b.y, z: b.z, active: b.active, previewItem: b.previewItem,
      })));
    }

    const speeds = this.karts.map(k => k.currentSpeed);
    const laps = this.karts.map(k => k.lap);
    const items = this.karts.map((_, i) => this.itemSystem.getItemName(i));
    const driftLevels = this.karts.map(k => k.driftLevel);
    const chainBlocks = this.karts.map(k => k.getChainLength());
    const eliminated = this.karts.map(k => k.isEliminated());
    const worldPositions = this.karts.map(k => k.getPosition());
    const headings = this.karts.map(k => k.heading);
    const checkpointTotal = this.track.checkpoints.length;
    const checkpointPassed = this.karts.map(k => k.lastCheckpoint < 0 ? 0 : k.lastCheckpoint + 1);
    const nextCheckpointPositions = this.karts.map(k => {
      const nextIdx = (k.lastCheckpoint + 1 + checkpointTotal) % checkpointTotal;
      const cp = this.track.checkpoints[nextIdx];
      return { x: cp.position.x, z: cp.position.z };
    });

    this.hud.update(
      speeds,
      laps,
      items,
      positions,
      chainBlocks,
      eliminated,
      driftLevels,
      this.raceTime,
      this.bestLapTimes,
      worldPositions,
      headings,
      nextCheckpointPositions,
      checkpointPassed,
      checkpointTotal,
    );
    if (SHOW_ONLINE_ROOM_INTEL) this.updateOnlineRosterOverlay();

    this.splitScreen.render(this.scene);
    this.animFrameId = requestAnimationFrame(() => this.gameLoop());
  }

  private updateOnlineRosterOverlay() {
    if (!this.online?.enabled || !this.onlineRosterEl) return;
    const rows = this.onlineRoster
      .sort((a, b) => a.slotIndex - b.slotIndex)
      .map(m => {
        const item = this.itemSystem.getItemName(m.slotIndex) ?? 'NONE';
        const status = m.connected ? '' : ' [OFFLINE]';
        return `P${m.slotIndex + 1} ${m.name}${status} · ${item.toUpperCase()}`;
      })
      .join('<br/>');
    this.onlineRosterEl.innerHTML = `
      <div style="color:#fff;margin-bottom:4px">ONLINE ROOM INTEL</div>
      <div>${rows || 'No room data'}</div>
    `;
  }

  private updateBitcoinData(dt: number, nowMs: number) {
    this.btcPollTimerMs -= dt * 1000;
    if (this.btcPollTimerMs <= 0) {
      this.btcPollTimerMs = 15000;
      void this.fetchBitcoinData();
    }

    this.congestionLevelSmoothed += (this.congestionLevelTarget - this.congestionLevelSmoothed) * Math.min(1, dt * 2.5);

    const fog = this.scene.fog as THREE.FogExp2 | null;
    if (fog) {
      fog.density = 0.00145 + this.congestionLevelSmoothed * 0.0011;
      const c = new THREE.Color().setRGB(
        0.02 + this.congestionLevelSmoothed * 0.09,
        0.02 + this.congestionLevelSmoothed * 0.03,
        0.02 + this.congestionLevelSmoothed * 0.02,
      );
      fog.color.copy(c);
    }

    this.track.setMempoolCongestion(this.congestionLevelSmoothed);
  }

  private async fetchBitcoinData() {
    if (this.btcFetchInFlight || this.disposed) return;
    this.btcFetchInFlight = true;
    try {
      const [mempool, recommended, mempoolBlocks, blocks] = await Promise.all([
        this.fetchJson<{ count?: number; vsize?: number; total_fee?: number }>(`${MEMPOOL_API_BASE}/mempool`),
        this.fetchJson<{
          fastestFee?: number;
          halfHourFee?: number;
          hourFee?: number;
          minimumFee?: number;
        }>(`${MEMPOOL_API_BASE}/v1/fees/recommended`),
        this.fetchJson<Array<{ medianFee?: number; feeRange?: number[]; blockVSize?: number; nTx?: number }>>(`${MEMPOOL_API_BASE}/v1/fees/mempool-blocks`),
        this.fetchJson<Array<{ size?: number; tx_count?: number; extras?: { totalFees?: number } }>>(`${MEMPOOL_API_BASE}/blocks`),
      ]);

      const vsize = mempool?.vsize ?? 0;
      const count = mempool?.count ?? 0;
      const mempoolPressure = THREE.MathUtils.clamp(
        Math.max(vsize / 3_500_000, count / 220_000),
        0,
        1,
      );
      this.congestionLevelTarget = mempoolPressure;

      const bands = (mempoolBlocks ?? [])
        .map(b => b.medianFee ?? b.feeRange?.[Math.floor((b.feeRange?.length ?? 1) / 2)] ?? 0)
        .filter(v => Number.isFinite(v) && v > 0);
      if (bands.length > 0) this.track.setFeeHeatmap(bands as number[]);
      this.track.setMempoolLayeredSlabs(
        (mempoolBlocks ?? []).map(b => ({
          medianFee: b.medianFee,
          blockVSize: b.blockVSize,
          nTx: b.nTx,
        })),
      );

      if (recommended && Number.isFinite(recommended.fastestFee)) {
        this.track.setRecommendedFees({
          fastestFee: Math.max(1, Math.round(recommended.fastestFee ?? 1)),
          halfHourFee: Math.max(1, Math.round(recommended.halfHourFee ?? recommended.fastestFee ?? 1)),
          hourFee: Math.max(1, Math.round(recommended.hourFee ?? recommended.halfHourFee ?? recommended.fastestFee ?? 1)),
          minimumFee: Math.max(1, Math.round(recommended.minimumFee ?? 1)),
        });
      }
      this.track.setRecentBlocks(blocks ?? []);
    } catch {
      // Keep previous visuals if the public API is unavailable temporarily.
    } finally {
      this.btcFetchInFlight = false;
    }
  }

  private async fetchJson<T>(url: string): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4500);
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json() as T;
    } finally {
      clearTimeout(timer);
    }
  }

  private updateRace(dt: number) {
    if (this.online?.enabled) return;
    this.updateSacrificeCooldowns(dt);
    const frameEvents: OnlineRaceEvent[] = [];
    const rng = () => nextSimRandom(this.localSimRngState);
    this.updateFinalLapIntensity();
    stepItemBoxes(this.localSimItemBoxes, dt, this.finalLapIntensityActive, rng);
    const prevLaps = this.karts.map(k => k.lap);
    const prevFinished = this.karts.map(k => k.finished);
    const preStepPositions = this.getPositions();
    const localItemPlayers = this.karts.map((k, i) => {
      const pos = k.getPosition();
      const held = this.itemSystem.playerItems[i];
      return {
        x: pos.x,
        y: pos.y,
        z: pos.z,
        heading: k.heading,
        speed: k.speed,
        finished: k.finished,
        chainLength: k.getChainLength(),
        heldItemId: (held === 'ln_turbo' || held === 'mempool_mine' || held === 'fee_spike' || held === 'sats_siphon' || held === 'nostr_zap')
          ? held
          : null,
      };
    });
    const inputs: SimInput[] = Array.from({ length: NUM_PLAYERS }, () => ({
      forward: false,
      backward: false,
      left: false,
      right: false,
      drift: false,
    }));
    const raceAssist: number[] = new Array(NUM_PLAYERS).fill(1);
    // Match server ordering: obstacle hits resolve before per-player actions/item usage.
    stepObstacles(this.localSimObstacles, localItemPlayers as any, dt);

    for (let i = 0; i < NUM_PLAYERS; i++) {
      this.chainLengths[i] = this.karts[i].getChainLength();
      this.eliminated[i] = this.karts[i].isEliminated();
      if (this.eliminated[i]) {
        this.localRaceActionPressState[i].prevUseItemPressed = false;
        this.localRaceActionPressState[i].prevSacrificePressed = false;
        continue;
      }

      let input: import('./InputManager').PlayerInput;
      if (this.karts[i].finished || this.isAI[i]) {
        const pos = this.karts[i].getPosition();
        const aiRuntime = this.localSimRuntime[i] ?? (this.localSimRuntime[i] = createDefaultRuntimeState());
        const aiInput = getAdvancedAiInput(
          {
            x: pos.x,
            y: pos.y,
            z: pos.z,
            heading: this.karts[i].heading,
            speed: this.karts[i].speed,
            chainLength: this.karts[i].getChainLength(),
          },
          this.localSimTrackMain,
          aiRuntime,
          dt,
          rng,
        );
        input = {
          forward: !!aiInput.forward,
          backward: !!aiInput.backward,
          left: !!aiInput.left,
          right: !!aiInput.right,
          drift: !!aiInput.drift,
          useItem: false,
          lookBack: false,
          sacrificeBoost: false,
        };
      } else {
        input = this.inputManager.getInput(this.online?.enabled ? 0 : i);
        if (this.online?.enabled && i === this.online.localSlot) {
          this.online.sendInput(input);
        }
      }
      inputs[i] = {
        forward: !!input.forward,
        backward: !!input.backward,
        left: !!input.left,
        right: !!input.right,
        drift: !!input.drift,
      };

      const rt = this.localSimRuntime[i] ?? (this.localSimRuntime[i] = createDefaultRuntimeState());
      const actionEdges = consumeRaceActionEdges({
        useItem: !!input.useItem,
        sacrificeBoost: !!input.sacrificeBoost,
      }, this.localRaceActionPressState[i]);
      rt.aiItemCooldownMs = Math.max(0, rt.aiItemCooldownMs - dt * 1000);
      if (this.karts[i].finished) {
        // Keep finished racers moving but don't spend items.
      } else if (this.isAI[i]) {
        const held = this.itemSystem.playerItems[i];
        if (held && rt.aiItemCooldownMs <= 0 && shouldAiUseItem(i, localItemPlayers as any, held as ItemId, rng)) {
          this.useSharedLocalItem(i, frameEvents);
          rt.aiItemCooldownMs = 900 + rng() * 700;
        }
      } else if (i === (this.online?.enabled ? this.online.localSlot : i) && actionEdges.useItemJustPressed) {
        this.useSharedLocalItem(i, frameEvents);
      }
      if (!this.isAI[i] && !this.karts[i].finished && i === (this.online?.enabled ? this.online.localSlot : i) && actionEdges.sacrificeJustPressed) {
        if (this.trySacrificeBoost(i, false)) {
          frameEvents.push({ type: 'sacrifice_boost', playerIndex: i });
        }
      }
      const rank = Math.max(0, Math.min(3, preStepPositions[i] ?? 0));
      raceAssist[i] = getRaceBalanceAssist(rank, this.karts[i].getChainLength(), START_CHAIN_BLOCKS);

      // Runtime effect timers are authoritative from shared sim step.
      // Avoid feeding visual effect flags back into runtime, which can latch boost/slow.
    }

    const simPlayers: SimPlayerState[] = this.karts.map((kart, i) => {
      const pos = kart.getPosition();
      return {
        x: pos.x,
        y: pos.y,
        z: pos.z,
        heading: kart.heading,
        speed: kart.speed,
        chainLength: kart.getChainLength(),
        chainClass: this.chainClasses[i] ?? 'balanced',
        drifting: kart.drifting,
        driftDirection: kart.driftDirection,
        driftCharge: kart.driftCharge,
        lap: kart.lap,
        lastCheckpoint: kart.lastCheckpoint,
        finished: kart.finished,
        eliminated: kart.isEliminated(),
        speedBoostActive: kart.speedBoostActive,
        slowActive: kart.slowActive,
      };
    });
    const simState: SimRaceState = {
      tick: this.localSimTick,
      timeMs: this.localSimTimeMs,
      totalLaps: this.totalLaps,
      trackMain: this.localSimTrackMain,
      trackAll: this.localSimTrackAll.length > 0 ? this.localSimTrackAll : this.localSimTrackMain,
      checkpoints: this.localSimCheckpoints,
      players: simPlayers,
      runtime: this.localSimRuntime,
    };
    const step = stepRace(simState, inputs, dt, raceAssist);
    this.localSimTick = step.state.tick;
    this.localSimTimeMs = step.state.timeMs;

    for (let i = 0; i < NUM_PLAYERS; i++) {
      const p = step.state.players[i];
      const kart = this.karts[i];
      kart.applyNetworkState(
        p.x,
        p.y,
        p.z,
        p.heading,
        p.speed,
        p.chainLength,
        Math.max(dt, 1 / 120),
        p.drifting,
        p.driftDirection,
        p.driftCharge,
        p.eliminated,
      );
      kart.lap = p.lap;
      kart.lastCheckpoint = p.lastCheckpoint;
      kart.finished = p.finished;
      if (p.speedBoostActive && !kart.speedBoostActive) {
        kart.activateSpeedBoost(Math.max(120, this.localSimRuntime[i]?.speedBoostMs ?? 120));
      }
      if (p.slowActive && !kart.slowActive) {
        kart.activateSlow(Math.max(120, this.localSimRuntime[i]?.slowMs ?? 120));
      }
      this.chainLengths[i] = kart.getChainLength();
      this.eliminated[i] = kart.isEliminated();
      if (kart.body.position.y < -15) {
        kart.reset(this.track.startPositions[i], this.track.startRotation);
        this.localSimRuntime[i] = createDefaultRuntimeState();
        this.localRaceActionPressState[i].prevUseItemPressed = false;
        this.localRaceActionPressState[i].prevSacrificePressed = false;
        this.chainLengths[i] = START_CHAIN_BLOCKS;
        this.eliminated[i] = false;
        this.sacrificeCooldownMs[i] = 0;
        this.lapStartTimes[i] = this.raceTime;
        this.bestLapTimes[i] = Infinity;
      }
    }

    // Match server ordering: item pickup happens after shared stepRace integration.
    const postStepItemPlayers = this.karts.map((k, i) => {
      const pos = k.getPosition();
      return {
        x: pos.x,
        y: pos.y,
        z: pos.z,
        heading: k.heading,
        speed: k.speed,
        finished: k.finished,
        chainLength: k.getChainLength(),
        heldItemId: this.itemSystem.playerItems[i],
      };
    });
    for (let i = 0; i < NUM_PLAYERS; i++) {
      collectNearbyItem(i, postStepItemPlayers as any, this.localSimItemBoxes, this.finalLapIntensityActive);
      this.itemSystem.playerItems[i] = postStepItemPlayers[i].heldItemId;
    }

    for (let i = 0; i < NUM_PLAYERS; i++) {
      if (this.karts[i].lap > prevLaps[i]) {
        if (prevLaps[i] > 0) {
          const lapTime = this.raceTime - this.lapStartTimes[i];
          this.bestLapTimes[i] = Math.min(this.bestLapTimes[i], lapTime);
        }
        this.lapStartTimes[i] = this.raceTime;
      }
      if (!prevFinished[i] && this.karts[i].finished) {
        if (this.karts[i].finishTime === 0) this.karts[i].finishTime = this.raceTime;
        this.finishPovTarget[i] = i;
      }
    }
    // Match server ordering: resolve steal collisions after shared stepRace.
    this.handleStealCollisions(dt, frameEvents);
    this.checkRaceEnd();
    const placementOrder = computePlacements(
      step.state.players.map(p => ({
        finished: p.finished,
        eliminated: p.eliminated,
        finishTime: (p as any).finishTime,
        lap: p.lap,
        lastCheckpoint: p.lastCheckpoint,
        chainLength: p.chainLength,
      })),
      this.localSimCheckpoints.length,
    );
    const rankByPlayer = new Array(NUM_PLAYERS).fill(3);
    for (let place = 0; place < placementOrder.length && place < NUM_PLAYERS; place++) {
      const idx = placementOrder[place] | 0;
      if (idx >= 0 && idx < NUM_PLAYERS) rankByPlayer[idx] = place;
    }
    this.localAuthoritySnapshot = {
      tick: step.state.tick,
      players: step.state.players.map((p, i) => ({
        x: p.x,
        y: p.y,
        z: p.z,
        qx: 0,
        qy: Math.sin(p.heading * 0.5),
        qz: 0,
        qw: Math.cos(p.heading * 0.5),
        heading: p.heading,
        speed: p.speed,
        drifting: p.drifting,
        driftDirection: p.driftDirection,
        driftCharge: p.driftCharge,
        lap: p.lap,
        lastCheckpoint: p.lastCheckpoint,
        finished: p.finished,
        finishTime: this.karts[i].finishTime,
        eliminated: p.eliminated,
        chainLength: p.chainLength,
        heldItemId: this.itemSystem.playerItems[i] as any,
        speedBoostActive: p.speedBoostActive,
        slowActive: p.slowActive,
      })),
      itemBoxes: this.localSimItemBoxes.map(b => ({
        x: b.x,
        y: b.y,
        z: b.z,
        active: b.active,
        previewItem: b.previewItem,
      })),
      obstacles: this.localSimObstacles.map(o => ({
        x: o.x,
        y: o.y,
        z: o.z,
        lifetimeMs: o.lifetimeMs,
      })),
      standings: { placementOrder, rankByPlayer },
      events: [...step.events, ...frameEvents],
      at: Date.now(),
    };
  }

  private updateSnapshotFollowerRace(
    dt: number,
    options: { sendLocalInput: boolean; renderDelayMs: number; eventSource: 'local' | 'online' },
  ) {
    if (options.sendLocalInput && this.online?.enabled && this.online.localSlot >= 0) {
      const localInput = this.inputManager.getInput(0);
      this.online.sendInput(localInput);
    }
    if (!this.latestOnlineSnapshot) return;
    const renderDelayMs = options.renderDelayMs;
    const to = this.latestOnlineSnapshot;
    const from = this.prevOnlineSnapshot ?? to;
    const targetTime = Date.now() - renderDelayMs;
    const range = Math.max(1, to.at - from.at);
    const t = Math.max(0, Math.min(1, (targetTime - from.at) / range));
    const n = Math.min(NUM_PLAYERS, to.players.length);
    const snapPose = !this.onlinePoseInitialized;
    for (let i = 0; i < n; i++) {
      const a = from.players[i] ?? to.players[i];
      const b = to.players[i];
      const ix = THREE.MathUtils.lerp(a.x, b.x, t);
      const iy = THREE.MathUtils.lerp(a.y, b.y, t);
      const iz = THREE.MathUtils.lerp(a.z, b.z, t);
      const iHeading = this.lerpAngle(a.heading, b.heading, t);
      const iSpeed = THREE.MathUtils.lerp(a.speed, b.speed, t);
      const iChainLength = Math.max(0, Math.round(THREE.MathUtils.lerp(a.chainLength, b.chainLength, t)));
      // Online path is strict follower-only: keep authoritative server pose.
      const kart = this.karts[i];
      kart.applyNetworkState(
        ix,
        iy,
        iz,
        iHeading,
        iSpeed,
        iChainLength,
        snapPose ? 1 : Math.max(dt, 1 / 120),
        !!b.drifting,
        b.driftDirection ?? 0,
        b.driftCharge ?? 0,
        !!b.eliminated,
      );
      kart.lap = b.lap;
      kart.lastCheckpoint = b.lastCheckpoint;
      kart.finished = b.finished;
      kart.speedBoostActive = !!b.speedBoostActive;
      kart.slowActive = !!b.slowActive;
      this.itemSystem.playerItems[i] = b.heldItemId;
      this.chainLengths[i] = kart.getChainLength();
      this.eliminated[i] = kart.isEliminated();
    }
    if (snapPose) this.onlinePoseInitialized = true;
    this.itemSystem.updateOnlineVisuals(dt);
    this.itemSystem.applyOnlineItemBoxes(to.itemBoxes);
    this.itemSystem.applyOnlineObstacles(to.obstacles);
    this.consumeOnlineEvents(to, options.eventSource);
  }

  private consumeOnlineEvents(snapshot: OnlineRaceSnapshot, source: 'local' | 'online') {
    if (!snapshot.events || snapshot.tick <= this.lastProcessedOnlineEventTick) return;
    this.consumeRaceEvents(snapshot.events, source);
    this.lastProcessedOnlineEventTick = snapshot.tick;
  }

  private consumeRaceEvents(events: OnlineRaceEvent[], source: 'local' | 'online') {
    for (const event of events) this.applyRaceEvent(event, source);
  }

  private applyRaceEvent(event: OnlineRaceEvent, source: 'local' | 'online') {
    const sourcePos = this.karts[event.playerIndex]?.getPosition();
    switch (event.type) {
      case 'checkpoint': {
        const cpTotal = this.track.checkpoints.length;
        if (cpTotal <= 0) return;
        const passed = Math.max(0, this.karts[event.playerIndex]?.lastCheckpoint ?? -1) + 1;
        const showForSlot = source === 'online'
          ? event.playerIndex === this.online?.localSlot
          : this.humanPlayerIndices.includes(event.playerIndex);
        if (showForSlot) {
          this.showGlobalFeedback(`CHECKPOINT ${Math.min(cpTotal, passed)}/${cpTotal}`, sourcePos);
        }
        return;
      }
      case 'lap': {
        const lap = (this.karts[event.playerIndex]?.lap ?? 0) + 1;
        this.showGlobalFeedback(`P${event.playerIndex + 1} LAP ${Math.min(this.totalLaps, lap)}/${this.totalLaps}`, sourcePos);
        return;
      }
      case 'finish': {
        if (source === 'local' && this.karts[event.playerIndex] && this.karts[event.playerIndex].finishTime === 0) {
          this.karts[event.playerIndex].finishTime = this.raceTime;
          this.finishPovTarget[event.playerIndex] = event.playerIndex;
          this.checkRaceEnd();
        }
        const place = this.karts.filter(k => k.finished).length;
        this.showPlacementAnnouncement(event.playerIndex, Math.max(1, place));
        return;
      }
      case 'jump_start': {
        this.karts[event.playerIndex]?.triggerHopVisual();
        return;
      }
      case 'land':
        return;
      case 'drift_start':
        this.karts[event.playerIndex]?.triggerHopVisual();
        return;
      case 'drift_end':
        return;
      case 'steal_hit': {
        if (event.targetPlayerIndex == null) return;
        const targetPos = this.karts[event.targetPlayerIndex]?.getPosition();
        this.showGlobalFeedback(
          `P${event.playerIndex + 1} -1  |  P${event.targetPlayerIndex + 1} +1`,
          targetPos ?? sourcePos,
        );
        return;
      }
      case 'sacrifice_boost': {
        this.showGlobalFeedback(`P${event.playerIndex + 1} SACRIFICE BOOST`, sourcePos);
        return;
      }
      case 'item_used': {
        const item = event.itemId as ItemId | undefined;
        if (!item) return;
        this.itemSystem.playOnlineItemEffect(item, event.playerIndex, event.targetPlayerIndex, this.karts);
        const itemLabel = this.getItemShortLabel(item);
        this.showGlobalFeedback(`P${event.playerIndex + 1} ${itemLabel}`, sourcePos);
        return;
      }
      default:
        return;
    }
  }

  private getItemShortLabel(item: ItemId): string {
    if (item === 'ln_turbo') return 'LN TURBO';
    if (item === 'mempool_mine') return 'MEMPOOL MINE';
    if (item === 'fee_spike') return 'FEE SPIKE';
    if (item === 'sats_siphon') return 'SATS SIPHON';
    if (item === 'nostr_zap') return 'NOSTR ZAP';
    return 'ITEM';
  }

  private lerpAngle(a: number, b: number, t: number): number {
    const twopi = Math.PI * 2;
    let d = (b - a) % twopi;
    if (d > Math.PI) d -= twopi;
    if (d < -Math.PI) d += twopi;
    return a + d * t;
  }

  private updateSacrificeCooldowns(dt: number) {
    const deltaMs = dt * 1000;
    for (let i = 0; i < NUM_PLAYERS; i++) {
      if (this.sacrificeCooldownMs[i] > 0) {
        this.sacrificeCooldownMs[i] = Math.max(0, this.sacrificeCooldownMs[i] - deltaMs);
      }
    }
  }

  private useSharedLocalItem(playerIndex: number, frameEvents: OnlineRaceEvent[]) {
    if (this.online?.enabled) return;
    const players = this.karts.map((k, i): SimPlayerState & { heldItemId: ItemId | null } => {
      const pos = k.getPosition();
      const held = this.itemSystem.playerItems[i];
      return {
        x: pos.x,
        y: pos.y,
        z: pos.z,
        heading: k.heading,
        speed: k.speed,
        chainLength: k.getChainLength(),
        chainClass: this.chainClasses[i] ?? 'balanced',
        drifting: k.drifting,
        driftDirection: k.driftDirection,
        driftCharge: k.driftCharge,
        lap: k.lap,
        lastCheckpoint: k.lastCheckpoint,
        finished: k.finished,
        eliminated: k.isEliminated(),
        speedBoostActive: k.speedBoostActive,
        slowActive: k.slowActive,
        heldItemId: (held === 'ln_turbo' || held === 'mempool_mine' || held === 'fee_spike' || held === 'sats_siphon' || held === 'nostr_zap')
          ? held
          : null,
      };
    });
    const events: SimRaceEvent[] = [];
    const used = useHeldItem(
      playerIndex,
      players as any,
      this.localSimRuntime as any,
      this.localSimObstacles,
      this.finalLapIntensityActive,
      events,
      12,
    );
    if (!used) return;
    for (let i = 0; i < NUM_PLAYERS; i++) {
      const kart = this.karts[i];
      const p = players[i];
      const current = kart.getChainLength();
      if (p.chainLength < current) {
        for (let n = current; n > p.chainLength; n--) kart.loseBlock();
      } else if (p.chainLength > current) {
        for (let n = current; n < p.chainLength; n++) kart.gainBlock();
      }
      kart.speed = p.speed;
      kart.currentSpeed = p.speed;
      if ((this.localSimRuntime[i]?.speedBoostMs ?? 0) > 120) kart.activateSpeedBoost(this.localSimRuntime[i].speedBoostMs);
      if ((this.localSimRuntime[i]?.slowMs ?? 0) > 120) kart.activateSlow(this.localSimRuntime[i].slowMs);
      this.itemSystem.playerItems[i] = p.heldItemId;
      this.chainLengths[i] = kart.getChainLength();
      this.eliminated[i] = kart.isEliminated();
    }
    frameEvents.push(...events);
  }

  private trySacrificeBoost(playerIndex: number, emitFeedback = true): boolean {
    if (this.online?.enabled) return false;
    const kart = this.karts[playerIndex];
    const players = this.karts.map((k): SimPlayerState => {
      const pos = k.getPosition();
      return {
        x: pos.x,
        y: pos.y,
        z: pos.z,
        heading: k.heading,
        speed: k.speed,
        chainLength: k.getChainLength(),
        chainClass: 'balanced',
        drifting: k.drifting,
        driftDirection: k.driftDirection,
        driftCharge: k.driftCharge,
        lap: k.lap,
        lastCheckpoint: k.lastCheckpoint,
        finished: k.finished,
        eliminated: k.isEliminated(),
        speedBoostActive: k.speedBoostActive,
        slowActive: k.slowActive,
      };
    });
    if (players[playerIndex].chainLength <= 2) {
      if (emitFeedback) this.showGlobalFeedback(`P${playerIndex + 1} NEEDS 3+ BLOCKS`, kart.getPosition());
      return false;
    }
    const runtime = this.localSimRuntime as Array<{ speedBoostMs: number }>;
    const maxSpeedByPlayer = this.chainClasses.map(cc => getChainClassTuning(cc ?? 'balanced').maxSpeed);
    const ok = trySacrificeBoost(
      playerIndex,
      players,
      runtime,
      this.sacrificeCooldownMs,
      maxSpeedByPlayer,
      { minChainRequired: 3, cooldownMs: SACRIFICE_BOOST_COOLDOWN_MS, boostDurationMs: SACRIFICE_BOOST_DURATION_MS },
    );
    if (!ok) return false;
    const target = players[playerIndex];
    const current = kart.getChainLength();
    if (target.chainLength < current) {
      for (let n = current; n > target.chainLength; n--) kart.loseBlock();
    }
    kart.speed = target.speed;
    kart.currentSpeed = target.speed;
    kart.activateSpeedBoost(Math.max(120, runtime[playerIndex].speedBoostMs));

    this.chainLengths[playerIndex] = kart.getChainLength();
    this.eliminated[playerIndex] = kart.isEliminated();
    if (emitFeedback) this.showGlobalFeedback(`P${playerIndex + 1} SACRIFICE BOOST`, kart.getPosition());
    return true;
  }

  private handleStealCollisions(dt: number, events?: OnlineRaceEvent[]) {
    if (this.online?.enabled) return;
    const players = this.karts.map((k): SimPlayerState => {
      const pos = k.getPosition();
      return {
        x: pos.x,
        y: pos.y,
        z: pos.z,
        heading: k.heading,
        speed: k.speed,
        chainLength: k.getChainLength(),
        chainClass: 'balanced',
        drifting: k.drifting,
        driftDirection: k.driftDirection,
        driftCharge: k.driftCharge,
        lap: k.lap,
        lastCheckpoint: k.lastCheckpoint,
        finished: k.finished,
        eliminated: k.isEliminated(),
        speedBoostActive: k.speedBoostActive,
        slowActive: k.slowActive,
      };
    });
    const runtime = this.localSimRuntime as Array<{ slowMs: number }>;
    const simEvents: SimRaceEvent[] = [];
    stepStealCollisions(
      players,
      this.karts.map(k => !k.isEliminated()),
      runtime,
      this.stealCooldownMs,
      dt,
      simEvents,
      { maxBlocks: 12, cooldownMs: STEAL_COOLDOWN_MS, segmentSpacing: 0.88, headToBodyHitDistance: 1.0 },
    );
    for (let i = 0; i < NUM_PLAYERS; i++) {
      const kart = this.karts[i];
      const target = players[i];
      const current = kart.getChainLength();
      if (target.chainLength < current) {
        for (let n = current; n > target.chainLength; n--) kart.loseBlock();
      } else if (target.chainLength > current) {
        for (let n = current; n < target.chainLength; n++) kart.gainBlock();
      }
      kart.speed = target.speed;
      kart.currentSpeed = target.speed;
      if ((runtime[i]?.slowMs ?? 0) > 120) kart.activateSlow(runtime[i].slowMs);
      this.chainLengths[i] = kart.getChainLength();
      this.eliminated[i] = kart.isEliminated();
    }
    if (events) {
      events.push(...simEvents);
    } else {
      for (const e of simEvents) {
        if (e.targetPlayerIndex == null) continue;
        const atkHead = this.karts[e.playerIndex].getPosition();
        this.showStealFeedback(e.playerIndex, e.targetPlayerIndex, atkHead);
      }
    }
  }

  private updateFinalLapIntensity() {
    const shouldBeActive = shouldEnableFinalLapIntensity(
      this.karts.map(k => ({
        lap: k.lap,
        finished: k.finished,
        chainLength: k.getChainLength(),
      })),
      this.totalLaps,
    );
    if (shouldBeActive !== this.finalLapIntensityActive) {
      this.finalLapIntensityActive = shouldBeActive;
      this.itemSystem.setFinalLapIntensity(shouldBeActive);
      if (shouldBeActive) {
        this.showGlobalFeedback('FINAL LAP INTENSITY');
      }
    }
  }

  private showStealFeedback(attacker: number, victim: number, worldPos: THREE.Vector3) {
    const msg = `P${attacker + 1} -1  |  P${victim + 1} +1`;
    this.showGlobalFeedback(msg, worldPos);
  }

  private showGlobalFeedback(text: string, worldPos?: THREE.Vector3) {
    const div = document.createElement('div');
    div.textContent = text;
    const left = worldPos ? `${50 + Math.max(-35, Math.min(35, worldPos.x * 0.18))}%` : '50%';
    const top = worldPos ? `${50 + Math.max(-25, Math.min(25, worldPos.z * 0.12))}%` : '45%';
    div.style.cssText = `
      position:absolute; left:${left}; top:${top}; transform:translate(-50%,-50%);
      z-index:30; pointer-events:none;
      color:#ffffff; font-family:'Courier New', monospace; font-size:18px; font-weight:bold;
      text-shadow:0 0 10px rgba(255,255,255,0.8), 0 0 22px rgba(255,255,255,0.45);
      opacity:1; transition: opacity 0.35s ease, transform 0.35s ease;
    `;
    this.container.appendChild(div);
    requestAnimationFrame(() => {
      div.style.opacity = '0';
      div.style.transform = 'translate(-50%,-80%)';
    });
    setTimeout(() => div.remove(), 380);
  }

  private ordinal(place: number): string {
    if (place % 100 >= 11 && place % 100 <= 13) return `${place}TH`;
    const mod = place % 10;
    if (mod === 1) return `${place}ST`;
    if (mod === 2) return `${place}ND`;
    if (mod === 3) return `${place}RD`;
    return `${place}TH`;
  }

  private showPlacementAnnouncement(playerIndex: number, place: number) {
    const name = this.playerNames[playerIndex] ?? `P${playerIndex + 1}`;
    const title = place === 1 ? 'WINNER!' : `${this.ordinal(place)} PLACE!`;
    this.showRaceAnnouncement(`${name} — ${title}`, 'Press item button to change POV after finish');
  }

  applyAuthoritativeRaceFinished(top3Ids: number[]) {
    if (this.raceEndTimeoutId !== null) return;
    this.raceActive = false;
    const top3Names = top3Ids
      .slice(0, 3)
      .map(id => this.playerNames[id] ?? `P${id + 1}`)
      .join(' · ');
    this.showRaceAnnouncement('RACE OVER', `Top 3: ${top3Names}`, 1900);
  }

  private showRaceAnnouncement(title: string, subtitle?: string, durationMs = 2200) {
    if (this.raceAnnouncementEl) {
      this.raceAnnouncementEl.remove();
      this.raceAnnouncementEl = null;
    }
    const wrap = document.createElement('div');
    wrap.style.cssText = `
      position:absolute; left:50%; top:22%; transform:translate(-50%,-50%) scale(0.96);
      z-index:120; pointer-events:none; text-align:center; opacity:0;
      font-family:'Courier New', monospace;
      transition: transform 0.2s ease, opacity 0.2s ease;
    `;

    const h = document.createElement('div');
    h.textContent = title;
    h.style.cssText = `
      color:#ffffff; font-size:56px; font-weight:bold; letter-spacing:2px;
      text-shadow:0 0 16px rgba(255,255,255,0.9), 0 0 36px rgba(255,255,255,0.45);
    `;
    wrap.appendChild(h);

    if (subtitle) {
      const s = document.createElement('div');
      s.textContent = subtitle;
      s.style.cssText = `
        margin-top:8px; color:rgba(255,255,255,0.9); font-size:16px;
        text-shadow:0 0 10px rgba(255,255,255,0.25);
      `;
      wrap.appendChild(s);
    }

    this.container.appendChild(wrap);
    this.raceAnnouncementEl = wrap;
    requestAnimationFrame(() => {
      wrap.style.opacity = '1';
      wrap.style.transform = 'translate(-50%,-50%) scale(1)';
    });
    setTimeout(() => {
      if (!wrap.isConnected) return;
      wrap.style.opacity = '0';
      wrap.style.transform = 'translate(-50%,-52%) scale(1.02)';
      setTimeout(() => {
        if (wrap.isConnected) wrap.remove();
        if (this.raceAnnouncementEl === wrap) this.raceAnnouncementEl = null;
      }, 220);
    }, durationMs);
  }

  private updateEliminatedSpectatorCamera(playerIndex: number, dt: number) {
    const input = this.inputManager.getInput(playerIndex);
    const cameraEdges = consumeRaceActionEdges(
      { useItem: !!input.useItem, sacrificeBoost: !!input.drift },
      this.cameraActionPressState[playerIndex],
    );
    const driftJustPressed = cameraEdges.sacrificeJustPressed;
    const useJustPressed = cameraEdges.useItemJustPressed;

    if (driftJustPressed) {
      this.spectatorMode[playerIndex] = this.spectatorMode[playerIndex] === 'follow' ? 'free' : 'follow';
      if (this.spectatorMode[playerIndex] === 'free') {
        const cam = this.splitScreen.cameras[playerIndex];
        this.freeFlyPos[playerIndex].copy(cam.position);
        const dir = new THREE.Vector3();
        cam.getWorldDirection(dir);
        this.freeFlyYaw[playerIndex] = Math.atan2(dir.x, dir.z);
        this.freeFlyPitch[playerIndex] = Math.asin(THREE.MathUtils.clamp(dir.y, -0.95, 0.95));
        this.showGlobalFeedback(`P${playerIndex + 1} FREE FLY`);
      } else {
        this.showGlobalFeedback(`P${playerIndex + 1} FOLLOW CAM`);
      }
    }

    if (this.spectatorMode[playerIndex] === 'follow') {
      if (useJustPressed) {
        this.spectateTarget[playerIndex] = this.findNextSpectateTarget(
          playerIndex,
          this.spectateTarget[playerIndex],
        );
      }
      const target = this.findSpectateTargetOrSelf(playerIndex, this.spectateTarget[playerIndex]);
      this.spectateTarget[playerIndex] = target;
      const tk = this.karts[target];
      this.cameras[playerIndex].setLookBack(false);
      this.cameras[playerIndex].update(
        tk.getPosition(), tk.getQuaternion(), dt,
        tk.speed, tk.maxSpeedPublic,
        tk.drifting, tk.driftDirection,
        tk.speedBoostActive,
      );
      return;
    }

    // FREE FLY
    const moveSpeed = 34;
    const riseSpeed = 18;
    const turnSpeed = 1.9;
    if (input.left) this.freeFlyYaw[playerIndex] += turnSpeed * dt;
    if (input.right) this.freeFlyYaw[playerIndex] -= turnSpeed * dt;

    const yaw = this.freeFlyYaw[playerIndex];
    const pitch = this.freeFlyPitch[playerIndex];
    const forward = new THREE.Vector3(
      Math.sin(yaw) * Math.cos(pitch),
      Math.sin(pitch),
      Math.cos(yaw) * Math.cos(pitch),
    ).normalize();
    const up = new THREE.Vector3(0, 1, 0);

    if (input.forward) this.freeFlyPos[playerIndex].addScaledVector(forward, moveSpeed * dt);
    if (input.backward) this.freeFlyPos[playerIndex].addScaledVector(forward, -moveSpeed * dt);
    if (input.lookBack) this.freeFlyPos[playerIndex].addScaledVector(up, riseSpeed * dt);
    if (input.useItem) this.freeFlyPos[playerIndex].addScaledVector(up, -riseSpeed * dt);

    this.freeFlyPos[playerIndex].y = THREE.MathUtils.clamp(this.freeFlyPos[playerIndex].y, 6, 180);
    const cam = this.splitScreen.cameras[playerIndex];
    cam.position.copy(this.freeFlyPos[playerIndex]);
    cam.lookAt(this.freeFlyPos[playerIndex].clone().add(forward.multiplyScalar(35)));
  }

  private findSpectateTargetOrSelf(playerIndex: number, preferred: number): number {
    const pref = this.karts[preferred];
    if (
      preferred !== playerIndex &&
      pref &&
      !pref.isEliminated() &&
      !pref.finished
    ) return preferred;
    return this.findNextSpectateTarget(playerIndex, preferred);
  }

  private findNextSpectateTarget(playerIndex: number, current: number): number {
    for (let off = 1; off <= NUM_PLAYERS; off++) {
      const idx = (current + off) % NUM_PLAYERS;
      if (idx === playerIndex) continue;
      const k = this.karts[idx];
      if (!k.isEliminated() && !k.finished) return idx;
    }
    for (let off = 1; off <= NUM_PLAYERS; off++) {
      const idx = (current + off) % NUM_PLAYERS;
      if (idx === playerIndex) continue;
      const k = this.karts[idx];
      if (!k.isEliminated()) return idx;
    }
    return playerIndex;
  }

  private findValidPovTarget(playerIndex: number, preferred: number): number {
    if (preferred >= 0 && preferred < NUM_PLAYERS) {
      const p = this.karts[preferred];
      if (!p.isEliminated()) return preferred;
    }
    return this.findNextPovTarget(playerIndex, preferred);
  }

  private findNextPovTarget(playerIndex: number, current: number): number {
    for (let off = 1; off <= NUM_PLAYERS; off++) {
      const idx = (current + off + NUM_PLAYERS) % NUM_PLAYERS;
      if (!this.karts[idx].isEliminated()) return idx;
    }
    return playerIndex;
  }

  private getPositions(): number[] {
    const prog = this.karts.map(k => k.lap * this.track.checkpoints.length + k.lastCheckpoint);
    const indexed = prog.map((p, i) => ({ p, i }));
    indexed.sort((a, b) => b.p - a.p);
    const result = new Array(NUM_PLAYERS);
    for (let rank = 0; rank < NUM_PLAYERS; rank++) {
      result[indexed[rank].i] = rank;
    }
    return result;
  }

  private getCanonicalRankByPlayer(): number[] {
    const placementOrder = computePlacements(
      this.karts.map(k => ({
        finished: k.finished,
        eliminated: k.isEliminated(),
        finishTime: k.finishTime,
        lap: k.lap,
        lastCheckpoint: k.lastCheckpoint,
        chainLength: k.getChainLength(),
      })),
      this.track.checkpoints.length,
    );
    const rankByPlayer = new Array(NUM_PLAYERS).fill(NUM_PLAYERS - 1);
    for (let place = 0; place < placementOrder.length && place < NUM_PLAYERS; place++) {
      const playerIndex = placementOrder[place] | 0;
      if (playerIndex >= 0 && playerIndex < NUM_PLAYERS) rankByPlayer[playerIndex] = place;
    }
    return rankByPlayer;
  }

  private applyCompetitiveBalance(positions: number[]) {
    for (let i = 0; i < NUM_PLAYERS; i++) {
      const k = this.karts[i];
      if (k.finished || k.isEliminated()) {
        k.setRaceBalanceAssist(1);
        continue;
      }

      const rank = Math.max(0, Math.min(NUM_PLAYERS - 1, positions[i] ?? 0));
      const assist = getRaceBalanceAssist(rank, k.getChainLength(), START_CHAIN_BLOCKS);
      k.setRaceBalanceAssist(assist);
    }
  }

  private checkRaceEnd() {
    if (this.raceEndTimeoutId !== null) return;
    const racePlayers = this.karts.map(k => ({ finished: k.finished, eliminated: k.isEliminated() }));
    if (shouldEndRace(racePlayers, 3)) {
      const top3 = this.pickTopPlacements(3);
      this.raceActive = false;
      const top3Names = top3.map(id => this.playerNames[id] ?? `P${id + 1}`).join(' · ');
      this.showRaceAnnouncement('RACE OVER', `Top 3: ${top3Names}`, 1900);
      this.raceEndTimeoutId = window.setTimeout(() => {
        this.raceEndTimeoutId = null;
        this.onFinished(top3);
      }, 2000);
    }
  }

  private pickTopPlacements(count: number): number[] {
    const placements = computePlacements(
      this.karts.map(k => ({
        finished: k.finished,
        eliminated: k.isEliminated(),
        finishTime: k.finishTime,
        lap: k.lap,
        lastCheckpoint: k.lastCheckpoint,
        chainLength: k.getChainLength(),
      })),
      this.track.checkpoints.length,
    );
    return placements.slice(0, count);
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.animFrameId);
    if (this.raceEndTimeoutId !== null) {
      clearTimeout(this.raceEndTimeoutId);
      this.raceEndTimeoutId = null;
    }
    if (this.raceAnnouncementEl) {
      this.raceAnnouncementEl.remove();
      this.raceAnnouncementEl = null;
    }
    if (this.onlineRosterEl) {
      this.onlineRosterEl.remove();
      this.onlineRosterEl = null;
    }
    this.hud.dispose();
    this.itemSystem.dispose();
    this.splitScreen.dispose();
  }
}
