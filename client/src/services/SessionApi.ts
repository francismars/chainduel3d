import type { CreateSessionResponse, PayoutResponse } from 'shared/types';

function makeIdempotencyKey(prefix: string, entropy: string): string {
  return `${prefix}:${entropy}:${Date.now()}`;
}

export class SessionApi {
  async createSession(wagerAmount: number, playerNames: string[]): Promise<CreateSessionResponse> {
    const response = await fetch('/api/sessions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-idempotency-key': makeIdempotencyKey('session-create', playerNames.join('|')),
      },
      body: JSON.stringify({ wagerAmount, playerNames }),
    });
    if (!response.ok) {
      throw new Error('Failed to create session');
    }
    return response.json() as Promise<CreateSessionResponse>;
  }

  async submitResult(sessionId: string, winnerId: string): Promise<PayoutResponse> {
    const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/result`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-idempotency-key': makeIdempotencyKey('session-result', `${sessionId}:${winnerId}`),
      },
      body: JSON.stringify({ winnerId }),
    });
    if (!response.ok) {
      throw new Error('Failed to submit result');
    }
    return response.json() as Promise<PayoutResponse>;
  }
}

