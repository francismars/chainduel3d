import { v4 as uuidv4 } from 'uuid';
import sim from '../../shared/sim';
import type { SimInput, SimPlayerRuntimeState, SimRaceEvent, SimRandomState } from '../../shared/sim';

const {
  createDefaultRuntimeState,
  createSimRandomState,
  nextSimRandom,
  getChainClassTuning: getSharedChainClassTuning,
  getAdvancedAiInput: getSharedAdvancedAiInput,
  getRaceBalanceAssist: getSharedRaceBalanceAssist,
  stepRace,
  trySacrificeBoost: trySharedSacrificeBoost,
  stepStealCollisions: stepSharedStealCollisions,
  buildSimCheckpoints: buildSharedSimCheckpoints,
  buildSimItemBoxes: buildSharedSimItemBoxes,
  buildSimMainTrackPoints: buildSharedSimMainTrackPoints,
  buildSimTrackPoints: buildSharedSimTrackPoints,
  buildSimStartFrame: buildSharedStartFrame,
  buildSimStartSlotPose: buildSharedStartSlotPose,
  rollPreviewItem: rollSharedPreviewItem,
  stepItemBoxes: stepSharedItemBoxes,
  collectNearbyItem: collectSharedNearbyItem,
  useHeldItem: useSharedHeldItem,
  shouldAiUseItem: shouldSharedAiUseItem,
  consumeRaceActionEdges: consumeSharedRaceActionEdges,
  stepObstacles: stepSharedObstacles,
  shouldEnableFinalLapIntensity: shouldEnableSharedFinalLapIntensity,
  computePlacements: computeSharedPlacements,
  shouldEndRace: shouldSharedEndRace,
} = sim;

export interface RoomSettings {
  laps: number;
  aiCount: number;
  maxHumans: number;
  chainClasses: Array<'balanced' | 'light' | 'heavy'>;
  trackId: string;
}

export interface RoomMember {
  memberId: string;
  name: string;
  isHost: boolean;
  slotIndex: number;
  connected: boolean;
  joinedAt: number;
}

export interface ChatMessage {
  id: string;
  memberId: string;
  name: string;
  text: string;
  at: number;
}

export interface OnlineRaceInput {
  forward: boolean;
  backward: boolean;
  left: boolean;
  right: boolean;
  useItem: boolean;
  lookBack: boolean;
  drift: boolean;
  sacrificeBoost: boolean;
}

export interface TrackControlPoint {
  x: number;
  z: number;
  w: number;
  e: number;
  ramp?: boolean;
  bridge?: boolean;
  noRails?: boolean;
}

export interface TrackShortcutControlPoint {
  x: number;
  z: number;
  e: number;
}

export interface TrackCustomLayout {
  main: TrackControlPoint[];
  shortcut?: TrackShortcutControlPoint[];
}

export interface RoomState {
  roomId: string;
  code: string;
  hostMemberId: string;
  phase: 'lobby' | 'countdown' | 'racing' | 'finished';
  createdAt: number;
  settings: RoomSettings;
  members: RoomMember[];
  chat: ChatMessage[];
  race?: {
    startedAt: number;
    tick: number;
    trackId?: string;
    trackLayout?: TrackCustomLayout | null;
    standings?: RaceStandings;
    finishedAt?: number;
  };
}

interface RaceStandings {
  placementOrder: number[];
  rankByPlayer: number[];
}

interface CreateRoomRequest {
  hostName: string;
  settings: RoomSettings;
  spectatorHost?: boolean;
}

interface InternalMember extends RoomMember {
  token: string;
}

