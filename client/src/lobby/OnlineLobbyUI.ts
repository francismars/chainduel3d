import { ChatMessage, GAME_CONFIG, GameMode, RoomState } from 'shared/types';
import QRCode from 'qrcode';

type RouteOption = { id: string; name: string };
const UI_FONT_FAMILY = "'Inter', 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif";

type EntryActions = {
  onBackToMode: () => void;
  onCreate: (name: string) => void | Promise<void>;
  onJoin: (code: string, name: string) => void | Promise<void>;
};

type RoomActions = {
  onBack: () => void;
  onPatchSettings: (settings: Partial<{ laps: number; aiCount: number; chainClasses: Array<'balanced' | 'light' | 'heavy'>; routeId: string; mode: GameMode; wager: any }>) => void | Promise<void>;
  onStart: () => void | Promise<void>;
  onSendChat: (text: string) => void;
  onKick: (memberId: string) => void | Promise<void>;
  onSetReady: (ready: boolean) => void | Promise<void>;
  onSetName: (name: string) => void | Promise<void>;
  onCreateDeposit: () => Promise<{ invoice: { bolt11: string; amountSat: number; paid: boolean } }>;
  onRefreshDeposits: () => Promise<{ deposits: Array<{ memberId: string; amountSat: number; paid: boolean }> }>;
};

export class OnlineLobbyUI {
  private container: HTMLElement;
  private chatListEl: HTMLDivElement | null = null;
  private codeEl: HTMLDivElement | null = null;
  private statusEl: HTMLDivElement | null = null;
  private room: RoomState | null = null;
  private meId: string | null = null;
  private startRacePending = false;
  private rosterTimerId: ReturnType<typeof setInterval> | null = null;
  private routes: RouteOption[] = [{ id: 'default', name: 'Genesis Route' }];
  private lobbyNameDraft: { roomId: string; memberId: string; value: string } | null = null;
  private pingLabelByMemberId = new Map<string, HTMLElement>();

  constructor(container: HTMLElement) {
    this.container = container;
  }

  setRoutes(routes: RouteOption[]) {
    this.routes = routes.length > 0 ? routes : [{ id: 'default', name: 'Genesis Route' }];
  }

  showEntry(actions: EntryActions, prefillCode = '') {
    this.clearRosterTimer();
    this.startRacePending = false;
    this.container.innerHTML = '';
    const compactLayout = window.innerHeight < 860;
    const wrap = document.createElement('div');
    wrap.style.cssText = `
      width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:${compactLayout ? 'flex-start' : 'center'};
      background:radial-gradient(circle at center,#070707 0%,#000 68%);
      color:#ddd;font-family:${UI_FONT_FAMILY}; overflow:auto;
      padding:${compactLayout ? '10px 10px 14px' : '18px 14px 22px'}; box-sizing:border-box;
    `;
    const card = document.createElement('div');
    card.style.cssText = `
      width:min(620px,92vw); border:1px solid #2e2e2e; border-radius:10px; background:#0a0a0a;
      padding:${compactLayout ? '14px' : '22px'}; box-shadow:0 0 22px rgba(255,255,255,0.08);
    `;
    wrap.appendChild(card);

    const title = document.createElement('div');
    title.textContent = 'ONLINE CHAIN HUB';
    title.style.cssText = `color:#fff;font-size:clamp(20px,4vw,24px);letter-spacing:2px;margin-bottom:${compactLayout ? '10px' : '14px'};`;
    card.appendChild(title);

    const nameInput = document.createElement('input');
    nameInput.value = 'Satoshi';
    nameInput.placeholder = 'Your name';
    nameInput.style.cssText = this.inputCss();
    card.appendChild(this.labelWrap('NAME', nameInput));

    const createBtn = document.createElement('button');
    createBtn.textContent = 'CREATE LOBBY';
    createBtn.style.cssText = this.primaryCtaCss();
    createBtn.onclick = () => void actions.onCreate((nameInput.value || 'Satoshi').trim());
    card.appendChild(createBtn);

    const joinRow = document.createElement('div');
    joinRow.style.cssText = `display:grid;grid-template-columns:1fr auto;gap:8px;margin-top:${compactLayout ? '8px' : '10px'};`;
    const codeInput = document.createElement('input');
    codeInput.placeholder = 'LOBBY CODE';
    if (prefillCode) codeInput.value = prefillCode.toUpperCase();
    codeInput.style.cssText = this.inputCss();
    joinRow.appendChild(codeInput);
    const joinBtn = document.createElement('button');
    joinBtn.textContent = 'JOIN';
    joinBtn.style.cssText = this.btnCss(false);
    joinBtn.onclick = () => void actions.onJoin(codeInput.value.trim().toUpperCase(), (nameInput.value || 'Satoshi').trim());
    joinRow.appendChild(joinBtn);
    card.appendChild(joinRow);

    const backBtn = document.createElement('button');
    backBtn.textContent = 'BACK';
    backBtn.style.cssText = this.secondaryBtnCss();
    backBtn.onclick = actions.onBackToMode;
    card.appendChild(backBtn);

    this.statusEl = document.createElement('div');
    this.statusEl.style.cssText = 'margin-top:8px;font-size:12px;color:#9c9c9c;min-height:18px;';
    card.appendChild(this.statusEl);
    if (prefillCode) {
      this.setStatus('Joining lobby from invite...');
      setTimeout(() => {
        void actions.onJoin(prefillCode.toUpperCase(), (nameInput.value || 'Satoshi').trim());
      }, 0);
    }

    this.decorateInteractiveElements(card);
    this.container.appendChild(wrap);
  }

