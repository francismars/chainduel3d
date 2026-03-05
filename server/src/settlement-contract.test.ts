import type { RoomState } from '../../shared/types.js';
import { SettlementManager } from './settlement.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

class MockLnBits {
  withdrawCalls = 0;
  async createLnurlWithdraw(amount: number, memo: string) {
    this.withdrawCalls += 1;
    return `lnurl_${amount}_${memo.slice(0, 8)}_${this.withdrawCalls}`;
  }
}

function makeRoom(mode: 'for_keeps' | 'capture_sats'): RoomState {
  return {
    roomId: 'room-1',
    code: 'ABC123',
    hostMemberId: 'm1',
    phase: 'finished',
    createdAt: Date.now() - 10_000,
    settings: {
      laps: 3,
      aiCount: 0,
      maxHumans: 8,
      chainClasses: ['balanced', 'balanced', 'balanced', 'balanced', 'balanced', 'balanced', 'balanced', 'balanced'],
      routeId: 'default',
      mode: mode === 'capture_sats' ? 'capture_sats' : 'classic',
      wager: {
        enabled: true,
        amountSat: 1000,
        mode,
        winnerCount: 3,
        rankWeights: [0.6, 0.3, 0.1],
      },
    },
    members: [
      { memberId: 'm1', name: 'Alice', isHost: true, slotIndex: 0, connected: true, ready: true, joinedAt: Date.now() - 10_000 },
      { memberId: 'm2', name: 'Bob', isHost: false, slotIndex: 1, connected: true, ready: true, joinedAt: Date.now() - 9000 },
      { memberId: 'm3', name: 'Cara', isHost: false, slotIndex: 2, connected: true, ready: true, joinedAt: Date.now() - 8000 },
    ],
    chat: [],
    race: {
      startedAt: Date.now() - 7000,
      tick: 200,
      mode: mode === 'capture_sats' ? 'capture_sats' : 'classic',
      standings: {
        placementOrder: [0, 1, 2],
        rankByPlayer: [0, 1, 2, 3, 4, 5, 6, 7],
      },
      captureSatsByPlayer: [6, 3, 1, 0, 0, 0, 0, 0],
      satsRemaining: 0,
      finishedAt: Date.now() - 1000,
    },
  };
}

async function run() {
  const manager = new SettlementManager(new MockLnBits() as any, 0);

  const rankRoom = makeRoom('for_keeps');
  const rankSettlement = manager.ensureSettlement(rankRoom);
  assert(rankSettlement, 'Expected rank settlement');
  assert(rankSettlement.shares.length === 3, 'Expected top-3 shares');
  assert(rankSettlement.shares[0].amountSat === 1800, 'Expected 60% share');
  assert(rankSettlement.shares[1].amountSat === 900, 'Expected 30% share');
  assert(rankSettlement.shares[2].amountSat === 300, 'Expected 10% share');

  const captureRoom = makeRoom('capture_sats');
  captureRoom.roomId = 'room-2';
  const captureSettlement = manager.ensureSettlement(captureRoom);
  assert(captureSettlement, 'Expected capture settlement');
  assert(captureSettlement.shares[0].amountSat === 1800, 'Expected capture share A');
  assert(captureSettlement.shares[1].amountSat === 900, 'Expected capture share B');
  assert(captureSettlement.shares[2].amountSat === 300, 'Expected capture share C');

  const claim = manager.issueClaimTicket(rankRoom.roomId, 'm1');
  assert(claim?.amountSat === 1800, 'Expected claim amount');
  const payout = await manager.redeemClaimTicket(claim!.claimToken, 'm1');
  assert(payout.amount === 1800, 'Expected payout amount');
}

run().then(() => {
  console.log('[settlement-contract] Contract checks passed.');
}).catch((err) => {
  console.error('[settlement-contract] Failure:', err instanceof Error ? err.message : err);
  process.exit(1);
});