interface InternalRoom {
  roomId: string;
  code: string;
  hostMemberId: string;
  phase: RoomState['phase'];
  createdAt: number;
  settings: RoomSettings;
  members: InternalMember[];
  chat: ChatMessage[];
  race?: {
    startedAt: number;
    tick: number;
    playerInputs: Array<OnlineRaceInput | null>;
    trackId?: string;
    trackLayout?: TrackCustomLayout | null;
    standings?: RaceStandings;
    simSlots: boolean[];
    simMainTrackPoints: SimTrackPoint[];
    simTrackPoints: SimTrackPoint[];
    simCheckpoints: SimCheckpoint[];
    itemBoxes: SimItemBox[];
    obstacles: SimObstacle[];
    finalLapIntensity: boolean;
    rngState: SimRandomState;
    stealCooldownMs: number[][];
    runtime: SimPlayerRuntime[];
    authoritative?: {
      tick: number;
      players: Array<{
        x: number; y: number; z: number;
        qx: number; qy: number; qz: number; qw: number;
        heading: number;
        speed: number;
        drifting: boolean;
        driftDirection: number;
        driftCharge: number;
        lap: number;
        lastCheckpoint: number;
        finished: boolean;
        finishTime?: number;
        eliminated: boolean;
        chainLength: number;
        heldItemId: string | null;
        speedBoostActive: boolean;
        slowActive: boolean;
      }>;
      itemBoxes?: Array<{
        x: number;
        y: number;
        z: number;
        active: boolean;
        previewItem: ItemId;
      }>;
      standings?: RaceStandings;
      events?: SimRaceEvent[];
      at: number;
    };
    finishedAt?: number;
  };
}

interface SimTrackPoint {
  x: number;
  y: number;
  z: number;
  dirX: number;
  dirZ: number;
  width: number;
  ramp: boolean;
}

interface SimCheckpoint {
  x: number;
  z: number;
  width: number;
}

type ItemId = 'ln_turbo' | 'mempool_mine' | 'fee_spike' | 'sats_siphon' | 'nostr_zap';

interface SimItemBox {
  x: number;
  y: number;
  z: number;
  active: boolean;
  respawnMs: number;
  previewItem: ItemId;
}

interface SimObstacle {
  x: number;
  y: number;
  z: number;
  lifetimeMs: number;
}

interface SimPlayerRuntime extends SimPlayerRuntimeState {
  sacrificeCooldownMs: number;
  prevUseItemPressed: boolean;
  prevSacrificePressed: boolean;
}

export class RoomManager {
  private readonly countdownMs = 3000;
  private readonly stealCooldownMsValue = 1100;
  private readonly sacrificeBoostCooldownMs = 2200;
  private readonly sacrificeBoostDurationMs = 1700;
  private readonly headToBodyHitDistance = 1.0;
  private readonly maxBlocks = 12;
  private readonly startBlocks = 5;
  private readonly segmentSpacing = 0.88;
  private rooms = new Map<string, InternalRoom>();
  private codeToRoomId = new Map<string, string>();
  private readonly defaultSimMainTrackPoints: SimTrackPoint[] = buildSharedSimMainTrackPoints(null);
  private readonly defaultSimTrackPoints: SimTrackPoint[] = buildSharedSimTrackPoints(null, this.defaultSimMainTrackPoints);
  private readonly defaultSimCheckpoints: SimCheckpoint[] = buildSharedSimCheckpoints(this.defaultSimMainTrackPoints);

  create(req: CreateRoomRequest): { room: RoomState; memberId: string; memberToken: string } {
    const roomId = uuidv4();
    const code = this.makeCode();
    const memberId = uuidv4();
    const memberToken = uuidv4();
    const now = Date.now();
    const settings: RoomSettings = {
      laps: Math.max(1, Math.min(9, Math.round(req.settings?.laps ?? 3))),
      aiCount: Math.max(0, Math.min(4, Math.round(req.settings?.aiCount ?? 3))),
      maxHumans: 4,
      chainClasses: this.sanitizeChainClasses(req.settings?.chainClasses),
      trackId: typeof req.settings?.trackId === 'string' && req.settings.trackId.trim()
        ? req.settings.trackId.trim()
        : 'default',
    };
    const room: InternalRoom = {
      roomId,
      code,
      hostMemberId: memberId,
      phase: 'lobby',
      createdAt: now,
      settings,
      members: [{
        memberId,
        token: memberToken,
        name: (req.hostName || 'Host').slice(0, 24),
        isHost: true,
        slotIndex: req.spectatorHost ? -1 : 0,
        connected: true,
        joinedAt: now,
      }],
      chat: [],
    };
    this.rooms.set(roomId, room);
    this.codeToRoomId.set(code, roomId);
    return { room: this.toState(room), memberId, memberToken };
  }

