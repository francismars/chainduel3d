import { ChatMessage, GameMode, RoomState } from 'shared/types';

type RouteOption = { id: string; name: string };

type EntryActions = {
  onBackToMode: () => void;
  onCreate: (name: string, laps: number, aiCount: number, spectatorHost: boolean, routeId: string, mode: GameMode) => void | Promise<void>;
  onJoin: (code: string, name: string) => void | Promise<void>;
};

type RoomActions = {
  onBack: () => void;
  onPatchSettings: (settings: Partial<{ laps: number; aiCount: number; chainClasses: Array<'balanced' | 'light' | 'heavy'>; routeId: string; mode: GameMode }>) => void | Promise<void>;
  onStart: () => void | Promise<void>;
  onSendChat: (text: string) => void;
};

export class OnlineLobbyUI {
  private container: HTMLElement;
  private chatListEl: HTMLDivElement | null = null;
  private codeEl: HTMLDivElement | null = null;
  private statusEl: HTMLDivElement | null = null;
  private room: RoomState | null = null;
  private meId: string | null = null;
  private startRacePending = false;
  private routes: RouteOption[] = [{ id: 'default', name: 'Genesis Route' }];

  constructor(container: HTMLElement) {
    this.container = container;
  }

  setRoutes(routes: RouteOption[]) {
    this.routes = routes.length > 0 ? routes : [{ id: 'default', name: 'Genesis Route' }];
  }

  showEntry(actions: EntryActions) {
    this.startRacePending = false;
    this.container.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.style.cssText = `
      width:100%;height:100%;display:flex;align-items:center;justify-content:center;
      background:radial-gradient(circle at center,#070707 0%,#000 68%);
      color:#ddd;font-family:'Courier New', monospace;
    `;
    const card = document.createElement('div');
    card.style.cssText = `
      width:min(560px,92vw); border:1px solid #2e2e2e; border-radius:8px; background:#0a0a0a;
      padding:18px; box-shadow:0 0 22px rgba(255,255,255,0.08);
    `;
    wrap.appendChild(card);

    const title = document.createElement('div');
    title.textContent = 'ONLINE CHAIN HUB';
    title.style.cssText = 'color:#fff;font-size:24px;letter-spacing:2px;margin-bottom:14px;';
    card.appendChild(title);

    const nameInput = document.createElement('input');
    nameInput.value = 'Satoshi';
    nameInput.placeholder = 'Your name';
    nameInput.style.cssText = this.inputCss();
    card.appendChild(this.labelWrap('NAME', nameInput));

    const lapsInput = document.createElement('input');
    lapsInput.type = 'number';
    lapsInput.min = '1';
    lapsInput.max = '9';
    lapsInput.value = '3';
    lapsInput.style.cssText = this.inputCss();

    const aiInput = document.createElement('input');
    aiInput.type = 'number';
    aiInput.min = '0';
    aiInput.max = '3';
    aiInput.value = '2';
    aiInput.style.cssText = this.inputCss();

    const row = document.createElement('div');
    row.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:8px;';
    row.appendChild(this.labelWrap('LAPS', lapsInput));
    row.appendChild(this.labelWrap('AI COUNT', aiInput));
    card.appendChild(row);

    const trackSelect = document.createElement('select');
    trackSelect.style.cssText = this.inputCss();
    for (const route of this.routes) {
      const opt = document.createElement('option');
      opt.value = route.id;
      opt.textContent = route.name;
      trackSelect.appendChild(opt);
    }
    card.appendChild(this.labelWrap('ROUTE', trackSelect));
    const modeSelect = document.createElement('select');
    modeSelect.style.cssText = this.inputCss();
    modeSelect.innerHTML = `
      <option value="classic" selected>CLASSIC RACE</option>
      <option value="derby">DERBY MODE</option>
    `;
    card.appendChild(this.labelWrap('MODE', modeSelect));

    const spectateOnlyLabel = document.createElement('label');
    spectateOnlyLabel.style.cssText = `
      display:flex;align-items:center;gap:8px;margin-top:8px;
      font-size:12px;color:#bdbdbd;cursor:pointer;
    `;
    const spectateOnlyCheck = document.createElement('input');
    spectateOnlyCheck.type = 'checkbox';
    spectateOnlyCheck.style.cssText = 'accent-color:#d8d8d8;';
    spectateOnlyCheck.onchange = () => {
      if (spectateOnlyCheck.checked) {
        aiInput.value = '4';
        aiInput.disabled = true;
      } else {
        aiInput.disabled = false;
        aiInput.value = String(Math.max(0, Math.min(4, parseInt(aiInput.value || '2', 10) || 2)));
      }
    };
    spectateOnlyLabel.appendChild(spectateOnlyCheck);
    spectateOnlyLabel.appendChild(document.createTextNode('WATCH ONLY (spectator host + 4 AIs)'));
    card.appendChild(spectateOnlyLabel);

    const createBtn = document.createElement('button');
    createBtn.textContent = 'CREATE LOBBY';
    createBtn.style.cssText = this.btnCss(true);
    createBtn.onclick = () => {
      const laps = Math.max(1, Math.min(9, parseInt(lapsInput.value || '3', 10)));
      const ai = Math.max(0, Math.min(4, parseInt(aiInput.value || '2', 10)));
      void actions.onCreate(
        (nameInput.value || 'Satoshi').trim(),
        laps,
        ai,
        spectateOnlyCheck.checked,
        trackSelect.value || 'default',
        modeSelect.value === 'derby' ? 'derby' : 'classic',
      );
    };
    card.appendChild(createBtn);

    const joinRow = document.createElement('div');
    joinRow.style.cssText = 'display:grid;grid-template-columns:1fr auto;gap:8px;margin-top:10px;';
    const codeInput = document.createElement('input');
    codeInput.placeholder = 'LOBBY CODE';
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

    this.container.appendChild(wrap);
  }

