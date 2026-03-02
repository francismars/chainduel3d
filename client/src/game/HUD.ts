import { GAME_CONFIG, GameMode } from 'shared/types';

const POS_LABELS = ['1st', '2nd', '3rd', '4th'];
const POS_COLORS = ['#ffd54f', '#cfd8dc', '#ffab91', '#90caf9'];

export class HUD {
  private container: HTMLElement;
  private elements: HTMLElement[] = [];
  private playerNames: string[];
  private panelPlayers: number[] = [];
  private minimapPath: Array<{ x: number; y: number }> = [];
  private minimapBounds = { minX: -1, maxX: 1, minY: -1, maxY: 1 };
  private prevBlocks: number[] = [];
  private chainPulseUntil: number[] = [];
  private minimapCanvasEls: Array<HTMLCanvasElement | null> = [];
  private lastHudUpdateMs = 0;
  private lastMinimapUpdateMs = 0;
  private totalLaps: number;
  private gameMode: GameMode;

  constructor(
    container: HTMLElement,
    playerNames: string[],
    visiblePlayerIndices?: number[],
    minimapPath?: Array<{ x: number; y: number }>,
    totalLaps: number = GAME_CONFIG.TOTAL_LAPS,
    gameMode: GameMode = 'classic',
  ) {
    this.container = container;
    this.playerNames = playerNames;
    this.totalLaps = Math.max(1, totalLaps);
    this.gameMode = gameMode;
    this.minimapPath = minimapPath ?? [];
    this.computeMinimapBounds();

    const overlay = document.createElement('div');
    overlay.id = 'hud-overlay';
    overlay.style.cssText = `
      position: absolute; top: 0; left: 0; width: 100%; height: 100%;
      pointer-events: none; z-index: 10;
      font-family: 'Courier New', monospace;
    `;
    container.appendChild(overlay);

    // Up to 4 panels: top-left, top-right, bottom-left, bottom-right
    const panelPositions = [
      'top: 10px; left: 10px;',
      'top: 10px; right: 10px;',
      'bottom: 10px; left: 10px;',
      'bottom: 10px; right: 10px;',
    ];

    const visible = visiblePlayerIndices && visiblePlayerIndices.length > 0
      ? visiblePlayerIndices
      : playerNames.map((_, i) => i);

    for (let i = 0; i < visible.length && i < 4; i++) {
      const playerIndex = visible[i];
      const panel = document.createElement('div');
      panel.style.cssText = `
        position: absolute;
        ${panelPositions[i]}
        width: calc(50% - 24px); max-width: 280px;
        background: linear-gradient(180deg, rgba(14,14,14,0.9), rgba(6,6,6,0.85));
        border: 1px solid #303030;
        border-radius: 6px;
        padding: 8px 10px;
        color: #b5b5b5;
        font-size: 11px;
        box-shadow: 0 0 12px rgba(255,255,255,0.06);
      `;
      overlay.appendChild(panel);
      this.elements.push(panel);
      this.panelPlayers.push(playerIndex);
      this.minimapCanvasEls.push(null);
    }
  }