  joinByCode(code: string, name: string): { room: RoomState; memberId: string; memberToken: string } {
    const roomId = this.codeToRoomId.get(code.toUpperCase());
    if (!roomId) throw new Error('Room not found');
    const room = this.rooms.get(roomId);
    if (!room) throw new Error('Room not found');
    if (room.phase !== 'lobby') throw new Error('Race already started');
    if (room.members.length >= room.settings.maxHumans) throw new Error('Room is full');

    const used = new Set(room.members.map(m => m.slotIndex));
    let slotIndex = 0;
    while (used.has(slotIndex) && slotIndex < room.settings.maxHumans) slotIndex++;
    if (slotIndex >= room.settings.maxHumans) throw new Error('No open slots');

    const memberId = uuidv4();
    const memberToken = uuidv4();
    room.members.push({
      memberId,
      token: memberToken,
      name: (name || `Player ${room.members.length + 1}`).slice(0, 24),
      isHost: false,
      slotIndex,
      connected: true,
      joinedAt: Date.now(),
    });
    return { room: this.toState(room), memberId, memberToken };
  }

  get(roomId: string): RoomState | null {
    const room = this.rooms.get(roomId);
    return room ? this.toState(room) : null;
  }

  patchSettings(roomId: string, memberId: string, token: string, settings: Partial<RoomSettings>): RoomState {
    const room = this.getInternalValidated(roomId, memberId, token);
    if (room.hostMemberId !== memberId) throw new Error('Only host can change settings');
    if (room.phase !== 'lobby') throw new Error('Cannot change settings after start');
    room.settings = {
      laps: Math.max(1, Math.min(9, Math.round(settings.laps ?? room.settings.laps))),
      aiCount: Math.max(0, Math.min(4, Math.round(settings.aiCount ?? room.settings.aiCount))),
      maxHumans: room.settings.maxHumans,
      chainClasses: this.sanitizeChainClasses(settings.chainClasses ?? room.settings.chainClasses),
      trackId: typeof settings.trackId === 'string' && settings.trackId.trim()
        ? settings.trackId.trim()
        : room.settings.trackId,
    };
    return this.toState(room);
  }

  startRace(
    roomId: string,
    memberId: string,
    token: string,
    trackLayout: TrackCustomLayout | null = null,
    trackId?: string,
  ): RoomState {
    const room = this.getInternalValidated(roomId, memberId, token);
    if (room.hostMemberId !== memberId) throw new Error('Only host can start');
    if (room.phase !== 'lobby') throw new Error('Race already started');
    const simSlots = this.computeSimSlots(room);
    const sanitizedLayout = this.sanitizeTrackLayout(trackLayout);
    const rngState = createSimRandomState((this.hashString(room.roomId) ^ Date.now()) >>> 0);
    const simMainTrackPoints = buildSharedSimMainTrackPoints(sanitizedLayout as any);
    const simTrackPoints = buildSharedSimTrackPoints(sanitizedLayout as any, simMainTrackPoints);
    const simCheckpoints = buildSharedSimCheckpoints(simMainTrackPoints);
    const simItemBoxes = buildSharedSimItemBoxes(simMainTrackPoints, 10, () => rollSharedPreviewItem(() => nextSimRandom(rngState)));
    const players = this.createStartPlayers(simSlots, room.settings.laps, simMainTrackPoints);
    room.phase = 'countdown';
    room.race = {
      startedAt: Date.now() + this.countdownMs,
      tick: 0,
      playerInputs: Array.from({ length: room.settings.maxHumans }, () => null),
      trackId: trackId ?? room.settings.trackId ?? 'default',
      trackLayout: sanitizedLayout,
      standings: this.makeStandings([0, 1, 2, 3]),
      simSlots,
      simMainTrackPoints,
      simTrackPoints,
      simCheckpoints,
      itemBoxes: simItemBoxes,
      obstacles: [],
      finalLapIntensity: false,
      rngState,
      stealCooldownMs: Array.from({ length: 4 }, () => new Array(4).fill(0)),
      runtime: Array.from({ length: 4 }, () => ({
        ...createDefaultRuntimeState(),
        sacrificeCooldownMs: 0,
        prevUseItemPressed: false,
        prevSacrificePressed: false,
      })),
      authoritative: {
        tick: 0,
        players,
        itemBoxes: simItemBoxes.map(b => ({
          x: b.x,
          y: b.y,
          z: b.z,
          active: b.active,
          previewItem: b.previewItem,
        })),
        standings: this.makeStandings([0, 1, 2, 3]),
        events: [],
        at: Date.now(),
      },
    };
    return this.toState(room);
  }

