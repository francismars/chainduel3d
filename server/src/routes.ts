import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { RouteCustomLayout, RouteDefinition } from '../../shared/types';

type RouteCatalogFile = {
  routes: RouteDefinition[];
};

const DEFAULT_ROUTE_ID = 'default';
const DEFAULT_ROUTE_LAYOUT: RouteCustomLayout = {
  layoutType: 'loop',
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

export class RouteCatalog {
  private readonly filePath: string;
  private cache: RouteDefinition[] = [];

  constructor(filePath?: string) {
    const here = path.dirname(fileURLToPath(import.meta.url));
    this.filePath = filePath ?? path.resolve(here, '..', 'data', 'routes.json');
    this.ensureLoaded();
  }

  list(): Array<Pick<RouteDefinition, 'id' | 'name' | 'updatedAt'>> {
    const sorted = [...this.cache].sort((a, b) => {
      if (a.id === DEFAULT_ROUTE_ID) return -1;
      if (b.id === DEFAULT_ROUTE_ID) return 1;
      return a.name.localeCompare(b.name);
    });
    return sorted.map(t => ({ id: t.id, name: t.name, updatedAt: t.updatedAt }));
  }

  get(routeId: string): RouteDefinition | null {
    const id = this.normalizeRouteId(routeId);
    if (!id) return null;
    return this.cache.find(t => t.id === id) ?? null;
  }

  upsert(input: { id?: string; name: string; layout: RouteCustomLayout | null }): RouteDefinition {
    const now = Date.now();
    const normalizedId = this.normalizeRouteId(input.id) || this.slugify(input.name);
    const id = normalizedId || `route-${now}`;
    if (id === DEFAULT_ROUTE_ID) {
      const existingDefault = this.cache.find(t => t.id === DEFAULT_ROUTE_ID);
      if (existingDefault) return existingDefault;
    }
    const name = (input.name || id).trim().slice(0, 64) || id;
    const idx = this.cache.findIndex(t => t.id === id);
    if (idx >= 0) {
      const next: RouteDefinition = {
        ...this.cache[idx],
        name,
        layout: this.sanitizeLayout(input.layout),
        updatedAt: now,
      };
      this.cache[idx] = next;
      this.persist();
      return next;
    }
    const created: RouteDefinition = {
      id,
      name,
      layout: this.sanitizeLayout(input.layout),
      createdAt: now,
      updatedAt: now,
    };
    this.cache.push(created);
    this.persist();
    return created;
  }

  create(name: string, layout: RouteCustomLayout | null): RouteDefinition {
    const now = Date.now();
    const base = this.slugify(name) || 'route';
    const id = this.nextUniqueId(base);
    const created: RouteDefinition = {
      id,
      name: (name || id).trim().slice(0, 64) || id,
      layout: this.sanitizeLayout(layout),
      createdAt: now,
      updatedAt: now,
    };
    this.cache.push(created);
    this.persist();
    return created;
  }

  remove(routeId: string): boolean {
    const id = this.normalizeRouteId(routeId);
    if (!id || id === DEFAULT_ROUTE_ID) return false;
    const before = this.cache.length;
    this.cache = this.cache.filter(t => t.id !== id);
    if (this.cache.length === before) return false;
    this.persist();
    return true;
  }

  private ensureLoaded() {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const legacyPath = path.join(process.cwd(), 'server', 'data', 'tracks.json');
    if (!fs.existsSync(this.filePath) && fs.existsSync(legacyPath)) {
      fs.copyFileSync(legacyPath, this.filePath);
    }
    if (!fs.existsSync(this.filePath)) {
      const initial: RouteCatalogFile = {
        routes: [{
          id: DEFAULT_ROUTE_ID,
          name: 'Genesis Route',
          layout: DEFAULT_ROUTE_LAYOUT,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        }],
      };
      fs.writeFileSync(this.filePath, JSON.stringify(initial, null, 2), 'utf8');
    }
    try {
      const raw = fs.readFileSync(this.filePath, 'utf8');
      const parsed = JSON.parse(raw) as RouteCatalogFile & { tracks?: RouteDefinition[] };
      this.cache = Array.isArray(parsed.routes)
        ? parsed.routes
        : (Array.isArray(parsed.tracks) ? parsed.tracks : []);
      this.cache = this.cache.map(route => ({
        ...route,
        layout: this.sanitizeLayout(route.layout ?? null),
      }));
    } catch {
      this.cache = [];
    }
    if (!this.cache.some(t => t.id === DEFAULT_ROUTE_ID)) {
      this.cache.unshift({
        id: DEFAULT_ROUTE_ID,
        name: 'Genesis Route',
        layout: DEFAULT_ROUTE_LAYOUT,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      this.persist();
      return;
    }
    const defaultIndex = this.cache.findIndex(t => t.id === DEFAULT_ROUTE_ID);
    if (defaultIndex >= 0) {
      const current = this.cache[defaultIndex];
      this.cache[defaultIndex] = {
        ...current,
        name: 'Genesis Route',
        layout: DEFAULT_ROUTE_LAYOUT,
      };
      this.persist();
    }
  }

  private persist() {
    const payload: RouteCatalogFile = { routes: this.cache };
    fs.writeFileSync(this.filePath, JSON.stringify(payload, null, 2), 'utf8');
  }

  private normalizeRouteId(v?: string): string {
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

  private nextUniqueId(base: string): string {
    if (base !== DEFAULT_ROUTE_ID && !this.cache.some(t => t.id === base)) return base;
    let i = 2;
    while (i < 10000) {
      const candidate = `${base}-${i}`;
      if (candidate !== DEFAULT_ROUTE_ID && !this.cache.some(t => t.id === candidate)) return candidate;
      i++;
    }
    return `route-${Date.now()}`;
  }

  private sanitizeLayout(layout: RouteCustomLayout | null): RouteCustomLayout | null {
    if (!layout) return null;
    const main = Array.isArray(layout.main)
      ? layout.main.map(cp => ({
        x: Number(cp.x) || 0,
        z: Number(cp.z) || 0,
        w: Math.max(4, Math.min(30, Number(cp.w) || 10)),
        e: Number(cp.e) || 0,
        ramp: !!cp.ramp,
        bridge: !!cp.bridge,
        noRails: !!cp.noRails,
        boost: !!cp.boost,
        loop: !!cp.loop,
        tunnel: !!cp.tunnel,
        tunnelWall: !!cp.tunnelWall,
        tunnelWallSide: (cp.tunnelWallSide === 'left' || cp.tunnelWallSide === 'right' ? cp.tunnelWallSide : 'bottom') as 'bottom' | 'left' | 'right',
      }))
      : [];
    const shortcut = Array.isArray(layout.shortcut)
      ? layout.shortcut
        .filter(cp => Number.isFinite(cp.x) && Number.isFinite(cp.z) && Number.isFinite(cp.e))
        .map(cp => ({ x: Number(cp.x), z: Number(cp.z), e: Number(cp.e) }))
      : undefined;
    const layoutType = layout.layoutType === 'arena' ? 'arena' : 'loop';
    if (layoutType === 'loop' && main.length < 4) return null;
    return {
      main,
      shortcut,
      layoutType,
      arenaShape: layout.arenaShape === 'rounded_rect' ? 'rounded_rect' : 'circle',
      arenaRadiusX: Math.max(24, Math.min(260, Number(layout.arenaRadiusX) || 84)),
      arenaRadiusZ: Math.max(24, Math.min(260, Number(layout.arenaRadiusZ) || 74)),
      arenaFloorY: Math.max(-10, Math.min(80, Number(layout.arenaFloorY) || 4)),
      arenaWallHeight: Math.max(2, Math.min(36, Number(layout.arenaWallHeight) || 7)),
      arenaObstacleDensity: Math.max(0, Math.min(1, Number(layout.arenaObstacleDensity) || 0)),
      interiorObstacles: Array.isArray(layout.interiorObstacles)
        ? layout.interiorObstacles
          .filter(o => Number.isFinite(o.x) && Number.isFinite(o.z))
          .map(o => ({
            x: Number(o.x),
            z: Number(o.z),
            radius: Math.max(1, Math.min(40, Number(o.radius) || 5)),
            height: Math.max(1.2, Math.min(30, Number(o.height) || 4)),
          }))
        : [],
      showCenterpiece: layout.showCenterpiece !== false,
    };
  }
}