  showRoom(room: RoomState, meId: string, actions: RoomActions) {
    this.room = room;
    this.meId = meId;
    this.container.innerHTML = '';
    const me = room.members.find(m => m.memberId === meId);
    const isHost = me?.isHost ?? false;
    if (room.phase !== 'lobby') this.startRacePending = false;

    const wrap = document.createElement('div');
    wrap.style.cssText = `
      width:100%;height:100%;display:grid;grid-template-columns:1fr 300px;gap:10px;
      padding:12px;box-sizing:border-box;background:#050505;color:#ddd;font-family:'Courier New', monospace;
    `;

    const left = document.createElement('div');
    left.style.cssText = 'border:1px solid #2b2b2b;border-radius:8px;background:#090909;padding:12px;';
    const right = document.createElement('div');
    right.style.cssText = 'border:1px solid #2b2b2b;border-radius:8px;background:#090909;padding:12px;display:flex;flex-direction:column;';
    wrap.appendChild(left);
    wrap.appendChild(right);

    const top = document.createElement('div');
    top.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;';
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
    roster.style.cssText = 'font-size:13px;line-height:1.6;margin-bottom:10px;border:1px solid #242424;border-radius:6px;padding:8px;';
    roster.innerHTML = room.members
      .sort((a, b) => a.slotIndex - b.slotIndex)
      .map(m => {
        const slot = m.slotIndex >= 0 ? `SLOT ${m.slotIndex + 1}` : 'SPECTATOR';
        return `${slot}: ${m.name}${m.isHost ? ' [HOST]' : ''}${m.connected ? '' : ' [OFFLINE]'}`;
      })
      .join('<br/>');
    left.appendChild(roster);

    const settingsRow = document.createElement('div');
    settingsRow.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:8px;';
    const lapsInput = document.createElement('input');
    lapsInput.type = 'number';
    lapsInput.min = '1';
    lapsInput.max = '9';
    lapsInput.value = String(room.settings.laps);
    lapsInput.disabled = !isHost || room.phase !== 'lobby';
    lapsInput.style.cssText = this.inputCss();
    settingsRow.appendChild(this.labelWrap('LAPS', lapsInput));
    const aiInput = document.createElement('input');
    aiInput.type = 'number';
    aiInput.min = '0';
    aiInput.max = '4';
    aiInput.value = String(room.settings.aiCount);
    aiInput.disabled = !isHost || room.phase !== 'lobby';
    aiInput.style.cssText = this.inputCss();
    settingsRow.appendChild(this.labelWrap('AI COUNT', aiInput));
    left.appendChild(settingsRow);

    const trackSelect = document.createElement('select');
    trackSelect.style.cssText = this.inputCss();
    trackSelect.disabled = !isHost || room.phase !== 'lobby';
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
    modeSelect.disabled = !isHost || room.phase !== 'lobby';
    modeSelect.innerHTML = `
      <option value="classic"${(room.settings.mode ?? 'classic') === 'classic' ? ' selected' : ''}>CLASSIC RACE</option>
      <option value="derby"${room.settings.mode === 'derby' ? ' selected' : ''}>DERBY MODE</option>
    `;
    left.appendChild(this.labelWrap('MODE', modeSelect));

    const classRow = document.createElement('div');
    classRow.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px;';
    const classes = room.settings.chainClasses ?? ['balanced', 'balanced', 'balanced', 'balanced'];
    const classSelects: HTMLSelectElement[] = [];
    for (let i = 0; i < 4; i++) {
      const sel = document.createElement('select');
      sel.style.cssText = this.inputCss();
      sel.disabled = !isHost || room.phase !== 'lobby';
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

    if (isHost && room.phase === 'lobby') {
      const applyBtn = document.createElement('button');
      applyBtn.textContent = 'APPLY SETTINGS';
      applyBtn.style.cssText = this.btnCss(false);
      applyBtn.onclick = () => void actions.onPatchSettings({
        laps: Math.max(1, Math.min(9, parseInt(lapsInput.value || String(room.settings.laps), 10))),
        aiCount: Math.max(0, Math.min(3, parseInt(aiInput.value || String(room.settings.aiCount), 10))),
        chainClasses: classSelects.map(s => {
          const v = s.value;
          return v === 'light' || v === 'heavy' ? v : 'balanced';
        }),
        routeId: trackSelect.value || 'default',
        mode: modeSelect.value === 'derby' ? 'derby' : 'classic',
      });
      left.appendChild(applyBtn);
    }

    const startBtn = document.createElement('button');
    startBtn.textContent = this.startRacePending && room.phase === 'lobby'
      ? 'STARTING...'
      : (room.phase === 'lobby' ? 'START DUEL' : 'DUEL STARTED');
    startBtn.disabled = !isHost || room.phase !== 'lobby' || this.startRacePending;
    startBtn.style.cssText = this.btnCss(true);
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
        startBtn.disabled = !isHost || room.phase !== 'lobby';
        this.setStatus(err?.message ?? 'Failed to start duel');
      }
    };
    left.appendChild(startBtn);

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

