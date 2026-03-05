export interface GameSession {
  id: string;
  wagerAmount: number;
  players: PlayerInfo[];
  status: SessionStatus;
  createdAt: number;
  winner?: string;
  payoutAmount?: number;
  payoutLnurl?: string | null;
  payoutCompleteAt?: number;
  events?: SessionEvent[];
}

export type PlayMode = 'local' | 'online';
export type GameMode = 'classic' | 'derby' | 'capture_sats';
export type ChainClass = 'balanced' | 'light' | 'heavy';
export type RoomId = string;
export type RoomCode = string;
export type RoomPhase = 'lobby' | 'countdown' | 'racing' | 'finished';
export type WagerMode = 'for_keeps' | 'capture_sats';

export interface WagerSettings {
  enabled: boolean;
  practiceOnly?: boolean;
  amountSat: number;
  mode: WagerMode;
  winnerCount: 1 | 2 | 3;
  rankWeights: number[];
}

export interface RoomSettings {
  laps: number;
  aiCount: number;
  maxHumans: number;
  chainClasses: ChainClass[];
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

export type RouteLayoutType = 'loop' | 'arena';
export type RouteArenaShape = 'circle' | 'rounded_rect';

export interface RouteArenaObstacle {
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

export interface RoomRaceState {
  startedAt: number;
  tick: number;
  routeId?: string;
  routeLayout?: RouteCustomLayout | null;
  mode?: GameMode;
  standings?: RaceStandings;
  captureSatsByPlayer?: number[];
  satsRemaining?: number;
  settlement?: RoomSettlementSummary;
  finishedAt?: number;
}

export interface RoomSettlementShare {
  memberId: string;
  slotIndex: number;
  playerName: string;
  amountSat: number;
  reason: 'rank' | 'capture';
}

export interface RoomSettlementSummary {
  roomId: string;
  mode: WagerMode;
  totalPotSat: number;
  feeSat: number;
  distributableSat: number;
  createdAt: number;
  shares: RoomSettlementShare[];
}

export interface RouteDefinition {
  id: string;
  name: string;
  layout: RouteCustomLayout | null;
  createdAt: number;
  updatedAt: number;
}

export interface RaceStandings {
  placementOrder: number[];
  rankByPlayer: number[];
  survivors?: number;
  eliminatedOrder?: number[];
}

export interface OnlinePlayerState {
  x: number;
  y: number;
  z: number;
  qx: number;
  qy: number;
  qz: number;
  qw: number;
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
}

export interface OnlineItemBoxState {
  x: number;
  y: number;
  z: number;
  active: boolean;
  previewItem: ItemId;
}

export interface OnlineObstacleState {
  x: number;
  y: number;
  z: number;
  lifetimeMs: number;
}

export interface OnlineRaceEvent {
  type: string;
  playerIndex: number;
  targetPlayerIndex?: number;
  itemId?: ItemId;
}

export interface RaceItemStats {
  playerIndex: number;
  pickups: number;
  uses: number;
  hitsLanded: number;
  hitsTaken: number;
  denied: number;
}

export interface OnlineRaceSnapshot {
  tick: number;
  players: OnlinePlayerState[];
  itemBoxes?: OnlineItemBoxState[];
  obstacles?: OnlineObstacleState[];
  mode?: GameMode;
  standings?: RaceStandings;
  captureSatsByPlayer?: number[];
  satsRemaining?: number;
  events?: OnlineRaceEvent[];
  at: number;
}

export interface RoomState {
  roomId: RoomId;
  code: RoomCode;
  hostMemberId: string;
  phase: RoomPhase;
  createdAt: number;
  settings: RoomSettings;
  members: RoomMember[];
  chat: ChatMessage[];
  race?: RoomRaceState;
}

export interface CreateRoomRequest {
  hostName: string;
  settings: RoomSettings;
  spectatorHost?: boolean;
}

export interface CreateRoomResponse {
  room: RoomState;
  memberId: string;
  memberToken: string;
}

export interface JoinRoomRequest {
  code: RoomCode;
  name: string;
}

export interface JoinRoomResponse {
  room: RoomState;
  memberId: string;
  memberToken: string;
}

export interface PatchRoomSettingsRequest {
  memberId: string;
  memberToken: string;
  settings: Partial<RoomSettings>;
}

export interface StartRoomRequest {
  memberId: string;
  memberToken: string;
  routeId?: string;
  routeLayout?: RouteCustomLayout | null;
}

export interface LeaveRoomRequest {
  memberId: string;
  memberToken: string;
}

export interface KickRoomMemberRequest {
  memberId: string;
  memberToken: string;
  targetMemberId: string;
}

export interface SetReadyRequest {
  memberId: string;
  memberToken: string;
  ready: boolean;
}

export interface SetRoomNameRequest {
  memberId: string;
  memberToken: string;
  name: string;
}

export type RoomClientMessage =
  | { type: 'room_subscribe'; roomId: string; memberId: string; memberToken: string }
  | { type: 'room_chat_send'; roomId: string; memberId: string; memberToken: string; text: string }
  | { type: 'room_leave'; roomId: string; memberId: string; memberToken: string }
  | { type: 'race_input'; roomId: string; memberId: string; memberToken: string; input: OnlineRaceInput }
  | { type: 'room_pong'; sentAt: number }
  | { type: 'subscribe'; sessionId: string };

export type RoomServerMessage =
  | { type: 'room_state'; room: RoomState }
  | { type: 'chat_message'; roomId: string; message: ChatMessage }
  | { type: 'race_snapshot'; roomId: string; snapshot: OnlineRaceSnapshot }
  | { type: 'room_ping'; sentAt: number }
  | { type: 'room_member_ping'; roomId: string; memberId: string; pingMs: number }
  | { type: 'error'; message: string }
  | { type: 'session_update'; session: GameSession };

export interface PlayerInfo {
  id: string;
  name: string;
  depositPaid: boolean;
  paymentHash?: string;
  invoiceBolt11?: string;
  lnurl?: string;
}

export type SessionStatus =
  | 'waiting_for_players'
  | 'waiting_for_deposits'
  | 'deposits_confirmed'
  | 'racing'
  | 'finished'
  | 'payout_complete'
  | 'cancelled';

export interface CreateSessionRequest {
  wagerAmount: number;
  playerNames: [string, string];
}

export interface CreateSessionResponse {
  sessionId: string;
  invoices: {
    player1: { bolt11: string; paymentHash: string };
    player2: { bolt11: string; paymentHash: string };
  };
}

export interface SessionStatusResponse {
  session: GameSession;
}

export interface RaceResultRequest {
  sessionId: string;
  winnerId: string;
}

export interface PayoutResponse {
  lnurl: string | null;
  amount: number;
}

export interface ClaimPayoutResponse {
  lnurl: string | null;
  amount: number;
  claimToken: string;
}

export interface SessionEvent {
  id: string;
  type: string;
  at: number;
  details?: Record<string, unknown>;
}

export type ItemId =
  | 'ln_turbo'
  | 'mempool_mine'
  | 'fee_spike'
  | 'sats_siphon'
  | 'nostr_zap';

export interface ItemType {
  id: ItemId;
  name: string;
  description: string;
  duration?: number;
}

export const ITEMS: Record<string, ItemType> = {
  ln_turbo: {
    id: 'ln_turbo',
    name: 'Lightning Turbo',
    description: 'Fast LN burst speed boost',
    duration: 2200,
  },
  mempool_mine: {
    id: 'mempool_mine',
    name: 'Mempool Mine',
    description: 'Drop on-chain hazard behind you',
  },
  fee_spike: {
    id: 'fee_spike',
    name: 'Fee Spike',
    description: 'Slow the nearest racer',
    duration: 2400,
  },
  sats_siphon: {
    id: 'sats_siphon',
    name: 'Sats Siphon',
    description: 'Steal one chain block from nearest rival',
  },
  nostr_zap: {
    id: 'nostr_zap',
    name: 'Nostr Zapwave',
    description: 'Zap nearby rivals with a short slow pulse',
    duration: 1600,
  },
};

export const GAME_CONFIG = {
  TOTAL_LAPS: 3,
  MAX_PLAYERS: 8,
  COUNTDOWN_SECONDS: 3,
  REVENUE_SPLIT_PERCENT: 5,
  MIN_WAGER: 100,
  MAX_WAGER: 1_000_000,
} as const;
