import { v4 as uuidv4 } from 'uuid';
import sim from '../../shared/sim.js';
import type { SimInput, SimPlayerRuntimeState, SimRaceEvent, SimRandomState } from '../../shared/sim.js';
import type { GameMode, RoomSettlementSummary, WagerSettings } from '../../shared/types';
import type { RuntimeSnapshot } from './persistence.js';

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
  computeRecommendedItemBoxCount: computeSharedRecommendedItemBoxCount,
  buildSimMainRoutePoints: buildSharedSimMainRoutePoints,
  buildSimRoutePoints: buildSharedSimRoutePoints,
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

const MAX_PLAYERS = 8;

export interface RoomSettings {
  laps: number;
  aiCount: number;
  maxHumans: number;
  chainClasses: Array<'balanced' | 'light' | 'heavy'>;
  routeId: string;
  mode?: GameMode;
  wager?: WagerSettings;
}

export interface RoomMember {
  memberId: string;
  name: string;
  isHost: boolean;
  slotIndex: number;
  connected: boolean;
  pingMs?: number;
  disconnectedAt?: number;
  ready: boolean;
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

export interface RouteControlPoint {
  x: number;
  z: number;
  w: number;
  e: number;
  ramp?: boolean;
  bridge?: boolean;
  noRails?: boolean;
  boost?: boolean;
  loop?: boolean;
  tunnel?: boolean;
  tunnelWall?: boolean;
  tunnelWallSide?: 'bottom' | 'left' | 'right';
}

export interface RouteShortcutControlPoint {
  x: number;
  z: number;
  e: number;
}

type RouteLayoutType = 'loop' | 'arena';
type RouteArenaShape = 'circle' | 'rounded_rect';

interface RouteArenaObstacle {
  x: number;
  z: number;
  radius: number;
  height?: number;
}

export interface RouteCustomLayout {
  main: RouteControlPoint[];
  shortcut?: RouteShortcutControlPoint[];
  layoutType?: RouteLayoutType;
  arenaShape?: RouteArenaShape;
  arenaRadiusX?: number;
  arenaRadiusZ?: number;
  arenaFloorY?: number;
  arenaWallHeight?: number;
  arenaObstacleDensity?: number;
  interiorObstacles?: RouteArenaObstacle[];
  showCenterpiece?: boolean;
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
    mode?: GameMode;
    routeId?: string;
    routeLayout?: RouteCustomLayout | null;
    standings?: RaceStandings;
    captureSatsByPlayer?: number[];
    satsRemaining?: number;
    settlement?: RoomSettlementSummary;
    finishedAt?: number;
  };
}

interface RaceStandings {
  placementOrder: number[];
  rankByPlayer: number[];
  survivors?: number;
  eliminatedOrder?: number[];
}

interface CreateRoomRequest {
  hostName: string;
  settings: RoomSettings;
  spectatorHost?: boolean;
}

interface InternalMember extends RoomMember {
  token: string;
  tokenIssuedAt: number;
  tokenExpiresAt: number;
  pingMs?: number;
  disconnectedAt?: number;
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
    mode: GameMode;
    playerInputs: Array<OnlineRaceInput | null>;
    routeId?: string;
    routeLayout?: RouteCustomLayout | null;
    standings?: RaceStandings;
    captureSatsByPlayer: number[];
    satsRemaining: number;
    settlement?: RoomSettlementSummary;
    simSlots: boolean[];
    simMainTrackPoints: SimRoutePoint[];
    simTrackPoints: SimRoutePoint[];
    simCheckpoints: SimCheckpoint[];
    itemBoxes: SimItemBox[];
    obstacles: SimObstacle[];
    finalLapIntensity: boolean;
    rngState: SimRandomState;
    stealCooldownMs: number[][];
    runtime: SimPlayerRuntime[];
    authoritative?: {
      tick: number;
      mode: GameMode;
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
        captureSatsByPlayer?: number[];
        satsRemaining?: number;
      events?: SimRaceEvent[];
      at: number;
    };
    finishedAt?: number;
  };
}