  finishRace(roomId: string) {
    const room = this.rooms.get(roomId);
    if (!room || !room.race) return;
    room.phase = 'finished';
    room.race.finishedAt = Date.now();
  }

  leave(roomId: string, memberId: string, token: string): RoomState | null {
    const room = this.getInternalValidated(roomId, memberId, token);
    room.members = room.members.filter(m => m.memberId !== memberId);
    if (room.members.length === 0) {
      this.rooms.delete(roomId);
      this.codeToRoomId.delete(room.code);
      return null;
    }
    if (!room.members.some(m => m.memberId === room.hostMemberId)) {
      room.hostMemberId = room.members[0].memberId;
      room.members[0].isHost = true;
    }
    return this.toState(room);
  }

  markDisconnected(roomId: string, memberId: string) {
    const room = this.rooms.get(roomId);
    if (!room) return;
    const m = room.members.find(x => x.memberId === memberId);
    if (m) m.connected = false;
  }

  markConnected(roomId: string, memberId: string) {
    const room = this.rooms.get(roomId);
    if (!room) return;
    const m = room.members.find(x => x.memberId === memberId);
    if (m) m.connected = true;
  }

  addChat(roomId: string, memberId: string, token: string, text: string): ChatMessage {
    const room = this.getInternalValidated(roomId, memberId, token);
    const member = room.members.find(m => m.memberId === memberId)!;
    const msg: ChatMessage = {
      id: uuidv4(),
      memberId,
      name: member.name,
      text: text.slice(0, 220),
      at: Date.now(),
    };
    room.chat.push(msg);
    if (room.chat.length > 120) room.chat.shift();
    return msg;
  }

  setRaceInput(roomId: string, memberId: string, token: string, input: OnlineRaceInput) {
    const room = this.getInternalValidated(roomId, memberId, token);
    if (!room.race || room.phase !== 'racing') return;
    const member = room.members.find(m => m.memberId === memberId)!;
    room.race.playerInputs[member.slotIndex] = input;
  }

  tickRace(roomId: string, dtSec = 1 / 20) {
    const room = this.rooms.get(roomId);
    if (!room || !room.race || (room.phase !== 'racing' && room.phase !== 'countdown')) return null;
    const now = Date.now();
    if (room.phase === 'countdown') {
      if (now >= room.race.startedAt) {
        room.phase = 'racing';
      }
      room.race.authoritative!.at = now;
      return room.race;
    }
    room.race.tick += 1;
    this.stepAuthoritativeRace(room, dtSec);
    const activePlayers = (room.race.authoritative?.players ?? []).filter((_, i) => !!room.race?.simSlots[i]);
    const raceShouldEnd = shouldSharedEndRace(activePlayers as Array<{ finished: boolean; eliminated: boolean }>, 3);
    room.race.standings = this.makeStandings(
      computeSharedPlacements(
        room.race.authoritative?.players ?? [],
        room.race.simCheckpoints.length || 14,
      ),
    );
    if (raceShouldEnd) {
      room.phase = 'finished';
      room.race.finishedAt = Date.now();
    }
    return room.race;
  }

