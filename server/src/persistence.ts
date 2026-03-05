import fs from 'node:fs';
import path from 'node:path';

const SNAPSHOT_VERSION = 1;

export interface SessionSnapshot {
  id: string;
  wagerAmount: number;
  idempotencyKey?: string;
  players: Array<{
    id: string;
    name: string;
    depositPaid: boolean;
    paymentHash?: string;
    invoiceBolt11?: string;
    lnurl?: string;
  }>;
  status: string;
  createdAt: number;
  winner?: string;
  payoutAmount?: number;
  payoutLnurl?: string | null;
  payoutCompleteAt?: number;
  events?: Array<{
    id: string;
    type: string;
    at: number;
    details?: Record<string, unknown>;
  }>;
}

export interface RuntimeSnapshot {
  version: number;
  savedAt: number;
  rooms: unknown[];
  sessions: SessionSnapshot[];
}

export class RuntimePersistence {
  private readonly filePath: string;
  private saveTimer: NodeJS.Timeout | null = null;
  private latestSnapshot: RuntimeSnapshot | null = null;
  private isSaving = false;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  load(): RuntimeSnapshot | null {
    if (!fs.existsSync(this.filePath)) {
      return null;
    }
    const raw = fs.readFileSync(this.filePath, 'utf8');
    if (!raw.trim()) {
      return null;
    }
    const parsed = JSON.parse(raw) as RuntimeSnapshot;
    if (!parsed || typeof parsed !== 'object') return null;
    if (!Array.isArray(parsed.rooms) || !Array.isArray(parsed.sessions)) return null;
    return {
      version: Number(parsed.version) || SNAPSHOT_VERSION,
      savedAt: Number(parsed.savedAt) || Date.now(),
      rooms: parsed.rooms,
      sessions: parsed.sessions,
    };
  }

  scheduleSave(snapshot: Omit<RuntimeSnapshot, 'version' | 'savedAt'>, delayMs = 300): void {
    this.latestSnapshot = {
      version: SNAPSHOT_VERSION,
      savedAt: Date.now(),
      rooms: snapshot.rooms,
      sessions: snapshot.sessions,
    };
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.flush();
    }, delayMs);
  }

  flush(): void {
    if (!this.latestSnapshot || this.isSaving) return;
    this.isSaving = true;
    try {
      const dir = path.dirname(this.filePath);
      fs.mkdirSync(dir, { recursive: true });
      const tmp = `${this.filePath}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.latestSnapshot, null, 2), 'utf8');
      fs.renameSync(tmp, this.filePath);
      this.latestSnapshot = null;
    } finally {
      this.isSaving = false;
    }
  }
}

