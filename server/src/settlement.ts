import crypto from 'node:crypto';
import type { RoomState, RoomSettlementShare, RoomSettlementSummary } from '../../shared/types.js';
import { LNBitsClient } from './lnbits.js';

interface ClaimTicket {
  token: string;
  roomId: string;
  memberId: string;
  amountSat: number;
  expiresAt: number;
  used: boolean;
}

interface SettlementRecord {
  summary: RoomSettlementSummary;
  claimedMemberIds: Set<string>;
}

export class SettlementManager {
  private readonly lnbits: LNBitsClient;
  private readonly feePercent: number;
  private readonly settlements = new Map<string, SettlementRecord>();
  private readonly claimTickets = new Map<string, ClaimTicket>();

  constructor(lnbits: LNBitsClient, feePercent = Number(process.env.REVENUE_SPLIT_PERCENT || 5)) {
    this.lnbits = lnbits;
    this.feePercent = Number.isFinite(feePercent) ? Math.max(0, Math.min(99, Math.round(feePercent))) : 5;
  }

  ensureSettlement(room: RoomState): RoomSettlementSummary | null {
    if (room.phase !== 'finished' || !room.race) return null;
    const wager = room.settings.wager;
    if (!wager?.enabled || wager.practiceOnly || wager.amountSat <= 0) return null;
    const existing = this.settlements.get(room.roomId);
    if (existing) return existing.summary;
    const activeMembers = room.members.filter(m => m.slotIndex >= 0);
    if (activeMembers.length === 0) return null;
    const totalPotSat = wager.amountSat * activeMembers.length;
    const feeSat = Math.floor(totalPotSat * this.feePercent / 100);
    const distributableSat = Math.max(0, totalPotSat - feeSat);
    const shares = wager.mode === 'capture_sats'
      ? this.buildCaptureShares(room, distributableSat)
      : this.buildRankShares(room, distributableSat);
    const summary: RoomSettlementSummary = {
      roomId: room.roomId,
      mode: wager.mode,
      totalPotSat,
      feeSat,
      distributableSat,
      createdAt: Date.now(),
      shares,
    };
    this.settlements.set(room.roomId, { summary, claimedMemberIds: new Set() });
    return summary;
  }

  getSettlement(roomId: string): RoomSettlementSummary | null {
    return this.settlements.get(roomId)?.summary ?? null;
  }

  issueClaimTicket(roomId: string, memberId: string): { claimToken: string; amountSat: number } | null {
    const record = this.settlements.get(roomId);
    if (!record) return null;
    if (record.claimedMemberIds.has(memberId)) return null;
    const share = record.summary.shares.find(s => s.memberId === memberId && s.amountSat > 0);
    if (!share) return null;
    const claimToken = crypto.randomBytes(24).toString('hex');
    this.claimTickets.set(claimToken, {
      token: claimToken,
      roomId,
      memberId,
      amountSat: share.amountSat,
      expiresAt: Date.now() + 10 * 60 * 1000,
      used: false,
    });
    return { claimToken, amountSat: share.amountSat };
  }

  async redeemClaimTicket(claimToken: string, memberId: string): Promise<{ lnurl: string; amount: number }> {
    const ticket = this.claimTickets.get(claimToken);
    if (!ticket) throw new Error('Claim token invalid');
    if (ticket.used) throw new Error('Claim token already used');
    if (ticket.memberId !== memberId) throw new Error('Claim token owner mismatch');
    if (ticket.expiresAt <= Date.now()) throw new Error('Claim token expired');
    const record = this.settlements.get(ticket.roomId);
    if (!record) throw new Error('Settlement missing');
    if (record.claimedMemberIds.has(memberId)) throw new Error('Already claimed');

    const lnurl = await this.lnbits.createLnurlWithdraw(
      ticket.amountSat,
      `CHAINDUEL3D winnings ${ticket.roomId.slice(0, 8)}`
    );
    ticket.used = true;
    record.claimedMemberIds.add(memberId);
    return { lnurl, amount: ticket.amountSat };
  }

  private buildRankShares(room: RoomState, distributableSat: number): RoomSettlementShare[] {
    const wager = room.settings.wager!;
    const standings = room.race?.standings?.placementOrder ?? [];
    const winnerCount = Math.max(1, Math.min(3, wager.winnerCount | 0));
    const top = standings.slice(0, winnerCount);
    const weights = this.normalizeWeights(wager.rankWeights, winnerCount);
    const membersBySlot = new Map(room.members.filter(m => m.slotIndex >= 0).map(m => [m.slotIndex, m] as const));
    const payoutSlots = top.filter((slot) => membersBySlot.has(slot));
    const shares: RoomSettlementShare[] = [];
    let allocated = 0;
    for (let i = 0; i < payoutSlots.length; i++) {
      const slotIndex = payoutSlots[i];
      const member = membersBySlot.get(slotIndex)!;
      const base = i === payoutSlots.length - 1
        ? distributableSat - allocated
        : Math.floor(distributableSat * (weights[i] ?? 0));
      const amountSat = Math.max(0, base);
      allocated += amountSat;
      shares.push({
        memberId: member.memberId,
        slotIndex,
        playerName: member.name,
        amountSat,
        reason: 'rank',
      });
    }
    return shares;
  }

  private buildCaptureShares(room: RoomState, distributableSat: number): RoomSettlementShare[] {
    const captured = room.race?.captureSatsByPlayer ?? [];
    const members = room.members.filter(m => m.slotIndex >= 0);
    const totalCaptured = members.reduce((sum, m) => sum + Math.max(0, captured[m.slotIndex] ?? 0), 0);
    if (members.length === 0 || distributableSat <= 0) return [];
    const denom = totalCaptured > 0 ? totalCaptured : members.length;
    const shares: RoomSettlementShare[] = [];
    let allocated = 0;
    for (let i = 0; i < members.length; i++) {
      const m = members[i];
      const weight = totalCaptured > 0 ? Math.max(0, captured[m.slotIndex] ?? 0) : 1;
      const amountSat = i === members.length - 1
        ? distributableSat - allocated
        : Math.floor(distributableSat * (weight / denom));
      allocated += Math.max(0, amountSat);
      shares.push({
        memberId: m.memberId,
        slotIndex: m.slotIndex,
        playerName: m.name,
        amountSat: Math.max(0, amountSat),
        reason: 'capture',
      });
    }
    return shares;
  }

  private normalizeWeights(input: number[], count: number): number[] {
    const fallback = count === 1 ? [1] : count === 2 ? [0.7, 0.3] : [0.6, 0.3, 0.1];
    const seed = input.slice(0, count).map((n) => Number(n)).filter((n) => Number.isFinite(n) && n > 0);
    const values = seed.length === count ? seed : fallback.slice(0, count);
    const sum = values.reduce((a, b) => a + b, 0) || 1;
    return values.map(v => v / sum);
  }
}

