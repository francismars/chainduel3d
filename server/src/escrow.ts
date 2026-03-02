import { LNBitsClient } from './lnbits';
import { SessionManager } from './session';
const GAME_CONFIG = {
  REVENUE_SPLIT_PERCENT: 5,
} as const;

export class EscrowManager {
  private lnbits: LNBitsClient;
  private sessions: SessionManager;
  private pollIntervals = new Map<string, NodeJS.Timer>();

  constructor(lnbits: LNBitsClient, sessions: SessionManager) {
    this.lnbits = lnbits;
    this.sessions = sessions;
  }

  async createDeposits(sessionId: string): Promise<{
    player1: { bolt11: string; paymentHash: string };
    player2: { bolt11: string; paymentHash: string };
  }> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error('Session not found');

    const results: { bolt11: string; paymentHash: string }[] = [];

    for (let i = 0; i < 2; i++) {
      const invoice = await this.lnbits.createInvoice(
        session.wagerAmount,
        `CHAINDUEL3D deposit - ${session.players[i].name} - Session ${sessionId.slice(0, 8)}`
      );
      this.sessions.updatePlayerPayment(sessionId, i, invoice.paymentHash, invoice.bolt11);
      results.push({ bolt11: invoice.bolt11, paymentHash: invoice.paymentHash });
    }

    this.startPaymentPolling(sessionId);

    return { player1: results[0], player2: results[1] };
  }

  private startPaymentPolling(sessionId: string) {
    const interval = setInterval(async () => {
      const session = this.sessions.get(sessionId);
      if (!session || session.status === 'deposits_confirmed' || session.status === 'cancelled') {
        clearInterval(interval as unknown as number);
        this.pollIntervals.delete(sessionId);
        return;
      }

      for (const player of session.players) {
        if (player.depositPaid || !player.paymentHash) continue;
        try {
          const paid = await this.lnbits.checkPayment(player.paymentHash);
          if (paid) {
            this.sessions.markPlayerPaid(sessionId, player.paymentHash);
          }
        } catch { /* ignore polling errors */ }
      }
    }, 3000);

    this.pollIntervals.set(sessionId, interval);
  }

  async processWinnerPayout(sessionId: string, winnerId: string): Promise<{ lnurl: string; amount: number }> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error('Session not found');

    const totalPot = session.wagerAmount * 2;
    const revenueCut = Math.floor(totalPot * GAME_CONFIG.REVENUE_SPLIT_PERCENT / 100);
    const winnerAmount = totalPot - revenueCut;

    this.sessions.setWinner(sessionId, winnerId);

    try {
      const lnurl = await this.lnbits.createLnurlWithdraw(
        winnerAmount,
        `CHAINDUEL3D winnings - Session ${sessionId.slice(0, 8)}`
      );

      this.sessions.setStatus(sessionId, 'payout_complete');

      return { lnurl, amount: winnerAmount };
    } catch (err) {
      console.error('Failed to create withdrawal link:', err);
      throw new Error('Payout creation failed');
    }
  }
}
