import { v4 as uuidv4 } from 'uuid';
export interface GameSession {
  id: string;
  wagerAmount: number;
  players: PlayerInfo[];
  status: SessionStatus;
  createdAt: number;
  winner?: string;
}

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

export class SessionManager {
  private sessions = new Map<string, GameSession>();

  create(wagerAmount: number, playerNames: [string, string]): GameSession {
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
    };

    this.sessions.set(id, session);

    // Auto-cleanup after 30 minutes
    setTimeout(() => {
      const s = this.sessions.get(id);
      if (s && s.status !== 'payout_complete') {
        s.status = 'cancelled';
        this.sessions.delete(id);
      }
    }, 30 * 60 * 1000);

    return session;
  }

  get(id: string): GameSession | undefined {
    return this.sessions.get(id);
  }

  updatePlayerPayment(sessionId: string, playerIndex: number, paymentHash: string, bolt11: string) {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    session.players[playerIndex].paymentHash = paymentHash;
    session.players[playerIndex].invoiceBolt11 = bolt11;
  }

  markPlayerPaid(sessionId: string, paymentHash: string) {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    const player = session.players.find(p => p.paymentHash === paymentHash);
    if (player) {
      player.depositPaid = true;
    }

    if (session.players.every(p => p.depositPaid)) {
      session.status = 'deposits_confirmed';
    }
  }

  setStatus(sessionId: string, status: SessionStatus) {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.status = status;
    }
  }

  setWinner(sessionId: string, winnerId: string) {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.winner = winnerId;
      session.status = 'finished';
    }
  }

  remove(sessionId: string) {
    this.sessions.delete(sessionId);
  }
}