  showRoom(room: RoomState, meId: string, actions: RoomActions) {
    this.clearRosterTimer();
    this.room = room;
    this.meId = meId;
    this.pingLabelByMemberId.clear();
    this.container.innerHTML = '';
    const me = room.members.find(m => m.memberId === meId);
    const isHost = me?.isHost ?? false;
    const meReady = me?.ready ?? false;
    if (room.phase !== 'lobby') this.startRacePending = false;
    if (
      this.lobbyNameDraft
      && (this.lobbyNameDraft.roomId !== room.roomId || this.lobbyNameDraft.memberId !== meId)
    ) {
      this.lobbyNameDraft = null;
    }
    if (this.lobbyNameDraft && me && this.lobbyNameDraft.value === me.name) {
      this.lobbyNameDraft = null;
    }

    const wrap = document.createElement('div');
    const compactLayout = window.innerWidth < 980;
    const compactHeight = window.innerHeight < 860;
    wrap.style.cssText = `
      width:100%;height:100%;display:grid;grid-template-columns:${compactLayout ? '1fr' : '1fr minmax(280px, 320px)'};gap:10px;
      padding:${compactHeight ? '8px' : '12px'};box-sizing:border-box;background:#050505;color:#ddd;font-family:${UI_FONT_FAMILY};
      overflow:auto; align-content:start;
    `;

    const left = document.createElement('div');
    left.style.cssText = `border:1px solid #2b2b2b;border-radius:8px;background:#090909;padding:${compactHeight ? '10px' : '12px'};`;
    const right = document.createElement('div');
    right.style.cssText = `border:1px solid #2b2b2b;border-radius:8px;background:#090909;padding:${compactHeight ? '10px' : '12px'};display:flex;flex-direction:column;min-height:${compactLayout ? '240px' : 'unset'};`;
    wrap.appendChild(left);
    wrap.appendChild(right);

    const top = document.createElement('div');
    top.style.cssText = `display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:${compactLayout ? 'wrap' : 'nowrap'};margin-bottom:8px;`;
    this.codeEl = document.createElement('div');
    this.codeEl.style.cssText = 'font-size:14px;color:#fff;';
    this.codeEl.textContent = `LOBBY ${room.code}`;
    top.appendChild(this.codeEl);
    const copyBtn = document.createElement('button');
    copyBtn.textContent = 'COPY INVITE LINK';
    copyBtn.style.cssText = this.btnCss(false);
    copyBtn.onclick = async () => {
      const url = `${location.origin}${location.pathname}?room=${encodeURIComponent(room.code)}`;
      await navigator.clipboard.writeText(url);
      this.setStatus('Invite link copied');
    };
    top.appendChild(copyBtn);
    left.appendChild(top);

    const roster = document.createElement('div');
    roster.style.cssText = 'font-size:13px;line-height:1.45;margin-bottom:10px;border:1px solid #242424;border-radius:6px;padding:8px;';
    const graceMs = 30_000;
    const renderRoster = () => {
      this.pingLabelByMemberId.clear();
      roster.innerHTML = '';
      const roomState = this.room ?? room;
      const sorted = [...roomState.members].sort((a, b) => a.slotIndex - b.slotIndex);
      for (const m of sorted) {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:8px;padding:3px 0;';
        const slot = m.slotIndex >= 0 ? `SLOT ${m.slotIndex + 1}` : 'SPECTATOR';
        const label = document.createElement('div');
        const hostText = m.isHost ? ' [HOST]' : '';
        if (!m.connected && m.disconnectedAt) {
          const leftMs = Math.max(0, graceMs - (Date.now() - m.disconnectedAt));
          const seconds = Math.ceil(leftMs / 1000);
          const readyText = m.ready ? ' [READY]' : '';
          label.innerHTML = `${slot}: ${m.name}${hostText}${readyText} <span style="color:#f3bf78;animation:offlinePulse 1.2s ease-in-out infinite">[OFFLINE ${seconds}s]</span>`;
        } else {
          const readyText = m.ready ? ' [READY]' : '';
          label.textContent = `${slot}: ${m.name}${hostText}${readyText}`;
          if (m.connected) {
            const ping = document.createElement('span');
            ping.textContent = typeof m.pingMs === 'number' ? ` [${Math.round(m.pingMs)}ms]` : '';
            ping.style.color = '#9f9f9f';
            label.appendChild(ping);
            this.pingLabelByMemberId.set(m.memberId, ping);
          } else {
            const offline = document.createElement('span');
            offline.textContent = ' [OFFLINE]';
            offline.style.color = '#f3bf78';
            label.appendChild(offline);
          }
        }
        row.appendChild(label);
        if (isHost && room.phase === 'lobby' && m.memberId !== meId && !m.isHost) {
          const kickBtn = document.createElement('button');
          kickBtn.textContent = 'KICK';
          kickBtn.style.cssText = `
            border:1px solid #3a2c2c;background:#150f0f;color:#ffb2b2;border-radius:4px;
            padding:4px 8px;cursor:pointer;font-size:10px;letter-spacing:0.7px;
          `;
          kickBtn.onclick = async () => {
            try {
              await actions.onKick(m.memberId);
              this.setStatus(`Removed ${m.name} from lobby`);
            } catch (err: any) {
              this.setStatus(err?.message ?? 'Failed to kick member');
            }
          };
          row.appendChild(kickBtn);
        }
        roster.appendChild(row);
      }
    };
    renderRoster();
    this.rosterTimerId = setInterval(renderRoster, 1000);
    left.appendChild(roster);

    if (room.phase === 'lobby' && me) {
      const nameRow = document.createElement('div');
      nameRow.style.cssText = 'display:grid;grid-template-columns:1fr auto;gap:8px;margin-bottom:10px;';
      const nameInput = document.createElement('input');
      nameInput.placeholder = 'Your name';
      nameInput.value = this.lobbyNameDraft?.roomId === room.roomId && this.lobbyNameDraft.memberId === meId
        ? this.lobbyNameDraft.value
        : me.name;
      nameInput.maxLength = 24;
      nameInput.style.cssText = this.inputCss();
      nameInput.addEventListener('input', () => {
        this.lobbyNameDraft = {
          roomId: room.roomId,
          memberId: meId,
          value: nameInput.value,
        };
      });
      nameRow.appendChild(nameInput);
      const saveNameBtn = document.createElement('button');
      saveNameBtn.textContent = 'UPDATE NAME';
      saveNameBtn.style.cssText = this.btnCss(false);
      const saveName = async () => {
        const next = nameInput.value.trim();
        if (!next) {
          this.setStatus('Name cannot be empty');
          return;
        }
        if (next === me.name) {
          this.setStatus('Name unchanged');
          return;
        }
        try {
          await actions.onSetName(next);
          this.lobbyNameDraft = {
            roomId: room.roomId,
            memberId: meId,
            value: next,
          };
          this.setStatus('Name updated');
        } catch (err: any) {
          this.setStatus(err?.message ?? 'Failed to update name');
        }
      };
      saveNameBtn.onclick = () => void saveName();
      nameInput.addEventListener('keydown', ev => {
        if (ev.key === 'Enter') void saveName();
      });
      nameRow.appendChild(saveNameBtn);
      left.appendChild(this.labelWrap('YOUR NAME', nameRow));
    }

    if (room.settings.wager?.enabled && room.settings.wager.amountSat > 0) {
      const depositCard = document.createElement('div');
      depositCard.style.cssText = 'margin-bottom:10px;padding:8px;border:1px solid #2a2a2a;border-radius:6px;background:#0a0a0a;';
      const depositTitle = document.createElement('div');
      depositTitle.textContent = `ESCROW DEPOSIT (${room.settings.wager.amountSat.toLocaleString()} sats/player)`;
      depositTitle.style.cssText = 'color:#fff;font-size:12px;letter-spacing:0.6px;margin-bottom:6px;';
      depositCard.appendChild(depositTitle);
      const depositStatus = document.createElement('div');
      depositStatus.style.cssText = 'font-size:11px;color:#9f9f9f;margin-bottom:6px;';
      depositStatus.textContent = 'Unknown deposit status.';
      depositCard.appendChild(depositStatus);
      const invoiceText = document.createElement('div');
      invoiceText.style.cssText = `
        display:none;margin-bottom:6px;padding:6px;border:1px solid #2b2b2b;border-radius:4px;
        background:#070707;font-size:10px;color:#cfcfcf;word-break:break-all;line-height:1.35;
      `;
      depositCard.appendChild(invoiceText);
      const invoiceQrWrap = document.createElement('div');
      invoiceQrWrap.style.cssText = 'display:none;margin-bottom:6px;';
      const invoiceQrLabel = document.createElement('div');
      invoiceQrLabel.textContent = 'SCAN INVOICE';
      invoiceQrLabel.style.cssText = 'font-size:10px;color:#9f9f9f;letter-spacing:0.5px;margin-bottom:4px;';
      const invoiceQrCanvas = document.createElement('canvas');
      invoiceQrCanvas.style.cssText = 'display:block;border:1px solid #2b2b2b;border-radius:4px;background:#000;';
      invoiceQrWrap.appendChild(invoiceQrLabel);
      invoiceQrWrap.appendChild(invoiceQrCanvas);
      depositCard.appendChild(invoiceQrWrap);
      const depositRow = document.createElement('div');
      depositRow.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:8px;';
      const invoiceBtn = document.createElement('button');
      invoiceBtn.textContent = 'GET MY INVOICE';
      invoiceBtn.style.cssText = this.btnCss(false);
      invoiceBtn.onclick = async () => {
        try {
          const out = await actions.onCreateDeposit();
          const bolt11 = out.invoice.bolt11;
          invoiceText.style.display = 'block';
          invoiceText.textContent = `BOLT11: ${bolt11}`;
          try {
            await QRCode.toCanvas(invoiceQrCanvas, bolt11, {
              width: 180,
              margin: 1,
              color: { dark: '#f0f0f0', light: '#0a0a0a' },
            });
            invoiceQrWrap.style.display = 'block';
          } catch {
            invoiceQrWrap.style.display = 'none';
          }
          try {
            await navigator.clipboard.writeText(bolt11);
            this.setStatus('Deposit invoice copied to clipboard.');
          } catch {
            this.setStatus('Deposit invoice created. Copy it from the box below.');
          }
        } catch (err: any) {
          this.setStatus(err?.message ?? 'Failed to create deposit invoice');
        }
      };
      depositRow.appendChild(invoiceBtn);
      const refreshBtn = document.createElement('button');
      refreshBtn.textContent = 'REFRESH STATUS';
      refreshBtn.style.cssText = this.btnCss(false);
      refreshBtn.onclick = async () => {
        try {
          const out = await actions.onRefreshDeposits();
          const paid = out.deposits.filter(d => d.paid).length;
          const total = out.deposits.length;
          depositStatus.textContent = `Deposits confirmed: ${paid}/${total}`;
          this.setStatus(`Deposits confirmed: ${paid}/${total}`);
        } catch (err: any) {
          this.setStatus(err?.message ?? 'Failed to refresh deposit status');
        }
      };
      depositRow.appendChild(refreshBtn);
      depositCard.appendChild(depositRow);
      left.appendChild(depositCard);
    }

    const classes = Array.from(
      { length: GAME_CONFIG.MAX_PLAYERS },
      (_, i) => room.settings.chainClasses?.[i] ?? 'balanced',
    );
    if (isHost) {
      const settingsRow = document.createElement('div');
      settingsRow.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:8px;';
      const lapsInput = document.createElement('input');
      lapsInput.type = 'number';
      lapsInput.min = '1';
      lapsInput.max = '9';
      lapsInput.value = String(room.settings.laps);
      lapsInput.disabled = room.phase !== 'lobby';
      lapsInput.style.cssText = this.inputCss();
      settingsRow.appendChild(this.labelWrap('LAPS', lapsInput));
      const aiInput = document.createElement('input');
      aiInput.type = 'number';
      aiInput.min = '0';
      aiInput.max = String(GAME_CONFIG.MAX_PLAYERS);
      aiInput.value = String(room.settings.aiCount);
      aiInput.disabled = room.phase !== 'lobby';
      aiInput.style.cssText = this.inputCss();
      settingsRow.appendChild(this.labelWrap('AI COUNT', aiInput));
      left.appendChild(settingsRow);

      const trackSelect = document.createElement('select');
      trackSelect.style.cssText = this.inputCss();
      trackSelect.disabled = room.phase !== 'lobby';
      const selectedRouteId = room.settings.routeId || 'default';
      for (const route of this.routes) {
        const opt = document.createElement('option');
        opt.value = route.id;
        opt.textContent = route.name;
        if (route.id === selectedRouteId) opt.selected = true;
        trackSelect.appendChild(opt);
      }
      left.appendChild(this.labelWrap('ROUTE', trackSelect));
      const modeSelect = document.createElement('select');
      modeSelect.style.cssText = this.inputCss();
      modeSelect.disabled = room.phase !== 'lobby';
      modeSelect.innerHTML = `
        <option value="classic"${(room.settings.mode ?? 'classic') === 'classic' ? ' selected' : ''}>CLASSIC RACE</option>
        <option value="derby"${room.settings.mode === 'derby' ? ' selected' : ''}>DERBY MODE</option>
        <option value="capture_sats"${room.settings.mode === 'capture_sats' ? ' selected' : ''}>CAPTURE SATS</option>
      `;
      left.appendChild(this.labelWrap('MODE', modeSelect));
      const wagerAmountInput = document.createElement('input');
      wagerAmountInput.type = 'number';
      wagerAmountInput.min = '0';
      wagerAmountInput.max = '5000000';
      wagerAmountInput.value = String(room.settings.wager?.amountSat ?? 0);
      wagerAmountInput.disabled = room.phase !== 'lobby';
      wagerAmountInput.style.cssText = this.inputCss();
      left.appendChild(this.labelWrap('WAGER (SATS)', wagerAmountInput));
      const wagerModeSelect = document.createElement('select');
      wagerModeSelect.style.cssText = this.inputCss();
      wagerModeSelect.disabled = room.phase !== 'lobby';
      wagerModeSelect.innerHTML = `
        <option value="for_keeps"${(room.settings.wager?.mode ?? 'for_keeps') === 'for_keeps' ? ' selected' : ''}>FOR KEEPS</option>
        <option value="capture_sats"${room.settings.wager?.mode === 'capture_sats' ? ' selected' : ''}>CAPTURE SATS</option>
      `;
      left.appendChild(this.labelWrap('WAGER MODE', wagerModeSelect));
      const winnerCountSelect = document.createElement('select');
      winnerCountSelect.style.cssText = this.inputCss();
      winnerCountSelect.disabled = room.phase !== 'lobby';
      const winnerCount = room.settings.wager?.winnerCount ?? 1;
      winnerCountSelect.innerHTML = `
        <option value="1"${winnerCount === 1 ? ' selected' : ''}>1 WINNER</option>
        <option value="2"${winnerCount === 2 ? ' selected' : ''}>2 WINNERS</option>
        <option value="3"${winnerCount === 3 ? ' selected' : ''}>3 WINNERS</option>
      `;
      left.appendChild(this.labelWrap('WINNER COUNT', winnerCountSelect));

      const classRow = document.createElement('div');
      classRow.style.cssText = 'display:grid;grid-template-columns:repeat(4, minmax(120px, 1fr));gap:8px;margin-top:8px;';
      const classSelects: HTMLSelectElement[] = [];
      for (let i = 0; i < GAME_CONFIG.MAX_PLAYERS; i++) {
        const sel = document.createElement('select');
        sel.style.cssText = this.inputCss();
        sel.disabled = room.phase !== 'lobby';
        for (const cc of ['balanced', 'light', 'heavy'] as const) {
          const opt = document.createElement('option');
          opt.value = cc;
          opt.textContent = cc.toUpperCase();
          if (classes[i] === cc) opt.selected = true;
          sel.appendChild(opt);
        }
        classSelects.push(sel);
        classRow.appendChild(this.labelWrap(`P${i + 1} CLASS`, sel));
      }
      left.appendChild(classRow);

      if (room.phase === 'lobby') {
        const applyBtn = document.createElement('button');
        applyBtn.textContent = 'APPLY SETTINGS';
        applyBtn.style.cssText = this.secondaryBtnCss();
        applyBtn.onclick = () => void actions.onPatchSettings({
          laps: Math.max(1, Math.min(9, parseInt(lapsInput.value || String(room.settings.laps), 10))),
          aiCount: Math.max(0, Math.min(GAME_CONFIG.MAX_PLAYERS, parseInt(aiInput.value || String(room.settings.aiCount), 10))),
          chainClasses: classSelects.map(s => {
            const v = s.value;
            return v === 'light' || v === 'heavy' ? v : 'balanced';
          }),
          routeId: trackSelect.value || 'default',
          mode: modeSelect.value === 'derby' ? 'derby' : modeSelect.value === 'capture_sats' ? 'capture_sats' : 'classic',
          wager: {
            enabled: Math.max(0, parseInt(wagerAmountInput.value || '0', 10)) > 0,
            practiceOnly: false,
            amountSat: Math.max(0, Math.min(5_000_000, parseInt(wagerAmountInput.value || '0', 10))),
            mode: wagerModeSelect.value === 'capture_sats' ? 'capture_sats' : 'for_keeps',
            winnerCount: winnerCountSelect.value === '3' ? 3 : winnerCountSelect.value === '2' ? 2 : 1,
            rankWeights: winnerCountSelect.value === '3'
              ? [0.6, 0.3, 0.1]
              : winnerCountSelect.value === '2'
                ? [0.7, 0.3]
                : [1],
          },
        });
        left.appendChild(applyBtn);
      }

      const allReady = room.members
        .filter(m => !m.isHost && m.slotIndex >= 0 && m.connected)
        .every(m => m.ready);
      const startBtn = document.createElement('button');
      startBtn.textContent = this.startRacePending && room.phase === 'lobby'
        ? 'STARTING...'
        : (room.phase === 'lobby' ? 'START DUEL' : 'DUEL STARTED');
      startBtn.disabled = room.phase !== 'lobby' || this.startRacePending || !allReady;
      startBtn.style.cssText = this.primaryCtaCss();
      startBtn.onclick = async () => {
        if (this.startRacePending) return;
        this.startRacePending = true;
        startBtn.textContent = 'STARTING...';
        startBtn.disabled = true;
        this.setStatus('Starting duel...');
        try {
          await actions.onStart();
        } catch (err: any) {
          this.startRacePending = false;
          startBtn.textContent = 'START DUEL';
          startBtn.disabled = room.phase !== 'lobby' || !allReady;
          this.setStatus(err?.message ?? 'Failed to start duel');
        }
      };
      left.appendChild(startBtn);
      if (!allReady && room.phase === 'lobby') {
        const waitNote = document.createElement('div');
        waitNote.textContent = 'WAITING FOR ALL CONNECTED PLAYERS TO MARK READY';
        waitNote.style.cssText = 'margin-top:6px;font-size:11px;color:#8f8f8f;letter-spacing:0.5px;';
        left.appendChild(waitNote);
      }
    } else {
      const summary = document.createElement('div');
      summary.style.cssText = 'margin-bottom:8px;padding:8px;border:1px solid #242424;border-radius:6px;background:#0b0b0b;font-size:12px;color:#bfbfbf;line-height:1.5;';
      summary.innerHTML = `
        <div style="color:#fff;margin-bottom:4px;">RACE SETTINGS (HOST CONTROLLED)</div>
        <div>LAPS: ${room.settings.laps}</div>
        <div>AI COUNT: ${room.settings.aiCount}</div>
        <div>ROUTE: ${this.routes.find(r => r.id === (room.settings.routeId || 'default'))?.name ?? room.settings.routeId}</div>
        <div>MODE: ${(room.settings.mode ?? 'classic').toUpperCase()}</div>
        <div>WAGER: ${(room.settings.wager?.amountSat ?? 0).toLocaleString()} sats (${room.settings.wager?.mode ?? 'for_keeps'})</div>
        <div>PAYOUT: TOP ${room.settings.wager?.winnerCount ?? 1}</div>
      `;
      left.appendChild(summary);
      if (room.phase === 'lobby' && (me?.slotIndex ?? -1) >= 0) {
        const readyBtn = document.createElement('button');
        readyBtn.textContent = meReady ? 'UNREADY' : 'MARK READY';
        readyBtn.style.cssText = meReady ? this.secondaryBtnCss() : this.primaryCtaCss();
        readyBtn.onclick = async () => {
          try {
            await actions.onSetReady(!meReady);
            this.setStatus(!meReady ? 'You are ready' : 'You are not ready');
          } catch (err: any) {
            this.setStatus(err?.message ?? 'Failed to update ready status');
          }
        };
        left.appendChild(readyBtn);
      }
    }

    const backBtn = document.createElement('button');
    backBtn.textContent = 'LEAVE LOBBY';
    backBtn.style.cssText = this.secondaryBtnCss();
    backBtn.onclick = actions.onBack;
    left.appendChild(backBtn);

    const chatTitle = document.createElement('div');
    chatTitle.textContent = 'LOBBY CHAT';
    chatTitle.style.cssText = 'color:#fff;font-size:14px;margin-bottom:8px;';
    right.appendChild(chatTitle);

    this.chatListEl = document.createElement('div');
    this.chatListEl.style.cssText = 'flex:1;border:1px solid #242424;border-radius:6px;padding:6px;overflow:auto;font-size:12px;line-height:1.45;background:#070707;';
    right.appendChild(this.chatListEl);
    this.renderChat(room.chat);

    const chatInputRow = document.createElement('div');
    chatInputRow.style.cssText = 'display:grid;grid-template-columns:1fr auto;gap:8px;margin-top:8px;';
    const chatInput = document.createElement('input');
    chatInput.placeholder = 'Message...';
    chatInput.style.cssText = this.inputCss();
    const sendBtn = document.createElement('button');
    sendBtn.textContent = 'SEND';
    sendBtn.style.cssText = this.btnCss(false);
    const send = () => {
      const text = chatInput.value.trim();
      if (!text) return;
      actions.onSendChat(text);
      chatInput.value = '';
    };
    sendBtn.onclick = send;
    chatInput.addEventListener('keydown', ev => {
      if (ev.key === 'Enter') send();
    });
    chatInputRow.appendChild(chatInput);
    chatInputRow.appendChild(sendBtn);
    right.appendChild(chatInputRow);

    this.statusEl = document.createElement('div');
    this.statusEl.style.cssText = 'margin-top:8px;font-size:12px;color:#9c9c9c;min-height:18px;';
    left.appendChild(this.statusEl);
    this.setStatus(room.phase === 'lobby' ? 'Waiting in lobby' : `Phase: ${room.phase}`);

    const style = document.createElement('style');
    style.textContent = `
      @keyframes offlinePulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.45; }
      }
    `;
    wrap.appendChild(style);

    this.decorateInteractiveElements(wrap);
    this.container.appendChild(wrap);
  }

