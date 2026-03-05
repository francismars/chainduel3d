import { v4 as uuidv4 } from 'uuid';
import type { SessionSnapshot } from './persistence.js';
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
  idempotencyKey?: string;
  events: SessionEvent[];
}

export interface PlayerInfo {
  id: string;
  name: string;
  depositPaid: boolean;
  paymentHash?: string;
  invoiceBolt11?: string;
  lnurl?: string;
}

export interface SessionEvent {
  id: string;
  type: string;
  at: number;
  details?: Record<string, unknown>;
}

export type SessionStatus =
  | 'waiting_for_players'
  | 'waiting_for_deposits'
  | 'deposits_confirmed'
  | 'racing'
  | 'finished'
  | 'payout_complete'
  | 'cancelled';

export class SessionManager {
  private sessions = new Map<string, GameSession>();
  private createByIdempotencyKey = new Map<string, string>();
  private settleByIdempotencyKey = new Map<string, string>();
  private readonly cleanupTimers = new Map<string, NodeJS.Timeout>();

  create(wagerAmount: number, playerNames: [string, string], idempotencyKey?: string): GameSession {
    if (idempotencyKey) {
      const existingId = this.createByIdempotencyKey.get(idempotencyKey);
      if (existingId) {
        const existing = this.sessions.get(existingId);
        if (existing) return existing;
      }
    }
    const id = uuidv4();
    const session: GameSession = {
      id,
      wagerAmount,
      players: playerNames.map((name, i) => ({
        id: `player${i + 1}`,
        name,
        depositPaid: false,
      })) as PlayerInfo[],
      status: 'waiting_for_deposits',
      createdAt: Date.now(),
      idempotencyKey,
      events: [],
    };

    this.sessions.set(id, session);
    if (idempotencyKey) {
      this.createByIdempotencyKey.set(idempotencyKey, id);
    }
    this.appendEvent(id, 'session_created', { wagerAmount, players: playerNames });
    this.scheduleAutoCleanup(id);
    return session;
  }

  getOrCreate(wagerAmount: number, playerNames: [string, string], idempotencyKey?: string): GameSession {
    return this.create(wagerAmount, playerNames, idempotencyKey);
  }

  recordResultIdempotency(sessionId: string, idempotencyKey?: string): string | null {
    if (!idempotencyKey) return null;
    const knownSession = this.settleByIdempotencyKey.get(idempotencyKey);
    if (!knownSession) {
      this.settleByIdempotencyKey.set(idempotencyKey, sessionId);
      return null;
    }
    return knownSession;
  }

  get(id: string): GameSession | undefined {
    return this.sessions.get(id);
  }

  updatePlayerPayment(sessionId: string, playerIndex: number, paymentHash: string, bolt11: string) {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    session.players[playerIndex].paymentHash = paymentHash;
    session.players[playerIndex].invoiceBolt11 = bolt11;
    this.appendEvent(sessionId, 'deposit_invoice_created', {
      playerIndex,
      paymentHash,
    });
  }

  markPlayerPaid(sessionId: string, paymentHash: string) {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    const player = session.players.find(p => p.paymentHash === paymentHash);
    if (player) {
      player.depositPaid = true;
      this.appendEvent(sessionId, 'deposit_confirmed', { playerId: player.id, paymentHash });
    }

    if (session.players.every(p => p.depositPaid)) {
      session.status = 'deposits_confirmed';
      this.appendEvent(sessionId, 'all_deposits_confirmed');
    }
  }

  setStatus(sessionId: string, status: SessionStatus) {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.status = status;
      this.appendEvent(sessionId, 'status_changed', { status });
    }
  }

  setWinner(sessionId: string, winnerId: string) {
    const session = this.sessions.get(sessionId);
    if (session) {
      if (session.winner && session.winner === winnerId) return;
      session.winner = winnerId;
      session.status = 'finished';
      this.appendEvent(sessionId, 'winner_set', { winnerId });
    }
  }

  setPayoutResult(sessionId: string, amount: number, lnurl: string | null) {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.payoutAmount = amount;
    session.payoutLnurl = lnurl;
    session.payoutCompleteAt = Date.now();
    session.status = 'payout_complete';
    this.appendEvent(sessionId, 'payout_complete', { amount, lnurl });
  }

  getSettleSessionForKey(idempotencyKey?: string): GameSession | undefined {
    if (!idempotencyKey) return undefined;
    const sessionId = this.settleByIdempotencyKey.get(idempotencyKey);
    if (!sessionId) return undefined;
    return this.sessions.get(sessionId);
  }

  listSnapshots(): SessionSnapshot[] {
    return Array.from(this.sessions.values()).map((session) => ({
      id: session.id,
      wagerAmount: session.wagerAmount,
      idempotencyKey: session.idempotencyKey,
      players: session.players.map((p) => ({ ...p })),
      status: session.status,
      createdAt: session.createdAt,
      winner: session.winner,
      payoutAmount: session.payoutAmount,
      payoutLnurl: session.payoutLnurl,
      payoutCompleteAt: session.payoutCompleteAt,
      events: session.events.map((event) => ({ ...event })),
    }));
  }

  restoreSnapshots(snapshots: SessionSnapshot[]) {
    for (const timer of this.cleanupTimers.values()) clearTimeout(timer);
    this.cleanupTimers.clear();
    this.sessions.clear();
    this.createByIdempotencyKey.clear();
    this.settleByIdempotencyKey.clear();
    for (const snapshot of snapshots) {
      const session: GameSession = {
        id: snapshot.id,
        wagerAmount: snapshot.wagerAmount,
        idempotencyKey: snapshot.idempotencyKey,
        players: Array.isArray(snapshot.players) ? snapshot.players.map((p) => ({ ...p })) : [],
        status: (snapshot.status as SessionStatus) ?? 'cancelled',
        createdAt: snapshot.createdAt,
        winner: snapshot.winner,
        payoutAmount: snapshot.payoutAmount,
        payoutLnurl: snapshot.payoutLnurl ?? null,
        payoutCompleteAt: snapshot.payoutCompleteAt,
        events: Array.isArray(snapshot.events) ? snapshot.events.map((e) => ({ ...e })) : [],
      };
      this.sessions.set(session.id, session);
      if (session.idempotencyKey) this.createByIdempotencyKey.set(session.idempotencyKey, session.id);
      if (session.events.some((event) => event.type === 'winner_set')) {
        // best-effort backfill for idempotent settle requests without explicit key
        this.settleByIdempotencyKey.set(`session:${session.id}`, session.id);
      }
      this.scheduleAutoCleanup(session.id);
    }
  }

  remove(sessionId: string) {
    this.sessions.delete(sessionId);
    const timer = this.cleanupTimers.get(sessionId);
    if (timer) {
      clearTimeout(timer);
      this.cleanupTimers.delete(sessionId);
    }
  }

  private appendEvent(sessionId: string, type: string, details?: Record<string, unknown>) {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.events.push({
      id: uuidv4(),
      type,
      at: Date.now(),
      details,
    });
    if (session.events.length > 200) {
      session.events.shift();
    }
  }

  private scheduleAutoCleanup(sessionId: string) {
    const existing = this.cleanupTimers.get(sessionId);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      const s = this.sessions.get(sessionId);
      if (s && s.status !== 'payout_complete') {
        s.status = 'cancelled';
        this.appendEvent(sessionId, 'session_cancelled_cleanup');
        this.sessions.delete(sessionId);
      }
      this.cleanupTimers.delete(sessionId);
    }, 30 * 60 * 1000);
    timer.unref?.();
    this.cleanupTimers.set(sessionId, timer);
  }
}