  update(
    speeds: number[],
    laps: number[],
    items: (string | null)[],
    positions: number[],
    chainBlocks?: number[],
    eliminated?: boolean[],
    driftLevels?: number[],
    raceTimeSec?: number,
    bestLapTimes?: number[],
    worldPositions?: Array<{ x: number; z: number }>,
    playerHeadings?: number[],
    nextCheckpointPositions?: Array<{ x: number; z: number }>,
    checkpointPassed?: number[],
    checkpointTotal?: number,
  ) {
    const now = performance.now();
    const shouldRefreshHud = now - this.lastHudUpdateMs >= 70; // ~14 FPS UI refresh
    const shouldRefreshMinimap = now - this.lastMinimapUpdateMs >= 120; // ~8 FPS minimap
    if (!shouldRefreshHud && !shouldRefreshMinimap) return;

    if (shouldRefreshHud) this.lastHudUpdateMs = now;
    if (shouldRefreshMinimap) this.lastMinimapUpdateMs = now;

    for (let panelIdx = 0; panelIdx < this.elements.length; panelIdx++) {
      const i = this.panelPlayers[panelIdx];
      const speed = Math.abs(speeds[i] * 3.6).toFixed(0);
      const speedNum = Math.abs(speeds[i] * 3.6);
      const lap = Math.min(laps[i] + 1, this.totalLaps);
      const item = items[i] || '---';
      const pos = POS_LABELS[positions[i]] ?? `${positions[i] + 1}th`;
      const blocks = chainBlocks?.[i] ?? 0;
      const isOut = eliminated?.[i] ?? false;
      const speedFill = Math.min(100, (speedNum / 120) * 100);
      const maxBlocks = this.gameMode === 'derby' ? 10 : 12;
      const chainFill = Math.min(100, (blocks / maxBlocks) * 100);
      const positionColor = POS_COLORS[Math.max(0, Math.min(3, positions[i] ?? 3))];
      const lastLap = this.formatTime(raceTimeSec ?? 0);
      const bestLap = this.formatTime(bestLapTimes?.[i] ?? Infinity);
      const itemEmoji = this.itemEmoji(item);
      const itemLabel = item === '---' ? 'NO ITEM' : item.toUpperCase();
      const rivalItems = this.renderRivalItems(i, items, positions);
      const cpPassed = checkpointPassed?.[i] ?? 0;
      const cpTotal = checkpointTotal ?? 0;
      const survivors = (eliminated ?? []).filter(v => !v).length;
      const derbyTopText = `SURVIVORS ${survivors} · TIME ${lastLap}`;
      const nextArrow = this.getCheckpointArrow(
        i,
        worldPositions,
        playerHeadings,
        nextCheckpointPositions,
      );

      const prev = this.prevBlocks[i] ?? blocks;
      const delta = blocks - prev;
      if (delta !== 0) this.chainPulseUntil[i] = now + 550;
      this.prevBlocks[i] = blocks;
      const pulseOn = (this.chainPulseUntil[i] ?? 0) > now;
      const blockDeltaText = delta > 0 ? `+${delta}` : delta < 0 ? `${delta}` : '';

      let driftStatus = 'READY';
      let driftGlow = 'rgba(255,255,255,0.2)';
      let driftFill = 0;
      const dl = driftLevels?.[i] ?? 0;
      if (dl === 1) {
        driftStatus = 'MINI';
        driftGlow = 'rgba(255,255,255,0.45)';
        driftFill = 38;
      } else if (dl === 2) {
        driftStatus = 'SUPER';
        driftGlow = 'rgba(255,255,255,0.7)';
        driftFill = 70;
      } else if (dl >= 3) {
        driftStatus = 'ULTRA';
        driftGlow = 'rgba(255,255,255,0.95)';
        driftFill = 100;
      }

      if (shouldRefreshHud) {
        this.elements[panelIdx].innerHTML = `
        <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:6px">
          <div>
            <div style="font-size:13px;font-weight:bold;color:#fff;letter-spacing:1px">${this.playerNames[i]}</div>
            <div style="font-size:10px;color:#8c8c8c">${this.gameMode === 'derby' ? derbyTopText : `LAP ${lap}/${this.totalLaps} · BEST ${bestLap}`}</div>
          </div>
          <div style="font-size:28px;font-weight:900;line-height:0.9;color:${positionColor};text-shadow:0 0 14px ${positionColor}">${pos}</div>
        </div>

        <div style="display:grid;grid-template-columns:62px 1fr 84px;gap:8px;margin-bottom:8px;align-items:center">
          <div style="height:56px;border:1px solid #3a3a3a;border-radius:6px;background:linear-gradient(180deg,#161616,#0b0b0b);display:flex;flex-direction:column;align-items:center;justify-content:center">
            <div style="font-size:20px;line-height:1">${itemEmoji}</div>
            <div style="font-size:8px;color:#b8b8b8;margin-top:2px">${itemLabel}</div>
          </div>
          <div style="position:relative;height:56px;display:flex;align-items:center;justify-content:center">
            <div style="width:56px;height:56px;border-radius:50%;background:
              radial-gradient(circle at center, #0b0b0b 32%, transparent 33%),
              conic-gradient(#f1f1f1 ${speedFill * 3.6}deg, #242424 0deg);
              border:1px solid #343434;">
            </div>
            <div style="position:absolute;text-align:center">
              <div style="font-size:15px;color:#fff;font-weight:bold">${speed}</div>
              <div style="font-size:8px;color:#8d8d8d">km/h</div>
            </div>
          </div>
          <div style="font-size:10px;color:#9a9a9a;line-height:1.3">
            <div>RACE ${lastLap}</div>
            <div>${this.gameMode === 'derby' ? `ALIVE ${survivors}` : `CP ${cpPassed}/${cpTotal}`} <span style="display:inline-block;transform:rotate(${nextArrow.toFixed(2)}rad);margin-left:4px;color:#fff">▲</span></div>
            <div>DRIFT <span style="color:#fff;text-shadow:0 0 8px ${driftGlow}">${driftStatus}</span></div>
          </div>
        </div>

        <div style="margin-bottom:5px">
          <div style="display:flex;justify-content:space-between;color:#8f8f8f;font-size:10px;margin-bottom:2px">
            <span>BOOST CHARGE</span><span>${Math.round(driftFill)}%</span>
          </div>
          <div style="height:5px;background:#1a1a1a;border:1px solid #2b2b2b;border-radius:4px;overflow:hidden">
            <div style="width:${driftFill}%;height:100%;background:linear-gradient(90deg,#6c6c6c,#ffffff);box-shadow:0 0 8px ${driftGlow}"></div>
          </div>
        </div>

        <div>
          <div style="display:flex;justify-content:space-between;color:#8f8f8f;font-size:10px;margin-bottom:2px">
            <span>${this.gameMode === 'derby' ? 'HEALTH' : 'CHAIN'}</span>
            <span style="color:${isOut ? '#b0b0b0' : '#fff'}">
              ${isOut ? 'ELIMINATED' : `${blocks} BLOCKS ${blockDeltaText}`}
            </span>
          </div>
          <div style="height:8px;background:#1a1a1a;border:1px solid #2b2b2b;border-radius:4px;overflow:hidden;position:relative">
            <div style="width:${chainFill}%;height:100%;background:linear-gradient(90deg,#5f5f5f,#d9d9d9)"></div>
            ${pulseOn ? `<div style="position:absolute;inset:0;background:rgba(255,255,255,0.18)"></div>` : ''}
          </div>
        </div>
        <div style="margin-top:6px;display:flex;gap:2px">${this.renderChainPips(blocks, maxBlocks)}</div>
        <div style="margin-top:6px;font-size:10px;color:#9a9a9a;border-top:1px solid #242424;padding-top:4px">
          <span style="color:#d0d0d0">RIVAL ITEMS:</span> ${rivalItems}
        </div>
        <canvas data-minimap="1" width="124" height="72" style="margin-top:6px;width:100%;height:56px;border:1px solid #2f2f2f;border-radius:4px;background:#090909"></canvas>
      `;
        this.minimapCanvasEls[panelIdx] =
          this.elements[panelIdx].querySelector('canvas[data-minimap="1"]') as HTMLCanvasElement | null;

        // Redraw immediately after canvas recreation to avoid visible blinking.
        const freshCanvas = this.minimapCanvasEls[panelIdx];
        if (freshCanvas) this.drawMinimap(freshCanvas, i, worldPositions, positions);
      }

      if (shouldRefreshMinimap) {
        const canvas = this.minimapCanvasEls[panelIdx];
        if (canvas) this.drawMinimap(canvas, i, worldPositions, positions);
      }
    }
  }