  updateMemberPing(memberId: string, pingMs: number) {
    if (this.room) {
      const member = this.room.members.find(m => m.memberId === memberId);
      if (member) member.pingMs = pingMs;
    }
    const pingLabel = this.pingLabelByMemberId.get(memberId);
    if (pingLabel) pingLabel.textContent = ` [${Math.round(pingMs)}ms]`;
  }

  pushChat(msg: ChatMessage) {
    if (!this.chatListEl) return;
    const row = document.createElement('div');
    row.textContent = `${msg.name}: ${msg.text}`;
    this.chatListEl.appendChild(row);
    this.chatListEl.scrollTop = this.chatListEl.scrollHeight;
  }

  setStatus(text: string) {
    if (this.statusEl) this.statusEl.textContent = text;
  }

  private renderChat(messages: ChatMessage[]) {
    if (!this.chatListEl) return;
    this.chatListEl.innerHTML = '';
    for (const msg of messages) this.pushChat(msg);
  }

  private clearRosterTimer() {
    if (this.rosterTimerId !== null) {
      clearInterval(this.rosterTimerId);
      this.rosterTimerId = null;
    }
  }

  private labelWrap(label: string, el: HTMLElement): HTMLElement {
    const g = document.createElement('div');
    const l = document.createElement('div');
    l.textContent = label;
    l.style.cssText = 'font-size:11px;color:#8f8f8f;margin-bottom:4px;';
    g.appendChild(l);
    g.appendChild(el);
    return g;
  }

