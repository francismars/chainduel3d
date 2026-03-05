import { EscrowManager } from './escrow.js';
import { SessionManager } from './session.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

class MockLnBits {
  invoiceCalls = 0;
  payoutCalls = 0;
  async createInvoice(amount: number, memo: string) {
    this.invoiceCalls += 1;
    return {
      paymentHash: `hash_${this.invoiceCalls}_${amount}`,
      bolt11: `bolt11_${memo.slice(0, 8)}_${this.invoiceCalls}`,
    };
  }
  async checkPayment(_paymentHash: string) {
    return true;
  }
  async createLnurlWithdraw(amount: number, memo: string) {
    this.payoutCalls += 1;
    return `lnurl_${amount}_${memo.slice(0, 8)}_${this.payoutCalls}`;
  }
}

async function run() {
  const sessions = new SessionManager();
  const mock = new MockLnBits();
  const escrow = new EscrowManager(mock as any, sessions);

  const session = sessions.create(100, ['Alice', 'Bob'], 'create-key-1');
  const first = await escrow.createDeposits(session.id);
  const second = await escrow.createDeposits(session.id);
  assert(first.player1.paymentHash === second.player1.paymentHash, 'Deposit calls should be idempotent');
  assert(mock.invoiceCalls === 2, 'Expected exactly two invoice calls');

  sessions.markPlayerPaid(session.id, first.player1.paymentHash);
  sessions.markPlayerPaid(session.id, first.player2.paymentHash);
  assert(sessions.get(session.id)?.status === 'deposits_confirmed', 'Expected deposits_confirmed status');

  const payout1 = await escrow.processWinnerPayout(session.id, 'player1');
  const payout2 = await escrow.processWinnerPayout(session.id, 'player1');
  assert(payout1.amount === payout2.amount, 'Payout amount should be stable across retries');
  assert(payout1.lnurl === payout2.lnurl, 'Payout LNURL should be reused for idempotent result');
  assert(mock.payoutCalls === 1, 'Expected one payout call for idempotent winner submit');
}

run().then(() => {
  console.log('[payment-contract] Contract checks passed.');
}).catch((err) => {
  console.error('[payment-contract] Failure:', err instanceof Error ? err.message : err);
  process.exit(1);
});