  listActiveRaceRoomIds(): string[] {
    const ids: string[] = [];
    for (const [id, room] of this.rooms.entries()) {
      if ((room.phase === 'racing' || room.phase === 'countdown') && room.race) ids.push(id);
    }
    return ids;
  }

  getState(roomId: string): RoomState | null {
    const room = this.rooms.get(roomId);
    return room ? this.toState(room) : null;
  }

  getAuthoritativeSnapshot(roomId: string) {
    const room = this.rooms.get(roomId);
    if (!room?.race?.authoritative) return null;
    const auth = room.race.authoritative;
    return {
      tick: auth.tick,
      players: auth.players.map(p => ({ ...p })),
      itemBoxes: auth.itemBoxes?.map(b => ({ ...b })),
      obstacles: room.race.obstacles?.map(o => ({
        x: o.x,
        y: o.y,
        z: o.z,
        lifetimeMs: o.lifetimeMs,
      })),
      standings: auth.standings ? {
        placementOrder: [...auth.standings.placementOrder],
        rankByPlayer: [...auth.standings.rankByPlayer],
      } : undefined,
      events: auth.events?.map(e => ({ ...e })),
      at: auth.at,
    };
  }

  validateMember(roomId: string, memberId: string, token: string): boolean {
    const room = this.rooms.get(roomId);
    if (!room) return false;
    return room.members.some(m => m.memberId === memberId && m.token === token);
  }

  private getInternalValidated(roomId: string, memberId: string, token: string): InternalRoom {
    const room = this.rooms.get(roomId);
    if (!room) throw new Error('Room not found');
    const ok = room.members.some(m => m.memberId === memberId && m.token === token);
    if (!ok) throw new Error('Unauthorized');
    return room;
  }

  private toState(room: InternalRoom): RoomState {
    return {
      roomId: room.roomId,
      code: room.code,
      hostMemberId: room.hostMemberId,
      phase: room.phase,
      createdAt: room.createdAt,
      settings: { ...room.settings },
      members: room.members.map<RoomMember>(m => ({
        memberId: m.memberId,
        name: m.name,
        isHost: m.memberId === room.hostMemberId,
        slotIndex: m.slotIndex,
        connected: m.connected,
        joinedAt: m.joinedAt,
      })),
      chat: [...room.chat],
      race: room.race ? {
        startedAt: room.race.startedAt,
        tick: room.race.tick,
        trackId: room.race.trackId,
        trackLayout: room.race.trackLayout ? {
          main: room.race.trackLayout.main.map(cp => ({ ...cp })),
          shortcut: room.race.trackLayout.shortcut?.map(cp => ({ ...cp })),
        } : null,
        standings: room.race.standings ? {
          placementOrder: [...room.race.standings.placementOrder],
          rankByPlayer: [...room.race.standings.rankByPlayer],
        } : undefined,
        finishedAt: room.race.finishedAt,
      } : undefined,
    };
  }

  private computeSimSlots(room: InternalRoom): boolean[] {
    const slots = [false, false, false, false];
    for (const m of room.members) {
      if (m.slotIndex >= 0 && m.slotIndex < 4) slots[m.slotIndex] = true;
    }
    let aiLeft = Math.max(0, Math.min(4, room.settings.aiCount));
    for (let i = 0; i < 4 && aiLeft > 0; i++) {
      if (slots[i]) continue;
      slots[i] = true;
      aiLeft--;
    }
    return slots;
  }