  private formatTime(sec: number): string {
    if (!Number.isFinite(sec)) return '--:--.---';
    const m = Math.floor(sec / 60);
    const s = sec - m * 60;
    const sStr = s.toFixed(3).padStart(6, '0');
    return `${m.toString().padStart(2, '0')}:${sStr}`;
  }

  private itemEmoji(item: string): string {
    if (item.includes('Lightning')) return '⚡';
    if (item.includes('Mempool')) return '⛏';
    if (item.includes('Fee')) return '₿';
    if (item.includes('Siphon')) return 'ₛ';
    if (item.includes('Nostr')) return '✶';
    return '□';
  }

  private renderRivalItems(selfIdx: number, items: (string | null)[], positions: number[]): string {
    const rivals: Array<{ idx: number; rank: number; item: string | null }> = [];
    for (let i = 0; i < items.length; i++) {
      if (i === selfIdx) continue;
      rivals.push({ idx: i, rank: positions[i] ?? 99, item: items[i] });
    }
    rivals.sort((a, b) => a.rank - b.rank);
    return rivals
      .map(r => {
        const itemName = r.item ?? 'NONE';
        const icon = r.item ? this.itemEmoji(r.item) : '·';
        return `P${r.idx + 1} ${icon} ${itemName.toUpperCase()}`;
      })
      .join('  |  ');
  }