interface SimRoutePoint {
  x: number;
  y: number;
  z: number;
  dirX: number;
  dirZ: number;
  width: number;
  ramp: boolean;
  boost: boolean;
  loop: boolean;
  tunnel: boolean;
  tunnelWall: boolean;
  tunnelWallSide: 'bottom' | 'left' | 'right';
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
  readonly disconnectGraceMs = 30_000;
  readonly memberTokenTtlMs = Math.max(5 * 60_000, Number(process.env.ROOM_MEMBER_TOKEN_TTL_MS || 24 * 60 * 60 * 1000));
  private readonly countdownMs = 3000;
  private readonly stealCooldownMsValue = 1100;
  private readonly sacrificeBoostCooldownMs = 2200;
  private readonly sacrificeBoostDurationMs = 1700;
  private readonly headToBodyHitDistance = 1.0;
  private readonly defaultMaxBlocks = 12;
  private readonly startBlocks = 5;
  private readonly segmentSpacing = 0.88;
  private rooms = new Map<string, InternalRoom>();
  private codeToRoomId = new Map<string, string>();
  private readonly defaultSimMainRoutePoints: SimRoutePoint[] = buildSharedSimMainRoutePoints(null);
  private readonly defaultSimRoutePoints: SimRoutePoint[] = buildSharedSimRoutePoints(null, this.defaultSimMainRoutePoints);
  private readonly defaultSimCheckpoints: SimCheckpoint[] = buildSharedSimCheckpoints(this.defaultSimMainRoutePoints);

  create(req: CreateRoomRequest): { room: RoomState; memberId: string; memberToken: string } {
    const roomId = uuidv4();
    const code = this.makeCode();
    const memberId = uuidv4();
    const memberToken = uuidv4();
    const now = Date.now();
    const settings: RoomSettings = {
      laps: Math.max(1, Math.min(9, Math.round(req.settings?.laps ?? 3))),
      aiCount: Math.max(0, Math.min(MAX_PLAYERS, Math.round(req.settings?.aiCount ?? 3))),
      maxHumans: MAX_PLAYERS,
      chainClasses: this.sanitizeChainClasses(req.settings?.chainClasses),
      routeId: typeof req.settings?.routeId === 'string' && req.settings.routeId.trim()
        ? req.settings.routeId.trim()
        : 'default',
      mode: this.sanitizeMode(req.settings?.mode),
      wager: this.sanitizeWager(req.settings?.wager),
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
        tokenIssuedAt: now,
        tokenExpiresAt: now + this.memberTokenTtlMs,
        name: this.sanitizeMemberName(req.hostName, 'Host'),
        isHost: true,
        slotIndex: req.spectatorHost ? -1 : 0,
        connected: true,
        pingMs: undefined,
        ready: true,
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
    this.pruneDisconnectedLobbyMembersInRoom(room, Date.now(), this.disconnectGraceMs);
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
      tokenIssuedAt: Date.now(),
      tokenExpiresAt: Date.now() + this.memberTokenTtlMs,
      name: this.sanitizeMemberName(name, `Player ${room.members.length + 1}`),
      isHost: false,
      slotIndex,
      connected: true,
      pingMs: undefined,
      ready: false,
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
      aiCount: Math.max(0, Math.min(MAX_PLAYERS, Math.round(settings.aiCount ?? room.settings.aiCount))),
      maxHumans: room.settings.maxHumans,
      chainClasses: this.sanitizeChainClasses(settings.chainClasses ?? room.settings.chainClasses),
      routeId: typeof settings.routeId === 'string' && settings.routeId.trim()
        ? settings.routeId.trim()
        : room.settings.routeId,
      mode: this.sanitizeMode(settings.mode ?? room.settings.mode),
      wager: this.sanitizeWager(settings.wager ?? room.settings.wager),
    };
    return this.toState(room);
  }

  setReady(roomId: string, memberId: string, token: string, ready: boolean): RoomState {
    const room = this.getInternalValidated(roomId, memberId, token);
    if (room.phase !== 'lobby') throw new Error('Cannot change ready status after start');
    const member = room.members.find(m => m.memberId === memberId);
    if (!member) throw new Error('Member not found');
    if (member.isHost) throw new Error('Host does not use ready status');
    member.ready = !!ready;
    return this.toState(room);
  }

  setMemberName(roomId: string, memberId: string, token: string, name: string): RoomState {
    const room = this.getInternalValidated(roomId, memberId, token);
    if (room.phase !== 'lobby') throw new Error('Cannot change name after race start');
    const member = room.members.find(m => m.memberId === memberId);
    if (!member) throw new Error('Member not found');
    member.name = this.sanitizeMemberName(name, member.name || 'Player');
    return this.toState(room);
  }