  private decorateInteractiveElements(root: HTMLElement) {
    const fields = root.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input, select');
    for (const field of fields) {
      field.style.transition = 'border-color 0.15s ease, box-shadow 0.15s ease, background-color 0.15s ease';
      field.style.fontFamily = UI_FONT_FAMILY;
      const idleBorder = field.style.borderColor || '#333';
      const hoverBorder = '#5a5a5a';
      const focusBorder = '#e9e9e9';
      field.addEventListener('mouseenter', () => {
        if (document.activeElement !== field && !field.disabled) field.style.borderColor = hoverBorder;
      });
      field.addEventListener('mouseleave', () => {
        if (document.activeElement !== field) field.style.borderColor = idleBorder;
      });
      field.addEventListener('focus', () => {
        if (field.disabled) return;
        field.style.borderColor = focusBorder;
        field.style.boxShadow = '0 0 0 2px rgba(255,255,255,0.15)';
      });
      field.addEventListener('blur', () => {
        field.style.borderColor = idleBorder;
        field.style.boxShadow = 'none';
      });
    }

    const buttons = root.querySelectorAll<HTMLButtonElement>('button');
    for (const button of buttons) {
      button.style.transition = 'transform 0.12s ease, box-shadow 0.2s ease, border-color 0.2s ease, opacity 0.2s ease';
      button.style.fontFamily = UI_FONT_FAMILY;
      button.addEventListener('mouseenter', () => {
        if (button.disabled) return;
        button.style.transform = 'translateY(-1px)';
        button.style.boxShadow = '0 6px 18px rgba(255,255,255,0.12)';
      });
      button.addEventListener('mouseleave', () => {
        button.style.transform = 'translateY(0)';
        button.style.boxShadow = 'none';
      });
      button.addEventListener('focus', () => {
        if (button.disabled) return;
        button.style.boxShadow = '0 0 0 2px rgba(255,255,255,0.18)';
      });
      button.addEventListener('blur', () => {
        button.style.boxShadow = 'none';
      });
    }
  }

