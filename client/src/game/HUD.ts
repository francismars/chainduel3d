import { GAME_CONFIG, GameMode } from 'shared/types';

const POS_LABELS = ['1st', '2nd', '3rd', '4th'];
const POS_COLORS = ['#ffd54f', '#cfd8dc', '#ffab91', '#90caf9'];

export class HUD {
  private container: HTMLElement;
  private elements: HTMLElement[] = [];
  private playerNames: string[];
  private panelPlayers: number[] = [];
  private singlePlayerLayout = false;
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

    const visible = visiblePlayerIndices && visiblePlayerIndices.length > 0
      ? visiblePlayerIndices
      : playerNames.map((_, i) => i);
    this.singlePlayerLayout = visible.length === 1;

    if (this.singlePlayerLayout) {
      const root = document.createElement('div');
      root.style.cssText = `
        position:absolute; inset:0;
      `;
      overlay.appendChild(root);
      this.elements.push(root);
      this.panelPlayers.push(visible[0]);
      this.minimapCanvasEls.push(null);
      return;
    }

    for (let i = 0; i < visible.length && i < 4; i++) {
      const playerIndex = visible[i];
      const panel = document.createElement('div');
      panel.style.cssText = `
        position: absolute; pointer-events:none;
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
        const mobileHud = this.isMobileViewport();
        this.elements[panelIdx].innerHTML = this.singlePlayerLayout
          ? (mobileHud
            ? this.renderSinglePlayerMobileHud({
              i,
              lap,
              pos,
              positionColor,
              itemEmoji,
              itemLabel,
              speed,
              speedFill,
              lastLap,
              derbyTopText,
              cpPassed,
              cpTotal,
              nextArrow,
              driftStatus,
              driftFill,
              driftGlow,
              blocks,
              blockDeltaText,
              chainFill,
              pulseOn,
              maxBlocks,
              isOut,
              bestLap,
              rivalItems,
              survivors,
            })
            : this.renderSinglePlayerHud({
            i,
            lap,
            pos,
            positionColor,
            itemEmoji,
            itemLabel,
            speed,
            speedFill,
            lastLap,
            derbyTopText,
            cpPassed,
            cpTotal,
            nextArrow,
            driftStatus,
            driftFill,
            driftGlow,
            blocks,
            blockDeltaText,
            chainFill,
            pulseOn,
            maxBlocks,
            isOut,
            bestLap,
            rivalItems,
            survivors,
            }))
          : this.renderCompactPanelHud({
            i,
            panelIdx,
            totalPanels: this.elements.length,
            lap,
            pos,
            positionColor,
            itemEmoji,
            itemLabel,
            speed,
            speedFill,
            lastLap,
            derbyTopText,
            cpPassed,
            cpTotal,
            nextArrow,
            driftStatus,
            driftFill,
            driftGlow,
            blocks,
            blockDeltaText,
            chainFill,
            pulseOn,
            maxBlocks,
            isOut,
            bestLap,
            rivalItems,
            survivors,
          });
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

  pushEvent(text: string, tone: 'neutral' | 'warn' | 'danger' = 'neutral', ttlMs = 2800) {
    void text;
    void tone;
    void ttlMs;
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

  private renderCompactPanelHud(s: {
    i: number;
    panelIdx: number;
    totalPanels: number;
    lap: number;
    pos: string;
    positionColor: string;
    itemEmoji: string;
    itemLabel: string;
    speed: string;
    speedFill: number;
    lastLap: string;
    derbyTopText: string;
    cpPassed: number;
    cpTotal: number;
    nextArrow: number;
    driftStatus: string;
    driftFill: number;
    driftGlow: string;
    blocks: number;
    blockDeltaText: string;
    chainFill: number;
    pulseOn: boolean;
    maxBlocks: number;
    isOut: boolean;
    bestLap: string;
    rivalItems: string;
    survivors: number;
  }): string {
    const slot = this.getSplitSlotRect(s.panelIdx, s.totalPanels);
    const mobileHud = this.isMobileViewport();
    const hudDensity = s.totalPanels >= 4 || mobileHud ? 'small' : s.totalPanels === 3 ? 'medium' : 'wide';
    const pad = hudDensity === 'small' ? 4 : 6;
    const panelMaxWidth = hudDensity === 'small' ? 230 : hudDensity === 'medium' ? 260 : 320;
    const speedFont = hudDensity === 'small' ? 16 : hudDensity === 'medium' ? 18 : 22;
    const posFont = hudDensity === 'small' ? 22 : hudDensity === 'medium' ? 25 : 30;
    const showRival = s.totalPanels <= 2 && !mobileHud;
    const showPips = hudDensity !== 'small';
    const infoText = this.gameMode === 'derby'
      ? `ALIVE ${s.survivors}`
      : `CP ${s.cpPassed}/${s.cpTotal}`;
    const bestOrClock = this.gameMode === 'derby'
      ? `TIME ${s.lastLap}`
      : `BEST ${s.bestLap}`;
    this.elements[s.panelIdx].style.cssText = `
      position:absolute;
      left:${slot.left.toFixed(3)}%;
      top:${slot.top.toFixed(3)}%;
      width:${slot.width.toFixed(3)}%;
      height:${slot.height.toFixed(3)}%;
      pointer-events:none;
      overflow:hidden;
    `;
    return `
      <div style="position:absolute;left:${pad}px;top:${pad}px;width:calc(100% - ${pad * 2}px);max-width:${panelMaxWidth}px;background:linear-gradient(180deg, rgba(14,14,14,0.92), rgba(6,6,6,0.86));border:1px solid #2f2f2f;border-radius:7px;padding:${hudDensity === 'small' ? '5px 6px' : '6px 8px'};box-shadow:0 0 12px rgba(0,0,0,0.45)">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px">
          <div style="min-width:0;flex:1">
            <div style="font-size:${hudDensity === 'small' ? 10 : 11}px;font-weight:bold;color:#fff;letter-spacing:0.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${this.playerNames[s.i]}</div>
            <div style="font-size:${hudDensity === 'small' ? 8 : 9}px;color:#9a9a9a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${this.gameMode === 'derby' ? s.derbyTopText : `LAP ${s.lap}/${this.totalLaps} · ${bestOrClock}`}</div>
          </div>
          <div style="font-size:${posFont}px;font-weight:900;line-height:0.9;color:${s.positionColor};text-shadow:0 0 14px ${s.positionColor}">${s.pos}</div>
        </div>

        <div style="display:grid;grid-template-columns:${hudDensity === 'small' ? '42px 1fr auto' : '52px 1fr auto'};gap:${hudDensity === 'small' ? 5 : 7}px;margin-top:${hudDensity === 'small' ? 5 : 6}px;align-items:center">
          <div style="height:${hudDensity === 'small' ? 42 : 52}px;border:1px solid #3a3a3a;border-radius:6px;background:linear-gradient(180deg,#161616,#0b0b0b);display:flex;flex-direction:column;align-items:center;justify-content:center">
            <div style="font-size:${hudDensity === 'small' ? 16 : 19}px;line-height:1">${s.itemEmoji}</div>
            <div style="font-size:7px;color:#b8b8b8;margin-top:1px;max-width:38px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-align:center">${s.itemLabel}</div>
          </div>
          <div>
            <div style="display:flex;align-items:flex-end;gap:5px;line-height:1">
              <span style="font-size:${speedFont}px;color:#fff;font-weight:900">${s.speed}</span>
              <span style="font-size:${hudDensity === 'small' ? 8 : 9}px;color:#8d8d8d;letter-spacing:0.7px">KM/H</span>
            </div>
            <div style="margin-top:3px;height:${hudDensity === 'small' ? 5 : 6}px;background:#1a1a1a;border:1px solid #2b2b2b;border-radius:4px;overflow:hidden">
              <div style="width:${s.driftFill}%;height:100%;background:linear-gradient(90deg,#6c6c6c,#ffffff);box-shadow:0 0 8px ${s.driftGlow}"></div>
            </div>
            <div style="font-size:${hudDensity === 'small' ? 8 : 9}px;color:#a7a7a7;margin-top:2px">${infoText} · DRIFT <span style="color:#fff;text-shadow:0 0 8px ${s.driftGlow}">${s.driftStatus}</span></div>
          </div>
          <div style="display:flex;flex-direction:column;align-items:flex-end;justify-content:center;gap:2px;min-width:${hudDensity === 'small' ? 52 : 62}px">
            <div style="font-size:${hudDensity === 'small' ? 8 : 9}px;color:#8f8f8f;white-space:nowrap">RACE ${s.lastLap}</div>
            <div style="font-size:${hudDensity === 'small' ? 9 : 10}px;color:${s.isOut ? '#b0b0b0' : '#fff'};white-space:nowrap">${s.isOut ? 'OUT' : `${s.blocks} ${s.blockDeltaText}`}</div>
            <div style="font-size:${hudDensity === 'small' ? 10 : 11}px;color:#fff;line-height:1;transform:rotate(${s.nextArrow.toFixed(2)}rad)">▲</div>
          </div>
        </div>

        <div style="margin-top:${hudDensity === 'small' ? 4 : 5}px">
          <div style="display:flex;justify-content:space-between;color:#8f8f8f;font-size:${hudDensity === 'small' ? 8 : 9}px;margin-bottom:2px">
            <span>${this.gameMode === 'derby' ? 'HEALTH' : 'CHAIN'}</span><span>${Math.round(s.chainFill)}%</span>
          </div>
          <div style="height:${hudDensity === 'small' ? 6 : 7}px;background:#1a1a1a;border:1px solid #2b2b2b;border-radius:4px;overflow:hidden;position:relative">
            <div style="width:${s.chainFill}%;height:100%;background:linear-gradient(90deg,#5f5f5f,#d9d9d9)"></div>
            ${s.pulseOn ? `<div style="position:absolute;inset:0;background:rgba(255,255,255,0.16)"></div>` : ''}
          </div>
        </div>

        ${showPips ? `
        <div style="margin-top:5px;display:flex;gap:2px">${this.renderChainPips(s.blocks, s.maxBlocks)}</div>
        ` : ''}
        ${showRival ? `
        <div style="margin-top:6px;font-size:9px;color:#9a9a9a;border-top:1px solid #242424;padding-top:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
          <span style="color:#d0d0d0">RIVAL:</span> ${s.rivalItems}
        </div>
        ` : ''}
      </div>
    `;
  }

  private renderSinglePlayerMobileHud(s: {
    i: number;
    lap: number;
    pos: string;
    positionColor: string;
    itemEmoji: string;
    itemLabel: string;
    speed: string;
    speedFill: number;
    lastLap: string;
    derbyTopText: string;
    cpPassed: number;
    cpTotal: number;
    nextArrow: number;
    driftStatus: string;
    driftFill: number;
    driftGlow: string;
    blocks: number;
    blockDeltaText: string;
    chainFill: number;
    pulseOn: boolean;
    maxBlocks: number;
    isOut: boolean;
    bestLap: string;
    rivalItems: string;
    survivors: number;
  }): string {
    const topInset = 12;
    return `
      <div style="position:absolute;left:10px;right:10px;top:${topInset}px;background:linear-gradient(180deg,rgba(16,16,16,0.92),rgba(8,8,8,0.86));border:1px solid #353535;border-radius:10px;padding:7px 9px;box-shadow:0 0 16px rgba(0,0,0,0.45)">
        <div style="display:grid;grid-template-columns:auto 1fr auto;gap:8px;align-items:center">
          <div style="font-size:30px;line-height:0.9;font-weight:900;color:${s.positionColor};text-shadow:0 0 14px ${s.positionColor};padding-right:4px">${s.pos}</div>
          <div style="min-width:0">
            <div style="font-size:11px;font-weight:bold;color:#fff;letter-spacing:0.6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${this.playerNames[s.i]}</div>
            <div style="font-size:9px;color:#9a9a9a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${this.gameMode === 'derby' ? s.derbyTopText : `LAP ${s.lap}/${this.totalLaps} · BEST ${s.bestLap}`}</div>
          </div>
          <div style="display:flex;align-items:center;gap:6px">
            <div style="width:42px;height:42px;border:1px solid #3a3a3a;border-radius:8px;background:linear-gradient(180deg,#181818,#0b0b0b);display:flex;align-items:center;justify-content:center;font-size:19px">${s.itemEmoji}</div>
            <div style="text-align:right;min-width:56px">
              <div style="font-size:9px;color:#d9d9d9;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:62px">${s.itemLabel}</div>
              <div style="font-size:8px;color:#8e8e8e;margin-top:1px">RACE ${s.lastLap}</div>
            </div>
          </div>
        </div>
      </div>

      <div style="position:absolute;left:10px;bottom:12px;width:48%;max-width:210px;background:linear-gradient(180deg,rgba(16,16,16,0.95),rgba(6,6,6,0.92));border:1px solid #353535;border-radius:10px;padding:8px 9px;box-shadow:0 0 16px rgba(0,0,0,0.45)">
        <div style="display:flex;align-items:flex-end;gap:5px;line-height:1">
          <span style="font-size:26px;color:#fff;font-weight:900">${s.speed}</span>
          <span style="font-size:9px;color:#8d8d8d;letter-spacing:0.7px;margin-bottom:3px">KM/H</span>
        </div>
        <div style="margin-top:4px;height:6px;background:#1a1a1a;border:1px solid #2b2b2b;border-radius:4px;overflow:hidden">
          <div style="width:${s.driftFill}%;height:100%;background:linear-gradient(90deg,#6c6c6c,#ffffff);box-shadow:0 0 8px ${s.driftGlow}"></div>
        </div>
        <div style="margin-top:3px;font-size:9px;color:#a8a8a8">${this.gameMode === 'derby' ? `ALIVE ${s.survivors}` : `CP ${s.cpPassed}/${s.cpTotal}`} <span style="display:inline-block;transform:rotate(${s.nextArrow.toFixed(2)}rad);margin-left:4px;color:#fff">▲</span> · DRIFT <span style="color:#fff;text-shadow:0 0 8px ${s.driftGlow}">${s.driftStatus}</span></div>
      </div>

      <div style="position:absolute;right:10px;bottom:12px;width:48%;max-width:220px;background:linear-gradient(180deg,rgba(16,16,16,0.95),rgba(6,6,6,0.92));border:1px solid #353535;border-radius:10px;padding:8px 9px;box-shadow:0 0 16px rgba(0,0,0,0.45)">
        <div style="display:flex;justify-content:space-between;color:#8f8f8f;font-size:9px;margin-bottom:2px">
          <span>${this.gameMode === 'derby' ? 'HEALTH' : 'CHAIN'}</span>
          <span style="color:${s.isOut ? '#b0b0b0' : '#fff'}">${s.isOut ? 'OUT' : `${s.blocks} ${s.blockDeltaText}`}</span>
        </div>
        <div style="height:8px;background:#1a1a1a;border:1px solid #2b2b2b;border-radius:4px;overflow:hidden;position:relative">
          <div style="width:${s.chainFill}%;height:100%;background:linear-gradient(90deg,#5f5f5f,#d9d9d9)"></div>
          ${s.pulseOn ? `<div style="position:absolute;inset:0;background:rgba(255,255,255,0.17)"></div>` : ''}
        </div>
        <div style="margin-top:5px;display:flex;gap:2px">${this.renderChainPips(s.blocks, s.maxBlocks)}</div>
      </div>

      <div style="position:absolute;left:10px;bottom:94px;width:38%;max-width:170px;background:linear-gradient(180deg,rgba(16,16,16,0.9),rgba(7,7,7,0.84));border:1px solid #343434;border-radius:8px;padding:6px;box-shadow:0 0 14px rgba(0,0,0,0.45)">
        <canvas data-minimap="1" width="170" height="96" style="width:100%;height:74px;border:1px solid #2d2d2d;border-radius:6px;background:#090909"></canvas>
      </div>
    `;
  }

  private isMobileViewport(): boolean {
    if (typeof window === 'undefined') return false;
    const coarsePointer = typeof window.matchMedia === 'function'
      ? window.matchMedia('(pointer: coarse)').matches
      : false;
    return coarsePointer || window.innerWidth <= 900;
  }

  private getSplitSlotRect(panelIndex: number, totalPanels: number): { left: number; top: number; width: number; height: number } {
    const slots = this.getSplitSlots(totalPanels);
    const safePanelIndex = Math.max(0, Math.min(slots.length - 1, panelIndex));
    const slot = slots[safePanelIndex];
    const left = ((slot.x - slot.w / 2) + 1) * 50;
    const top = (1 - (slot.y + slot.h / 2)) * 50;
    const width = slot.w * 50;
    const height = slot.h * 50;
    return { left, top, width, height };
  }

  private getSplitSlots(count: number): Array<{ x: number; y: number; w: number; h: number }> {
    if (count <= 1) return [{ x: 0, y: 0, w: 2, h: 2 }];
    if (count === 2) {
      return [
        { x: -0.5, y: 0, w: 1, h: 2 },
        { x: 0.5, y: 0, w: 1, h: 2 },
      ];
    }
    if (count === 3) {
      return [
        { x: 0, y: 0.5, w: 2, h: 1 },
        { x: -0.5, y: -0.5, w: 1, h: 1 },
        { x: 0.5, y: -0.5, w: 1, h: 1 },
      ];
    }
    return [
      { x: -0.5, y: 0.5, w: 1, h: 1 },
      { x: 0.5, y: 0.5, w: 1, h: 1 },
      { x: -0.5, y: -0.5, w: 1, h: 1 },
      { x: 0.5, y: -0.5, w: 1, h: 1 },
    ];
  }

  private renderSinglePlayerHud(s: {
    i: number;
    lap: number;
    pos: string;
    positionColor: string;
    itemEmoji: string;
    itemLabel: string;
    speed: string;
    speedFill: number;
    lastLap: string;
    derbyTopText: string;
    cpPassed: number;
    cpTotal: number;
    nextArrow: number;
    driftStatus: string;
    driftFill: number;
    driftGlow: string;
    blocks: number;
    blockDeltaText: string;
    chainFill: number;
    pulseOn: boolean;
    maxBlocks: number;
    isOut: boolean;
    bestLap: string;
    rivalItems: string;
    survivors: number;
  }): string {
    return `
      <div style="position:absolute;left:14px;top:14px;width:220px;background:linear-gradient(180deg,rgba(16,16,16,0.9),rgba(7,7,7,0.84));border:1px solid #343434;border-radius:8px;padding:8px;box-shadow:0 0 18px rgba(0,0,0,0.5)">
        <div style="font-size:10px;color:#a8a8a8;margin-bottom:4px;letter-spacing:0.7px">TRACK RADAR</div>
        <canvas data-minimap="1" width="220" height="126" style="width:100%;height:122px;border:1px solid #2d2d2d;border-radius:6px;background:#090909"></canvas>
      </div>

      <div style="position:absolute;left:50%;top:14px;transform:translateX(-50%);min-width:340px;max-width:68vw;background:linear-gradient(180deg,rgba(15,15,15,0.92),rgba(7,7,7,0.86));border:1px solid #363636;border-radius:10px;padding:10px 14px;box-shadow:0 0 20px rgba(0,0,0,0.45)">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:16px">
          <div>
            <div style="font-size:11px;color:#9a9a9a;letter-spacing:1px">RIDER</div>
            <div style="font-size:15px;font-weight:bold;color:#fff;letter-spacing:1px">${this.playerNames[s.i]}</div>
          </div>
          <div style="text-align:center">
            <div style="font-size:10px;color:#9b9b9b;letter-spacing:1px">${this.gameMode === 'derby' ? 'MATCH STATUS' : 'RACE PROGRESS'}</div>
            <div style="font-size:14px;color:#fff;font-weight:bold">${this.gameMode === 'derby' ? s.derbyTopText : `LAP ${s.lap}/${this.totalLaps} · BEST ${s.bestLap}`}</div>
          </div>
          <div style="text-align:right">
            <div style="font-size:11px;color:#9a9a9a;letter-spacing:1px">POSITION</div>
            <div style="font-size:34px;line-height:0.9;font-weight:900;color:${s.positionColor};text-shadow:0 0 16px ${s.positionColor}">${s.pos}</div>
          </div>
        </div>
      </div>

      <div style="position:absolute;right:14px;top:14px;width:180px;background:linear-gradient(180deg,rgba(16,16,16,0.92),rgba(7,7,7,0.86));border:1px solid #363636;border-radius:8px;padding:10px 10px 8px;box-shadow:0 0 18px rgba(0,0,0,0.45)">
        <div style="font-size:10px;color:#9a9a9a;letter-spacing:1px;margin-bottom:6px">HELD ITEM</div>
        <div style="display:flex;align-items:center;justify-content:space-between">
          <div style="width:58px;height:58px;border-radius:8px;border:1px solid #3a3a3a;background:linear-gradient(180deg,#1a1a1a,#0b0b0b);display:flex;align-items:center;justify-content:center;font-size:26px">${s.itemEmoji}</div>
          <div style="text-align:right;flex:1;margin-left:8px">
            <div style="font-size:11px;color:#f2f2f2;font-weight:bold;line-height:1.2">${s.itemLabel}</div>
            <div style="font-size:10px;color:#9a9a9a;margin-top:4px">RACE ${s.lastLap}</div>
            <div style="font-size:10px;color:#bebebe;margin-top:2px">${this.gameMode === 'derby' ? `ALIVE ${s.survivors}` : `CP ${s.cpPassed}/${s.cpTotal}`} <span style="display:inline-block;transform:rotate(${s.nextArrow.toFixed(2)}rad);margin-left:4px;color:#fff">▲</span></div>
          </div>
        </div>
      </div>

      <div style="position:absolute;left:14px;bottom:14px;width:248px;background:linear-gradient(180deg,rgba(16,16,16,0.94),rgba(6,6,6,0.9));border:1px solid #363636;border-radius:10px;padding:10px 12px;box-shadow:0 0 18px rgba(0,0,0,0.45)">
        <div style="display:flex;align-items:center;gap:10px">
          <div style="position:relative;width:86px;height:86px;display:flex;align-items:center;justify-content:center">
            <div style="width:86px;height:86px;border-radius:50%;background:
              radial-gradient(circle at center, #0a0a0a 36%, transparent 37%),
              conic-gradient(#f1f1f1 ${s.speedFill * 3.6}deg, #242424 0deg);
              border:1px solid #343434;">
            </div>
            <div style="position:absolute;text-align:center">
              <div style="font-size:23px;color:#fff;font-weight:bold;line-height:1">${s.speed}</div>
              <div style="font-size:9px;color:#8d8d8d;letter-spacing:0.7px">KM/H</div>
            </div>
          </div>
          <div style="flex:1">
            <div style="display:flex;justify-content:space-between;color:#8f8f8f;font-size:10px;margin-bottom:2px">
              <span>BOOST CHARGE</span><span>${Math.round(s.driftFill)}%</span>
            </div>
            <div style="height:6px;background:#1a1a1a;border:1px solid #2b2b2b;border-radius:4px;overflow:hidden">
              <div style="width:${s.driftFill}%;height:100%;background:linear-gradient(90deg,#6c6c6c,#ffffff);box-shadow:0 0 8px ${s.driftGlow}"></div>
            </div>
            <div style="margin-top:8px;font-size:11px;color:#afafaf">DRIFT <span style="color:#fff;text-shadow:0 0 8px ${s.driftGlow};font-weight:bold">${s.driftStatus}</span></div>
          </div>
        </div>
      </div>

      <div style="position:absolute;right:14px;bottom:14px;width:280px;background:linear-gradient(180deg,rgba(16,16,16,0.94),rgba(6,6,6,0.9));border:1px solid #363636;border-radius:10px;padding:10px 12px;box-shadow:0 0 18px rgba(0,0,0,0.45)">
        <div style="display:flex;justify-content:space-between;color:#8f8f8f;font-size:10px;margin-bottom:3px">
          <span>${this.gameMode === 'derby' ? 'HEALTH' : 'CHAIN'}</span>
          <span style="color:${s.isOut ? '#b0b0b0' : '#fff'}">${s.isOut ? 'ELIMINATED' : `${s.blocks} BLOCKS ${s.blockDeltaText}`}</span>
        </div>
        <div style="height:10px;background:#1a1a1a;border:1px solid #2b2b2b;border-radius:5px;overflow:hidden;position:relative">
          <div style="width:${s.chainFill}%;height:100%;background:linear-gradient(90deg,#5f5f5f,#d9d9d9)"></div>
          ${s.pulseOn ? `<div style="position:absolute;inset:0;background:rgba(255,255,255,0.18)"></div>` : ''}
        </div>
        <div style="margin-top:7px;display:flex;gap:2px">${this.renderChainPips(s.blocks, s.maxBlocks)}</div>
      </div>

      <div style="position:absolute;left:50%;bottom:14px;transform:translateX(-50%);max-width:52vw;background:rgba(8,8,8,0.78);border:1px solid #2a2a2a;border-radius:8px;padding:6px 10px;color:#9a9a9a;font-size:10px;line-height:1.2">
        <span style="color:#d0d0d0">RIVAL ITEMS:</span> ${s.rivalItems}
      </div>
    `;
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