  startRace(
    roomId: string,
    memberId: string,
    token: string,
    routeLayout: RouteCustomLayout | null = null,
    routeId?: string,
  ): RoomState {
    const room = this.getInternalValidated(roomId, memberId, token);
    if (room.hostMemberId !== memberId) throw new Error('Only host can start');
    if (room.phase !== 'lobby') throw new Error('Race already started');
    const unready = room.members.filter(m => !m.isHost && m.slotIndex >= 0 && m.connected && !m.ready);
    if (unready.length > 0) throw new Error('All connected players must be ready');
    const simSlots = this.computeSimSlots(room);
    const sanitizedLayout = this.sanitizeRouteLayout(routeLayout);
    const rngState = createSimRandomState((this.hashString(room.roomId) ^ Date.now()) >>> 0);
    const simMainRoutePoints = buildSharedSimMainRoutePoints(sanitizedLayout as any);
    const simRoutePoints = buildSharedSimRoutePoints(sanitizedLayout as any, simMainRoutePoints);
    const simCheckpoints = buildSharedSimCheckpoints(simMainRoutePoints, 14, sanitizedLayout as any);
    const activePlayerCount = simSlots.filter(Boolean).length;
    const simItemBoxes = buildSharedSimItemBoxes(
      simMainRoutePoints,
      computeSharedRecommendedItemBoxCount(activePlayerCount, sanitizedLayout as any),
      () => rollSharedPreviewItem(() => nextSimRandom(rngState)),
      sanitizedLayout as any,
    );
    const players = this.createStartPlayers(simSlots, room.settings.laps, simMainRoutePoints, sanitizedLayout);
    room.phase = 'countdown';
    room.race = {
      startedAt: Date.now() + this.countdownMs,
      tick: 0,
      mode: this.sanitizeMode(room.settings.mode),
      playerInputs: Array.from({ length: room.settings.maxHumans }, () => null),
      routeId: routeId ?? room.settings.routeId ?? 'default',
      routeLayout: sanitizedLayout,
      standings: this.makeStandings(Array.from({ length: MAX_PLAYERS }, (_, i) => i), players),
      captureSatsByPlayer: new Array(MAX_PLAYERS).fill(0),
      satsRemaining: this.sanitizeMode(room.settings.mode) === 'capture_sats' ? simItemBoxes.length : 0,
      simSlots,
      simMainTrackPoints: simMainRoutePoints,
      simTrackPoints: simRoutePoints,
      simCheckpoints,
      itemBoxes: simItemBoxes,
      obstacles: [],
      finalLapIntensity: false,
      rngState,
      stealCooldownMs: Array.from({ length: MAX_PLAYERS }, () => new Array(MAX_PLAYERS).fill(0)),
      runtime: Array.from({ length: MAX_PLAYERS }, () => ({
        ...createDefaultRuntimeState(),
        sacrificeCooldownMs: 0,
        prevUseItemPressed: false,
        prevSacrificePressed: false,
      })),
      authoritative: {
        tick: 0,
        mode: this.sanitizeMode(room.settings.mode),
        players,
        itemBoxes: simItemBoxes.map(b => ({
          x: b.x,
          y: b.y,
          z: b.z,
          active: b.active,
          previewItem: b.previewItem,
        })),
        standings: this.makeStandings(Array.from({ length: MAX_PLAYERS }, (_, i) => i), players),
        captureSatsByPlayer: new Array(MAX_PLAYERS).fill(0),
        satsRemaining: this.sanitizeMode(room.settings.mode) === 'capture_sats' ? simItemBoxes.length : 0,
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

  kickMember(roomId: string, memberId: string, token: string, targetMemberId: string): RoomState {
    const room = this.getInternalValidated(roomId, memberId, token);
    if (room.hostMemberId !== memberId) throw new Error('Only host can kick');
    if (room.phase !== 'lobby') throw new Error('Cannot kick after race start');
    if (targetMemberId === room.hostMemberId) throw new Error('Host cannot be kicked');
    const before = room.members.length;
    room.members = room.members.filter(m => m.memberId !== targetMemberId);
    if (room.members.length === before) throw new Error('Member not found');
    return this.toState(room);
  }

  rematch(roomId: string, memberId: string, token: string): RoomState {
    const room = this.getInternalValidated(roomId, memberId, token);
    if (room.phase !== 'finished') throw new Error('Rematch available after finish');
    room.phase = 'lobby';
    room.race = undefined;
    for (const m of room.members) {
      m.ready = m.isHost;
    }
    return this.toState(room);
  }

  markDisconnected(roomId: string, memberId: string) {
    const room = this.rooms.get(roomId);
    if (!room) return;
    const m = room.members.find(x => x.memberId === memberId);
    if (m) {
      m.connected = false;
      m.pingMs = undefined;
      m.disconnectedAt = Date.now();
    }
  }

  markConnected(roomId: string, memberId: string) {
    const room = this.rooms.get(roomId);
    if (!room) return;
    const m = room.members.find(x => x.memberId === memberId);
    if (m) {
      m.connected = true;
      m.pingMs = undefined;
      m.disconnectedAt = undefined;
    }
  }

  setMemberPing(roomId: string, memberId: string, pingMs: number): RoomState | null {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    const member = room.members.find(m => m.memberId === memberId);
    if (!member) return null;
    member.pingMs = Math.max(0, Math.min(5000, Math.round(pingMs)));
    return this.toState(room);
  }

  pruneDisconnectedLobbyMembers(graceMs = this.disconnectGraceMs): string[] {
    const changedRoomIds: string[] = [];
    const now = Date.now();
    for (const [roomId, room] of this.rooms.entries()) {
      if (room.phase !== 'lobby') continue;
      if (this.pruneDisconnectedLobbyMembersInRoom(room, now, graceMs)) {
        changedRoomIds.push(roomId);
      }
    }
    return changedRoomIds;
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
    const raceShouldEnd = shouldSharedEndRace(
      activePlayers as Array<{ finished: boolean; eliminated: boolean }>,
      3,
      room.race.mode,
      room.race.tick * dtSec * 1000,
      room.race.mode === 'capture_sats' ? (room.race.satsRemaining ?? 0) : undefined,
    );
    room.race.standings = this.makeStandings(
      computeSharedPlacements(
        room.race.authoritative?.players ?? [],
        room.race.simCheckpoints.length || 14,
        room.race.mode,
        room.race.captureSatsByPlayer ?? [],
      ),
      room.race.authoritative?.players ?? [],
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

  setRaceSettlement(roomId: string, settlement: RoomSettlementSummary): RoomState | null {
    const room = this.rooms.get(roomId);
    if (!room?.race) return null;
    room.race.settlement = settlement;
    return this.toState(room);
  }

  getAuthoritativeSnapshot(roomId: string) {
    const room = this.rooms.get(roomId);
    if (!room?.race?.authoritative) return null;
    const auth = room.race.authoritative;
    return {
      tick: auth.tick,
      mode: auth.mode,
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
        survivors: auth.standings.survivors,
        eliminatedOrder: auth.standings.eliminatedOrder ? [...auth.standings.eliminatedOrder] : undefined,
      } : undefined,
      captureSatsByPlayer: auth.captureSatsByPlayer ? [...auth.captureSatsByPlayer] : undefined,
      satsRemaining: auth.satsRemaining,
      events: auth.events?.map(e => ({ ...e })),
      at: auth.at,
    };
  }

  validateMember(roomId: string, memberId: string, token: string): boolean {
    const room = this.rooms.get(roomId);
    if (!room) return false;
    const now = Date.now();
    const member = room.members.find(m => m.memberId === memberId && m.token === token);
    if (!member) return false;
    if (member.tokenExpiresAt <= now) return false;
    // Sliding expiry while actively connected/participating.
    member.tokenExpiresAt = now + this.memberTokenTtlMs;
    return true;
  }

  listSnapshots(): RuntimeSnapshot['rooms'] {
    return Array.from(this.rooms.values()).map((room) => ({
      roomId: room.roomId,
      code: room.code,
      hostMemberId: room.hostMemberId,
      phase: room.phase,
      createdAt: room.createdAt,
      settings: { ...room.settings },
      members: room.members.map((member) => ({ ...member })),
      chat: room.chat.map((message) => ({ ...message })),
      race: room.race ? JSON.parse(JSON.stringify(room.race)) : undefined,
    }));
  }

  restoreSnapshots(rawRooms: RuntimeSnapshot['rooms']) {
    this.rooms.clear();
    this.codeToRoomId.clear();
    for (const rawRoom of rawRooms) {
      if (!rawRoom || typeof rawRoom !== 'object') continue;
      const room = rawRoom as InternalRoom;
      if (!room.roomId || !room.code) continue;
      this.rooms.set(room.roomId, room);
      this.codeToRoomId.set(room.code, room.roomId);
      for (const member of room.members) {
        if (!Number.isFinite(member.tokenExpiresAt)) {
          member.tokenExpiresAt = Date.now() + this.memberTokenTtlMs;
        }
        if (!Number.isFinite(member.tokenIssuedAt)) {
          member.tokenIssuedAt = Date.now();
        }
      }
    }
  }

  private getInternalValidated(roomId: string, memberId: string, token: string): InternalRoom {
    const room = this.rooms.get(roomId);
    if (!room) throw new Error('Room not found');
    const ok = room.members.some(m => m.memberId === memberId && m.token === token);
    if (!ok) throw new Error('Unauthorized');
    return room;
  }

  private pruneDisconnectedLobbyMembersInRoom(room: InternalRoom, now: number, graceMs: number): boolean {
    if (room.phase !== 'lobby') return false;
    const before = room.members.length;
    room.members = room.members.filter(m => {
      if (m.connected) return true;
      if (!m.disconnectedAt) return true;
      return now - m.disconnectedAt < graceMs;
    });
    if (room.members.length === before) return false;

    if (room.members.length === 0) {
      this.rooms.delete(room.roomId);
      this.codeToRoomId.delete(room.code);
      return true;
    }

    if (!room.members.some(m => m.memberId === room.hostMemberId)) {
      room.hostMemberId = room.members[0].memberId;
      room.members[0].isHost = true;
    }
    return true;
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
        pingMs: m.pingMs,
        disconnectedAt: m.disconnectedAt,
        ready: m.ready,
        joinedAt: m.joinedAt,
      })),
      chat: [...room.chat],
      race: room.race ? {
        startedAt: room.race.startedAt,
        tick: room.race.tick,
        mode: room.race.mode,
        routeId: room.race.routeId,
        routeLayout: room.race.routeLayout ? {
          main: room.race.routeLayout.main.map(cp => ({ ...cp })),
          shortcut: room.race.routeLayout.shortcut?.map(cp => ({ ...cp })),
          layoutType: room.race.routeLayout.layoutType === 'arena' ? 'arena' : 'loop',
          arenaShape: room.race.routeLayout.arenaShape ?? 'circle',
          arenaRadiusX: room.race.routeLayout.arenaRadiusX,
          arenaRadiusZ: room.race.routeLayout.arenaRadiusZ,
          arenaFloorY: room.race.routeLayout.arenaFloorY,
          arenaWallHeight: room.race.routeLayout.arenaWallHeight,
          arenaObstacleDensity: room.race.routeLayout.arenaObstacleDensity,
          interiorObstacles: room.race.routeLayout.interiorObstacles?.map(o => ({ ...o })),
          showCenterpiece: room.race.routeLayout.showCenterpiece !== false,
        } : null,
        standings: room.race.standings ? {
          placementOrder: [...room.race.standings.placementOrder],
          rankByPlayer: [...room.race.standings.rankByPlayer],
          survivors: room.race.standings.survivors,
          eliminatedOrder: room.race.standings.eliminatedOrder ? [...room.race.standings.eliminatedOrder] : undefined,
        } : undefined,
        captureSatsByPlayer: [...(room.race.captureSatsByPlayer ?? new Array(MAX_PLAYERS).fill(0))],
        satsRemaining: room.race.satsRemaining ?? 0,
        settlement: room.race.settlement ? JSON.parse(JSON.stringify(room.race.settlement)) : undefined,
        finishedAt: room.race.finishedAt,
      } : undefined,
    };
  }