  private createStartPlayers(simSlots: boolean[], totalLaps: number, simTrackPoints: SimTrackPoint[]) {
    const frame = buildSharedStartFrame(simTrackPoints);
    const list: Array<{
      x: number; y: number; z: number;
      qx: number; qy: number; qz: number; qw: number;
      heading: number;
      speed: number;
      drifting: boolean;
      driftDirection: number;
      driftCharge: number;
      lap: number;
      lastCheckpoint: number;
      finished: boolean;
      finishTime?: number;
      eliminated: boolean;
      chainLength: number;
      heldItemId: string | null;
      speedBoostActive: boolean;
      slowActive: boolean;
    }> = [];
    for (let i = 0; i < 4; i++) {
      const slot = buildSharedStartSlotPose(simTrackPoints, i);
      const qy = Math.sin(frame.heading * 0.5);
      const qw = Math.cos(frame.heading * 0.5);
      list.push({
        x: slot.x, y: slot.y, z: slot.z,
        qx: 0, qy, qz: 0, qw,
        heading: frame.heading,
        speed: 0,
        drifting: false,
        driftDirection: 0,
        driftCharge: 0,
        lap: 0,
        lastCheckpoint: -1,
        finished: !simSlots[i] || totalLaps <= 0,
        finishTime: !simSlots[i] || totalLaps <= 0 ? Number.POSITIVE_INFINITY : 0,
        eliminated: false,
        chainLength: this.startBlocks,
        heldItemId: null,
        speedBoostActive: false,
        slowActive: false,
      });
    }
    return list;
  }

