type CounterMap = Map<string, number>;

interface TimingBucket {
  count: number;
  totalMs: number;
  maxMs: number;
}

export class Observability {
  private readonly counters: CounterMap = new Map();
  private readonly timings: Map<string, TimingBucket> = new Map();
  private readonly startedAt = Date.now();

  increment(metric: string, value = 1): void {
    const current = this.counters.get(metric) ?? 0;
    this.counters.set(metric, current + value);
  }

  timing(metric: string, durationMs: number): void {
    const bounded = Number.isFinite(durationMs) ? Math.max(0, durationMs) : 0;
    const existing = this.timings.get(metric) ?? { count: 0, totalMs: 0, maxMs: 0 };
    existing.count += 1;
    existing.totalMs += bounded;
    existing.maxMs = Math.max(existing.maxMs, bounded);
    this.timings.set(metric, existing);
  }

  log(event: string, details: Record<string, unknown> = {}): void {
    const payload = {
      ts: new Date().toISOString(),
      event,
      ...details,
    };
    console.log(JSON.stringify(payload));
  }

  snapshot(): {
    uptimeSec: number;
    counters: Record<string, number>;
    timings: Record<string, { count: number; avgMs: number; maxMs: number }>;
  } {
    const counters = Object.fromEntries(this.counters.entries());
    const timings: Record<string, { count: number; avgMs: number; maxMs: number }> = {};
    for (const [metric, value] of this.timings.entries()) {
      timings[metric] = {
        count: value.count,
        avgMs: value.count > 0 ? Number((value.totalMs / value.count).toFixed(2)) : 0,
        maxMs: Number(value.maxMs.toFixed(2)),
      };
    }
    return {
      uptimeSec: Math.floor((Date.now() - this.startedAt) / 1000),
      counters,
      timings,
    };
  }

  middleware() {
    return (req: { method: string; path: string }, res: { on: (name: string, cb: () => void) => void; statusCode: number }, next: () => void) => {
      const started = Date.now();
      this.increment('http.requests.total');
      res.on('finish', () => {
        const ms = Date.now() - started;
        this.timing('http.requests.duration_ms', ms);
        this.increment(`http.status.${res.statusCode}`);
        if (res.statusCode >= 500) {
          this.increment('http.errors.5xx');
        }
      });
      next();
    };
  }
}