  private inputCss() {
    return `
      width:100%; padding:10px; background:#111; border:1px solid #333; border-radius:6px;
      color:#f1f1f1; font-family:${UI_FONT_FAMILY}; font-size:14px; outline:none; box-sizing:border-box;
    `;
  }

  private btnCss(primary: boolean) {
    return `
      margin-top:8px; padding:10px 12px; border-radius:4px; cursor:pointer; border:1px solid ${primary ? '#efefef' : '#2f2f2f'};
      background:${primary ? 'linear-gradient(135deg,#efefef,#cfcfcf)' : '#101010'};
      color:${primary ? '#000' : '#ddd'}; font-family:${UI_FONT_FAMILY}; font-size:12px;
    `;
  }

  private secondaryBtnCss() {
    return `
      width:100%; margin-top:8px; padding:10px 12px; border-radius:4px; cursor:pointer; border:1px solid #2f2f2f;
      background:#090909;color:#9e9e9e; font-family:${UI_FONT_FAMILY}; font-size:12px; letter-spacing:0.8px;
    `;
  }

  private primaryCtaCss() {
    return `
      width:100%;
      margin-top:10px;
      padding:14px 12px;
      border-radius:4px;
      cursor:pointer;
      border:1px solid #efefef;
      background:linear-gradient(135deg,#efefef,#cfcfcf);
      color:#000;
      font-family:${UI_FONT_FAMILY};
      font-size:16px;
      font-weight:700;
      letter-spacing:1.2px;
    `;
  }
}