  private stepAuthoritativeRace(room: InternalRoom, dt: number) {
    if (!room.race?.authoritative) return;
    const players = room.race.authoritative.players;
    const humanBySlot = new Map<number, InternalMember>();
    for (const m of room.members) humanBySlot.set(m.slotIndex, m);

    const simTrackPoints = room.race.simTrackPoints.length > 0 ? room.race.simTrackPoints : this.defaultSimTrackPoints;
    const simMainTrackPoints = room.race.simMainTrackPoints.length > 0 ? room.race.simMainTrackPoints : this.defaultSimMainTrackPoints;
    const simCheckpoints = room.race.simCheckpoints.length > 0 ? room.race.simCheckpoints : this.defaultSimCheckpoints;
    const rngState = room.race.rngState ?? (room.race.rngState = createSimRandomState((this.hashString(room.roomId) ^ Date.now()) >>> 0));
    const rng = () => nextSimRandom(rngState);
    const itemBoxes = room.race.itemBoxes ?? (room.race.itemBoxes = buildSharedSimItemBoxes(simMainTrackPoints, 10, () => rollSharedPreviewItem(rng)));
    const obstacles = room.race.obstacles ?? (room.race.obstacles = []);
    room.race.finalLapIntensity = shouldEnableSharedFinalLapIntensity(players as Array<{ lap: number; finished: boolean; chainLength: number }>, room.settings.laps);
    const runtime = room.race.runtime ?? (room.race.runtime = Array.from({ length: 4 }, () => ({
      ...createDefaultRuntimeState(),
      sacrificeCooldownMs: 0,
      prevUseItemPressed: false,
      prevSacrificePressed: false,
    })));
    const stealCooldownMs = room.race.stealCooldownMs ?? (room.race.stealCooldownMs = Array.from({ length: 4 }, () => new Array(4).fill(0)));
    const sacrificeCooldownMs = runtime.map(rt => rt.sacrificeCooldownMs);
    const maxSpeedByPlayer = players.map((_, idx) => getSharedChainClassTuning(room.settings.chainClasses[idx] ?? 'balanced').maxSpeed);
    const positions = this.getRacePositions(players, simCheckpoints.length);
    const frameEvents: SimRaceEvent[] = [];
    const inputs: SimInput[] = Array.from({ length: players.length }, () => ({
      forward: false,
      backward: false,
      left: false,
      right: false,
      drift: false,
    }));
    const raceAssist: number[] = new Array(players.length).fill(1);
    stepSharedItemBoxes(itemBoxes as any, dt, room.race.finalLapIntensity, rng);
    stepSharedObstacles(obstacles as any, players as any, dt);

    for (let i = 0; i < players.length; i++) {
      if (!room.race.simSlots[i]) continue;
      const p = players[i];
      const rt = runtime[i];
      p.eliminated = p.chainLength <= 0;
      if (p.finished || p.eliminated) {
        p.speed = 0;
        p.speedBoostActive = false;
        p.slowActive = false;
        rt.airborne = false;
        rt.vy = 0;
        rt.airborneElapsed = 0;
        continue;
      }
      const member = humanBySlot.get(i);
      const input = member ? (room.race.playerInputs[i] ?? {
        forward: false, backward: false, left: false, right: false, drift: false, useItem: false, lookBack: false, sacrificeBoost: false,
      }) : {
        ...getSharedAdvancedAiInput(
          p as { x: number; y: number; z: number; heading: number; speed: number; chainLength: number },
          simMainTrackPoints as any,
          rt,
          dt,
          rng,
        ),
        useItem: false,
        lookBack: false,
        sacrificeBoost: false,
      };
      rt.aiLastWaypointIdx = Math.max(0, rt.aiLastWaypointIdx | 0);
      rt.aiSteerNoise = Math.max(-0.4, Math.min(0.4, rt.aiSteerNoise));
      rt.aiNoiseCooldown = Math.max(0, rt.aiNoiseCooldown);
      sacrificeCooldownMs[i] = Math.max(0, sacrificeCooldownMs[i] - dt * 1000);
      rt.aiItemCooldownMs = Math.max(0, rt.aiItemCooldownMs - dt * 1000);
      inputs[i] = {
        forward: !!input.forward,
        backward: !!input.backward,
        left: !!input.left,
        right: !!input.right,
        drift: !!input.drift,
      };

      const actionEdges = consumeSharedRaceActionEdges({
        useItem: !!input.useItem,
        sacrificeBoost: !!input.sacrificeBoost,
      }, rt);
      if (actionEdges.sacrificeJustPressed && trySharedSacrificeBoost(
        i,
        players as any,
        runtime as any,
        sacrificeCooldownMs,
        maxSpeedByPlayer,
        {
          minChainRequired: 3,
          cooldownMs: this.sacrificeBoostCooldownMs,
          boostDurationMs: this.sacrificeBoostDurationMs,
        },
      )) {
        frameEvents.push({ type: 'sacrifice_boost', playerIndex: i });
      }
      if (actionEdges.useItemJustPressed && p.heldItemId) {
        useSharedHeldItem(i, players as any, runtime as any, obstacles as any, room.race.finalLapIntensity, frameEvents, this.maxBlocks);
      }
      if (!member && p.heldItemId && rt.aiItemCooldownMs <= 0 && shouldSharedAiUseItem(i, players as any, p.heldItemId as ItemId, rng)) {
        useSharedHeldItem(i, players as any, runtime as any, obstacles as any, room.race.finalLapIntensity, frameEvents, this.maxBlocks);
        rt.aiItemCooldownMs = 900 + rng() * 700;
      }

      // Match local competitive balancing by rank and chain size.
      const rank = Math.max(0, Math.min(3, positions[i] ?? 0));
      raceAssist[i] = getSharedRaceBalanceAssist(rank, p.chainLength, this.startBlocks);
    }

    const prevFinished = players.map(p => !!p.finished);
    const step = stepRace(
      {
        tick: room.race.tick - 1,
        timeMs: Math.max(0, (room.race.tick - 1) * dt * 1000),
        totalLaps: room.settings.laps,
        trackMain: simMainTrackPoints,
        trackAll: simTrackPoints,
        checkpoints: simCheckpoints,
        players: players as any,
        runtime: runtime as any,
      },
      inputs,
      dt,
      raceAssist,
    );
    for (let i = 0; i < players.length; i++) {
      if (!prevFinished[i] && players[i].finished && !players[i].eliminated && (players[i].finishTime ?? 0) <= 0) {
        players[i].finishTime = step.state.timeMs;
      }
    }

    for (let i = 0; i < players.length; i++) {
      if (!room.race.simSlots[i]) continue;
      const p = players[i];
      const rt = runtime[i];
      rt.sacrificeCooldownMs = sacrificeCooldownMs[i];
      collectSharedNearbyItem(i, players as any, itemBoxes as any, room.race.finalLapIntensity);
      p.speedBoostActive = rt.speedBoostMs > 0;
      p.slowActive = rt.slowMs > 0;
      p.eliminated = p.chainLength <= 0;
      const qy = Math.sin(p.heading * 0.5);
      const qw = Math.cos(p.heading * 0.5);
      p.qx = 0; p.qy = qy; p.qz = 0; p.qw = qw;
    }

    stepSharedStealCollisions(
      players as any,
      room.race.simSlots,
      runtime as any,
      stealCooldownMs,
      dt,
      frameEvents,
      {
        maxBlocks: this.maxBlocks,
        cooldownMs: this.stealCooldownMsValue,
        segmentSpacing: this.segmentSpacing,
        headToBodyHitDistance: this.headToBodyHitDistance,
      },
    );
    for (const p of players) {
      p.eliminated = p.chainLength <= 0;
      if (p.eliminated) p.speed = 0;
    }
    room.race.standings = this.makeStandings(computeSharedPlacements(players, simCheckpoints.length));
    room.race.authoritative.tick = room.race.tick;
    room.race.authoritative.itemBoxes = itemBoxes.map(b => ({
      x: b.x,
      y: b.y,
      z: b.z,
      active: b.active,
      previewItem: b.previewItem,
    }));
    room.race.authoritative.standings = room.race.standings ? {
      placementOrder: [...room.race.standings.placementOrder],
      rankByPlayer: [...room.race.standings.rankByPlayer],
    } : undefined;
    room.race.authoritative.events = [...step.events, ...frameEvents];
    room.race.authoritative.at = Date.now();
  }

