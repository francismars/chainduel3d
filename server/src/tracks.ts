import fs from 'fs';
import path from 'path';
import type { TrackCustomLayout, TrackDefinition } from '../../shared/types';

type TrackCatalogFile = {
  tracks: TrackDefinition[];
};

const DEFAULT_TRACK_ID = 'default';
const DEFAULT_TRACK_LAYOUT: TrackCustomLayout = {
  main: [
    { x: -80, z: -20, w: 12, e: 4 },
    { x: -40, z: -88, w: 12, e: 5 },
    { x: 36, z: -98, w: 12, e: 7, ramp: true },
    { x: 94, z: -56, w: 11, e: 13, bridge: true },
    { x: 106, z: 20, w: 11, e: 16, bridge: true },
    { x: 62, z: 86, w: 12, e: 12, bridge: true },
    { x: -18, z: 102, w: 12, e: 7 },
    { x: -88, z: 62, w: 11, e: 4 },
  ],
  shortcut: [
    { x: 34, z: -56, e: 8 },
    { x: 14, z: -8, e: 10 },
    { x: -6, z: 34, e: 9 },
    { x: -38, z: 60, e: 7 },
  ],
};

export class TrackCatalog {
  private readonly filePath: string;
  private cache: TrackDefinition[] = [];

  constructor(filePath?: string) {
    this.filePath = filePath ?? path.join(process.cwd(), 'server', 'data', 'tracks.json');
    this.ensureLoaded();
  }

  list(): Array<Pick<TrackDefinition, 'id' | 'name' | 'updatedAt'>> {
    const sorted = [...this.cache].sort((a, b) => {
      if (a.id === DEFAULT_TRACK_ID) return -1;
      if (b.id === DEFAULT_TRACK_ID) return 1;
      return a.name.localeCompare(b.name);
    });
    return sorted.map(t => ({ id: t.id, name: t.name, updatedAt: t.updatedAt }));
  }

  get(trackId: string): TrackDefinition | null {
    const id = this.normalizeTrackId(trackId);
    if (!id) return null;
    return this.cache.find(t => t.id === id) ?? null;
  }

  upsert(input: { id?: string; name: string; layout: TrackCustomLayout | null }): TrackDefinition {
    const now = Date.now();
    const normalizedId = this.normalizeTrackId(input.id) || this.slugify(input.name);
    const id = normalizedId || `track-${now}`;
    if (id === DEFAULT_TRACK_ID) {
      const existingDefault = this.cache.find(t => t.id === DEFAULT_TRACK_ID);
      if (existingDefault) return existingDefault;
    }
    const name = (input.name || id).trim().slice(0, 64) || id;
    const idx = this.cache.findIndex(t => t.id === id);
    if (idx >= 0) {
      const next: TrackDefinition = {
        ...this.cache[idx],
        name,
        layout: input.layout ?? null,
        updatedAt: now,
      };
      this.cache[idx] = next;
      this.persist();
      return next;
    }
    const created: TrackDefinition = {
      id,
      name,
      layout: input.layout ?? null,
      createdAt: now,
      updatedAt: now,
    };
    this.cache.push(created);
    this.persist();
    return created;
  }

  remove(trackId: string): boolean {
    const id = this.normalizeTrackId(trackId);
    if (!id || id === DEFAULT_TRACK_ID) return false;
    const before = this.cache.length;
    this.cache = this.cache.filter(t => t.id !== id);
    if (this.cache.length === before) return false;
    this.persist();
    return true;
  }

  private ensureLoaded() {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(this.filePath)) {
      const initial: TrackCatalogFile = {
        tracks: [{
          id: DEFAULT_TRACK_ID,
          name: 'Default Track',
          layout: DEFAULT_TRACK_LAYOUT,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        }],
      };
      fs.writeFileSync(this.filePath, JSON.stringify(initial, null, 2), 'utf8');
    }
    try {
      const raw = fs.readFileSync(this.filePath, 'utf8');
      const parsed = JSON.parse(raw) as TrackCatalogFile;
      this.cache = Array.isArray(parsed.tracks) ? parsed.tracks : [];
    } catch {
      this.cache = [];
    }
    if (!this.cache.some(t => t.id === DEFAULT_TRACK_ID)) {
      this.cache.unshift({
        id: DEFAULT_TRACK_ID,
        name: 'Default Track',
        layout: DEFAULT_TRACK_LAYOUT,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      this.persist();
      return;
    }
    const defaultIndex = this.cache.findIndex(t => t.id === DEFAULT_TRACK_ID);
    if (defaultIndex >= 0) {
      const current = this.cache[defaultIndex];
      this.cache[defaultIndex] = {
        ...current,
        name: 'Default Track',
        layout: DEFAULT_TRACK_LAYOUT,
      };
      this.persist();
    }
  }

  private persist() {
    const payload: TrackCatalogFile = { tracks: this.cache };
    fs.writeFileSync(this.filePath, JSON.stringify(payload, null, 2), 'utf8');
  }

  private normalizeTrackId(v?: string): string {
    if (!v) return '';
    return v.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
  }

  private slugify(input: string): string {
    return (input || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40);
  }
}