    this.container.appendChild(wrap);
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

  private labelWrap(label: string, el: HTMLElement): HTMLElement {
    const g = document.createElement('div');
    const l = document.createElement('div');
    l.textContent = label;
    l.style.cssText = 'font-size:11px;color:#8f8f8f;margin-bottom:4px;';
    g.appendChild(l);
    g.appendChild(el);
    return g;
  }

  private inputCss() {
    return `
      width:100%; padding:10px; background:#111; border:1px solid #333; border-radius:4px;
      color:#f1f1f1; font-family:'Courier New', monospace; font-size:14px; outline:none; box-sizing:border-box;
    `;
  }

  private btnCss(primary: boolean) {
    return `
      margin-top:8px; padding:10px 12px; border-radius:4px; cursor:pointer; border:1px solid ${primary ? '#efefef' : '#2f2f2f'};
      background:${primary ? 'linear-gradient(135deg,#efefef,#cfcfcf)' : '#101010'};
      color:${primary ? '#000' : '#ddd'}; font-family:'Courier New', monospace; font-size:12px;
    `;
  }

  private secondaryBtnCss() {
    return `
      margin-top:8px; padding:10px 12px; border-radius:4px; cursor:pointer; border:1px solid #2f2f2f;
      background:#090909;color:#9e9e9e; font-family:'Courier New', monospace; font-size:12px;
    `;
  }
}