  private getRacePositions(
    players: Array<{ lap: number; lastCheckpoint: number }>,
    checkpointCount: number,
  ): number[] {
    const prog = players.map(p => p.lap * checkpointCount + p.lastCheckpoint);
    const indexed = prog.map((score, i) => ({ score, i }));
    indexed.sort((a, b) => b.score - a.score);
    const out = new Array(players.length).fill(0);
    for (let rank = 0; rank < indexed.length; rank++) {
      out[indexed[rank].i] = rank;
    }
    return out;
  }

  private makeStandings(placementOrder: number[]): RaceStandings {
    const rankByPlayer = new Array(4).fill(3);
    for (let place = 0; place < placementOrder.length && place < 4; place++) {
      const playerIndex = placementOrder[place] | 0;
      if (playerIndex >= 0 && playerIndex < 4) rankByPlayer[playerIndex] = place;
    }
    return {
      placementOrder: placementOrder.slice(0, 4),
      rankByPlayer,
    };
  }

  private sanitizeChainClasses(input: unknown): Array<'balanced' | 'light' | 'heavy'> {
    const out: Array<'balanced' | 'light' | 'heavy'> = ['balanced', 'balanced', 'balanced', 'balanced'];
    if (!Array.isArray(input)) return out;
    for (let i = 0; i < 4; i++) {
      const v = input[i];
      out[i] = v === 'light' || v === 'heavy' ? v : 'balanced';
    }
    return out;
  }

  private sanitizeTrackLayout(layout: TrackCustomLayout | null | undefined): TrackCustomLayout | null {
    if (!layout || !Array.isArray(layout.main) || layout.main.length < 4) return null;
    const main = layout.main.map(cp => ({
      x: Number(cp.x) || 0,
      z: Number(cp.z) || 0,
      w: Math.max(4, Math.min(30, Number(cp.w) || 10)),
      e: Number(cp.e) || 0,
      ramp: !!cp.ramp,
      bridge: !!cp.bridge,
      noRails: !!cp.noRails,
    }));
    const shortcut = Array.isArray(layout.shortcut)
      ? layout.shortcut
        .filter(cp => Number.isFinite(cp.x) && Number.isFinite(cp.z) && Number.isFinite(cp.e))
        .map(cp => ({ x: Number(cp.x), z: Number(cp.z), e: Number(cp.e) }))
      : undefined;
    return { main, shortcut };
  }

  private hashString(value: string): number {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < value.length; i++) {
      h ^= value.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  private makeCode(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    do {
      code = '';
      for (let i = 0; i < 6; i++) {
        code += chars[Math.floor(Math.random() * chars.length)];
      }
    } while (this.codeToRoomId.has(code));
    return code;
  }
}