  private computeSimSlots(room: InternalRoom): boolean[] {
    const slots = new Array(MAX_PLAYERS).fill(false);
    for (const m of room.members) {
      if (m.slotIndex >= 0 && m.slotIndex < MAX_PLAYERS) slots[m.slotIndex] = true;
    }
    let aiLeft = Math.max(0, Math.min(MAX_PLAYERS, room.settings.aiCount));
    for (let i = 0; i < MAX_PLAYERS && aiLeft > 0; i++) {
      if (slots[i]) continue;
      slots[i] = true;
      aiLeft--;
    }
    return slots;
  }

  private createStartPlayers(
    simSlots: boolean[],
    totalLaps: number,
    simRoutePoints: SimRoutePoint[],
    layout: RouteCustomLayout | null,
  ) {
    const frame = buildSharedStartFrame(simRoutePoints, layout as any);
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
    for (let i = 0; i < MAX_PLAYERS; i++) {
      const slot = buildSharedStartSlotPose(simRoutePoints, i, undefined, layout as any);
      const qy = Math.sin(frame.heading * 0.5);
      const qw = Math.cos(frame.heading * 0.5);
      const active = !!simSlots[i] && totalLaps > 0;
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
        finished: false,
        finishTime: 0,
        eliminated: !active,
        chainLength: active ? this.startBlocks : 0,
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

    const simRoutePoints = room.race.simTrackPoints.length > 0 ? room.race.simTrackPoints : this.defaultSimRoutePoints;
    const simMainRoutePoints = room.race.simMainTrackPoints.length > 0 ? room.race.simMainTrackPoints : this.defaultSimMainRoutePoints;
    const simCheckpoints = room.race.simCheckpoints.length > 0 ? room.race.simCheckpoints : this.defaultSimCheckpoints;
    const rngState = room.race.rngState ?? (room.race.rngState = createSimRandomState((this.hashString(room.roomId) ^ Date.now()) >>> 0));
    const rng = () => nextSimRandom(rngState);
    const itemBoxes = room.race.itemBoxes ?? (room.race.itemBoxes = buildSharedSimItemBoxes(
      simMainRoutePoints,
      computeSharedRecommendedItemBoxCount(room.race.simSlots.filter(Boolean).length, room.race.routeLayout as any),
      () => rollSharedPreviewItem(rng),
      room.race.routeLayout as any,
    ));
    const obstacles = room.race.obstacles ?? (room.race.obstacles = []);
    if (!Array.isArray(room.race.captureSatsByPlayer) || room.race.captureSatsByPlayer.length !== MAX_PLAYERS) {
      room.race.captureSatsByPlayer = new Array(MAX_PLAYERS).fill(0);
    }
    if (!Number.isFinite(room.race.satsRemaining)) {
      room.race.satsRemaining = room.race.mode === 'capture_sats' ? itemBoxes.filter(b => b.active).length : 0;
    }
    room.race.finalLapIntensity = shouldEnableSharedFinalLapIntensity(players as Array<{ lap: number; finished: boolean; chainLength: number }>, room.settings.laps);
    const runtime = room.race.runtime ?? (room.race.runtime = Array.from({ length: MAX_PLAYERS }, () => ({
      ...createDefaultRuntimeState(),
      sacrificeCooldownMs: 0,
      prevUseItemPressed: false,
      prevSacrificePressed: false,
    })));
    const stealCooldownMs = room.race.stealCooldownMs ?? (room.race.stealCooldownMs = Array.from({ length: MAX_PLAYERS }, () => new Array(MAX_PLAYERS).fill(0)));
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
    if (room.race.mode !== 'capture_sats') {
      stepSharedItemBoxes(itemBoxes as any, dt, room.race.finalLapIntensity, rng);
    }
    stepSharedObstacles(obstacles as any, players as any, dt);

    for (let i = 0; i < players.length; i++) {
      if (!room.race.simSlots[i]) continue;
      const p = players[i];
      const rt = runtime[i];
      p.eliminated = p.chainLength <= 0;
      if (p.eliminated) {
        p.speed = 0;
        p.speedBoostActive = false;
        p.slowActive = false;
        rt.airborne = false;
        rt.vy = 0;
        rt.airborneElapsed = 0;
        rt.prevUseItemPressed = false;
        rt.prevSacrificePressed = false;
        continue;
      }
      const member = humanBySlot.get(i);
      const autoPilotInput = {
        ...getSharedAdvancedAiInput(
          p as { x: number; y: number; z: number; heading: number; speed: number; chainLength: number },
          simMainRoutePoints as any,
          rt,
          dt,
          room.race.mode,
          players as Array<{ x: number; y: number; z: number; finished: boolean; chainLength: number }>,
          i,
          rng,
          room.race.routeLayout?.layoutType === 'arena',
        ),
        useItem: false,
        lookBack: false,
        sacrificeBoost: false,
      };
      const input = (p.finished || !member) ? autoPilotInput : (room.race.playerInputs[i] ?? {
        forward: false, backward: false, left: false, right: false, drift: false, useItem: false, lookBack: false, sacrificeBoost: false,
      });
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
        useItem: !p.finished && !!input.useItem,
        sacrificeBoost: !p.finished && !!input.sacrificeBoost,
      }, rt);
      if (!p.finished && actionEdges.sacrificeJustPressed && trySharedSacrificeBoost(
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
      if (!p.finished && actionEdges.useItemJustPressed && p.heldItemId) {
        useSharedHeldItem(i, players as any, runtime as any, obstacles as any, room.race.finalLapIntensity, frameEvents, this.getModeMaxBlocks(room.race.mode));
      }
      if (!p.finished && !member && p.heldItemId && rt.aiItemCooldownMs <= 0 && shouldSharedAiUseItem(i, players as any, p.heldItemId as ItemId, room.race.mode, rng)) {
        useSharedHeldItem(i, players as any, runtime as any, obstacles as any, room.race.finalLapIntensity, frameEvents, this.getModeMaxBlocks(room.race.mode));
        rt.aiItemCooldownMs = 900 + rng() * 700;
      }

      // Match local competitive balancing by rank and chain size.
      const rank = Math.max(0, Math.min(3, positions[i] ?? 0));
      raceAssist[i] = getSharedRaceBalanceAssist(rank, p.chainLength, this.startBlocks);
    }

    const prevFinished = players.map(p => !!p.finished);
    const raceLayoutType = room.race.routeLayout?.layoutType === 'arena' ? 'arena' : 'loop';
    const step = stepRace(
      {
        tick: room.race.tick - 1,
        timeMs: Math.max(0, (room.race.tick - 1) * dt * 1000),
        totalLaps: room.settings.laps,
        layoutType: raceLayoutType,
        interiorObstacles: room.race.routeLayout?.interiorObstacles,
        routeMain: simMainRoutePoints,
        routeAll: simRoutePoints,
        checkpoints: simCheckpoints,
        players: players as any,
        runtime: runtime as any,
      },
      inputs,
      dt,
      raceAssist,
      room.race.mode,
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
      const picked = collectSharedNearbyItem(i, players as any, itemBoxes as any, room.race.finalLapIntensity, runtime as any);
      if (room.race.mode === 'capture_sats' && picked) {
        room.race.captureSatsByPlayer[i] = (room.race.captureSatsByPlayer[i] ?? 0) + 1;
        room.race.satsRemaining = Math.max(0, (room.race.satsRemaining ?? 0) - 1);
      }
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
        maxBlocks: this.getModeMaxBlocks(room.race.mode),
        cooldownMs: this.stealCooldownMsValue,
        segmentSpacing: this.segmentSpacing,
        headToBodyHitDistance: this.headToBodyHitDistance,
      },
    );
    for (const p of players) {
      p.eliminated = p.chainLength <= 0;
      if (p.eliminated) p.speed = 0;
    }
    room.race.standings = this.makeStandings(
      computeSharedPlacements(players, simCheckpoints.length, room.race.mode, room.race.captureSatsByPlayer ?? []),
      players,
    );
    room.race.authoritative.tick = room.race.tick;
    room.race.authoritative.mode = room.race.mode;
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
    room.race.authoritative.captureSatsByPlayer = [...(room.race.captureSatsByPlayer ?? new Array(MAX_PLAYERS).fill(0))];
    room.race.authoritative.satsRemaining = room.race.satsRemaining ?? 0;
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

  private makeStandings(
    placementOrder: number[],
    players?: Array<{ eliminated?: boolean }>,
  ): RaceStandings {
    const rankByPlayer = new Array(MAX_PLAYERS).fill(MAX_PLAYERS - 1);
    for (let place = 0; place < placementOrder.length && place < MAX_PLAYERS; place++) {
      const playerIndex = placementOrder[place] | 0;
      if (playerIndex >= 0 && playerIndex < MAX_PLAYERS) rankByPlayer[playerIndex] = place;
    }
    const eliminatedOrder = players
      ? placementOrder.filter(idx => players[idx]?.eliminated)
      : undefined;
    const survivors = players
      ? players.filter((p, idx) => !p?.eliminated && placementOrder.includes(idx)).length
      : undefined;
    return {
      placementOrder: placementOrder.slice(0, MAX_PLAYERS),
      rankByPlayer,
      survivors,
      eliminatedOrder,
    };
  }

  private sanitizeChainClasses(input: unknown): Array<'balanced' | 'light' | 'heavy'> {
    const out: Array<'balanced' | 'light' | 'heavy'> = Array.from({ length: MAX_PLAYERS }, () => 'balanced');
    if (!Array.isArray(input)) return out;
    for (let i = 0; i < MAX_PLAYERS; i++) {
      const v = input[i];
      out[i] = v === 'light' || v === 'heavy' ? v : 'balanced';
    }
    return out;
  }

  private sanitizeMode(input: unknown): GameMode {
    if (input === 'derby') return 'derby';
    if (input === 'capture_sats') return 'capture_sats';
    return 'classic';
  }

  private sanitizeWager(input: unknown): WagerSettings | undefined {
    if (!input || typeof input !== 'object') return undefined;
    const v = input as Partial<WagerSettings>;
    const enabled = !!v.enabled;
    const amountSat = Math.max(0, Math.min(5_000_000, Math.round(Number(v.amountSat) || 0)));
    const mode = v.mode === 'capture_sats' ? 'capture_sats' : 'for_keeps';
    const winnerCount = v.winnerCount === 2 || v.winnerCount === 3 ? v.winnerCount : 1;
    const rankWeightsRaw = Array.isArray(v.rankWeights) ? v.rankWeights : [];
    const rankWeights = rankWeightsRaw
      .map((n) => Number(n))
      .filter((n) => Number.isFinite(n) && n > 0)
      .slice(0, 3);
    const defaultWeights = winnerCount === 1 ? [1] : winnerCount === 2 ? [0.7, 0.3] : [0.6, 0.3, 0.1];
    return {
      enabled,
      practiceOnly: !!v.practiceOnly,
      amountSat,
      mode,
      winnerCount,
      rankWeights: rankWeights.length >= winnerCount ? rankWeights : defaultWeights,
    };
  }

  private sanitizeMemberName(input: unknown, fallback: string): string {
    const raw = typeof input === 'string' ? input : '';
    const trimmed = raw.trim().slice(0, 24);
    if (trimmed) return trimmed;
    return (fallback || 'Player').trim().slice(0, 24) || 'Player';
  }

  private getModeMaxBlocks(mode: GameMode): number {
    if (mode === 'derby') return 10;
    return this.defaultMaxBlocks;
  }

  private sanitizeRouteLayout(layout: RouteCustomLayout | null | undefined): RouteCustomLayout | null {
    if (!layout) return null;
    const layoutType: RouteLayoutType = layout.layoutType === 'arena' ? 'arena' : 'loop';
    const main = Array.isArray(layout.main)
      ? layout.main.map(cp => ({
        x: Number(cp.x) || 0,
        z: Number(cp.z) || 0,
        w: Math.max(4, Math.min(30, Number(cp.w) || 10)),
        e: Number(cp.e) || 0,
        ramp: !!cp.ramp,
        bridge: !!cp.bridge,
        noRails: !!cp.noRails,
        boost: !!cp.boost,
        loop: !!cp.loop,
        tunnel: !!cp.tunnel,
        tunnelWall: !!cp.tunnelWall,
        tunnelWallSide: (cp.tunnelWallSide === 'left' || cp.tunnelWallSide === 'right' ? cp.tunnelWallSide : 'bottom') as 'bottom' | 'left' | 'right',
      }))
      : [];
    if (layoutType === 'loop' && main.length < 4) return null;
    const shortcut = Array.isArray(layout.shortcut)
      ? layout.shortcut
        .filter(cp => Number.isFinite(cp.x) && Number.isFinite(cp.z) && Number.isFinite(cp.e))
        .map(cp => ({ x: Number(cp.x), z: Number(cp.z), e: Number(cp.e) }))
      : undefined;
    const interiorObstacles = Array.isArray(layout.interiorObstacles)
      ? layout.interiorObstacles
        .filter(o => Number.isFinite(o.x) && Number.isFinite(o.z))
        .map(o => ({
          x: Number(o.x),
          z: Number(o.z),
          radius: Math.max(1, Math.min(40, Number(o.radius) || 5)),
          height: Math.max(1.2, Math.min(30, Number(o.height) || 4)),
        }))
      : undefined;
    return {
      main,
      shortcut,
      layoutType,
      arenaShape: layout.arenaShape === 'rounded_rect' ? 'rounded_rect' : 'circle',
      arenaRadiusX: Math.max(24, Math.min(260, Number(layout.arenaRadiusX) || 84)),
      arenaRadiusZ: Math.max(24, Math.min(260, Number(layout.arenaRadiusZ) || 74)),
      arenaFloorY: Math.max(-10, Math.min(80, Number(layout.arenaFloorY) || 4)),
      arenaWallHeight: Math.max(2, Math.min(36, Number(layout.arenaWallHeight) || 7)),
      arenaObstacleDensity: Math.max(0, Math.min(1, Number(layout.arenaObstacleDensity) || 0)),
      interiorObstacles,
      showCenterpiece: layout.showCenterpiece !== false,
    };
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