  private renderChainPips(blocks: number, max: number): string {
    let html = '';
    for (let i = 0; i < max; i++) {
      const on = i < blocks;
      html += `<div style="width:8px;height:8px;border-radius:2px;border:1px solid #3b3b3b;background:${on ? '#e0e0e0' : '#181818'}"></div>`;
    }
    return html;
  }

  private computeMinimapBounds() {
    if (this.minimapPath.length === 0) return;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const p of this.minimapPath) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
    }
    this.minimapBounds = { minX, maxX, minY, maxY };
  }

  private drawMinimap(
    canvas: HTMLCanvasElement,
    playerIdx: number,
    worldPositions?: Array<{ x: number; z: number }>,
    positions?: number[],
  ) {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, w, h);

    if (this.minimapPath.length > 1) {
      ctx.strokeStyle = '#4e4e4e';
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let i = 0; i < this.minimapPath.length; i++) {
        const p = this.mapToMinimap(this.minimapPath[i], w, h);
        if (i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      }
      ctx.closePath();
      ctx.stroke();
    }

    if (!worldPositions) return;
    for (let i = 0; i < worldPositions.length; i++) {
      const wp = worldPositions[i];
      const p = this.mapToMinimap({ x: wp.x, y: wp.z }, w, h);
      const isSelf = i === playerIdx;
      const isLeader = positions?.[i] === 0;
      ctx.beginPath();
      ctx.fillStyle = isSelf ? '#ffffff' : isLeader ? '#ffd54f' : '#9a9a9a';
      ctx.arc(p.x, p.y, isSelf ? 3.6 : 2.6, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private mapToMinimap(p: { x: number; y: number }, w: number, h: number): { x: number; y: number } {
    const pad = 8;
    const bw = Math.max(1, this.minimapBounds.maxX - this.minimapBounds.minX);
    const bh = Math.max(1, this.minimapBounds.maxY - this.minimapBounds.minY);
    const nx = (p.x - this.minimapBounds.minX) / bw;
    const ny = (p.y - this.minimapBounds.minY) / bh;
    return {
      x: pad + nx * (w - pad * 2),
      y: h - (pad + ny * (h - pad * 2)),
    };
  }

  private getCheckpointArrow(
    playerIdx: number,
    worldPositions?: Array<{ x: number; z: number }>,
    playerHeadings?: number[],
    nextCheckpointPositions?: Array<{ x: number; z: number }>,
  ): number {
    const pos = worldPositions?.[playerIdx];
    const next = nextCheckpointPositions?.[playerIdx];
    if (!pos || !next) return 0;
    const bearing = Math.atan2(next.x - pos.x, next.z - pos.z);
    const heading = playerHeadings?.[playerIdx] ?? 0;
    let rel = bearing - heading;
    while (rel > Math.PI) rel -= Math.PI * 2;
    while (rel < -Math.PI) rel += Math.PI * 2;
    return rel;
  }

  showCountdown(count: number) {
    let existing = document.getElementById('countdown-display');
    if (!existing) {
      existing = document.createElement('div');
      existing.id = 'countdown-display';
      existing.style.cssText = `
        position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
        font-size: 120px; font-weight: bold; color: #ffffff;
        font-family: 'Courier New', monospace;
        text-shadow: 0 0 40px rgba(255,255,255,0.6);
        z-index: 20; pointer-events: none;
        transition: transform 0.3s, opacity 0.3s;
      `;
      this.container.appendChild(existing);
    }

    if (count > 0) {
      existing.textContent = count.toString();
      existing.style.opacity = '1';
      existing.style.transform = 'translate(-50%, -50%) scale(1)';
    } else {
      existing.textContent = 'GO!';
      existing.style.color = '#ffffff';
      existing.style.textShadow = '0 0 60px rgba(255,255,255,0.9)';
      setTimeout(() => {
        if (existing) {
          existing.style.opacity = '0';
          existing.style.transform = 'translate(-50%, -50%) scale(2)';
        }
      }, 100);
      setTimeout(() => existing?.remove(), 600);
    }
  }

  hideCountdown() {
    document.getElementById('countdown-display')?.remove();
  }

  dispose() {
    document.getElementById('hud-overlay')?.remove();
    this.hideCountdown();
  }
}
