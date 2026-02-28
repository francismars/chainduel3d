import { LobbyUI } from './lobby/LobbyUI';
import { OnlineLobbyUI } from './lobby/OnlineLobbyUI';
import { Game } from './game/Game';
import { ChainClass } from './game/Kart';
import { Track } from './game/Track';
import { PaymentUI } from './lobby/PaymentUI';
import { ResultUI } from './lobby/ResultUI';
import { ChatMessage, GAME_CONFIG, OnlineRaceSnapshot, RoomState, TrackCustomLayout, TrackDefinition } from 'shared/types';
import { RoomClient } from './online/RoomClient';

type AppState = 'mode' | 'lobby' | 'online_entry' | 'online_room' | 'admin' | 'payment' | 'racing' | 'result';
type TrackOption = { id: string; name: string };

class ChainRaceApp {
  private container: HTMLElement;
  private state: AppState = 'mode';
  private lobbyUI: LobbyUI;
  private onlineLobbyUI: OnlineLobbyUI;
  private paymentUI: PaymentUI;
  private resultUI: ResultUI;
  private roomClient: RoomClient;
  private game: Game | null = null;
  private sessionId: string | null = null;
  private wagerAmount: number = GAME_CONFIG.MIN_WAGER;
  private totalLaps: number = GAME_CONFIG.TOTAL_LAPS;
  private playerNames: string[] = ['Player 1', 'Player 2', 'Player 3', 'Player 4'];
  private isAI: boolean[] = [false, true, true, true];
  private chainClasses: ChainClass[] = ['balanced', 'balanced', 'balanced', 'balanced'];
  private onlineRoom: RoomState | null = null;
  private onlineMemberId: string | null = null;
  private onlineInviteCodeFromUrl: string | null = null;
  private latestRoomSnapshot: OnlineRaceSnapshot | null = null;
  private onlineFinishHandled = false;
  private onlineFinishTransitionTimeoutId: number | null = null;
  private selectedTrackId = 'default';
  private tracks: TrackOption[] = [{ id: 'default', name: 'Default Track' }];

  constructor() {
    this.container = document.getElementById('app')!;
    this.lobbyUI = new LobbyUI(this.container, this.onStartGame.bind(this));
    this.onlineLobbyUI = new OnlineLobbyUI(this.container);
    this.paymentUI = new PaymentUI(this.container);
    this.resultUI = new ResultUI(this.container);
    this.roomClient = new RoomClient();
    this.lobbyUI.setTracks(this.tracks);
    this.onlineLobbyUI.setTracks(this.tracks);
    this.roomClient.setHandlers({
      onRoomState: room => this.onRoomState(room),
      onChatMessage: (_roomId, msg) => this.onRoomChat(msg),
      onRaceSnapshot: (_roomId, snapshot) => {
        this.latestRoomSnapshot = snapshot;
        if (this.game && this.state === 'racing') {
          this.game.setOnlineSnapshot(snapshot);
        }
      },
      onError: msg => this.onlineLobbyUI.setStatus(msg),
    });
    const url = new URL(window.location.href);
    this.onlineInviteCodeFromUrl = url.searchParams.get('room');
    void this.refreshTracks();
    this.showModeMenu();
  }

  private showModeMenu() {
    this.state = 'mode';
    this.container.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.style.cssText = `
      width:100%;height:100%;display:flex;align-items:center;justify-content:center;
      background:radial-gradient(circle at center,#080808 0%,#000 70%);
      color:#f0f0f0;font-family:'Courier New', monospace;
    `;
    const card = document.createElement('div');
    card.style.cssText = `
      width:min(520px,92vw);background:#090909;border:1px solid #2b2b2b;border-radius:10px;
      padding:24px;box-shadow:0 0 24px rgba(255,255,255,0.08);
    `;
    wrap.appendChild(card);
    const title = document.createElement('div');
    title.textContent = 'CHAIN RACE';
    title.style.cssText = 'font-size:40px;letter-spacing:6px;color:#fff;text-align:center;margin-bottom:16px;';
    card.appendChild(title);
    const localBtn = document.createElement('button');
    localBtn.textContent = 'LOCAL';
    localBtn.style.cssText = this.modeBtnCss(true);
    localBtn.onclick = () => this.showLobby();
    card.appendChild(localBtn);
    const onlineBtn = document.createElement('button');
    onlineBtn.textContent = 'ONLINE';
    onlineBtn.style.cssText = this.modeBtnCss(false);
    onlineBtn.onclick = () => this.showOnlineEntry();
    card.appendChild(onlineBtn);
    const adminBtn = document.createElement('button');
    adminBtn.textContent = 'ADMIN';
    adminBtn.style.cssText = this.modeBtnCss(false);
    adminBtn.onclick = () => this.showAdminMenu();
    card.appendChild(adminBtn);
    this.container.appendChild(wrap);
    if (this.onlineInviteCodeFromUrl) {
      setTimeout(() => this.showOnlineEntry(this.onlineInviteCodeFromUrl!), 50);
    }
  }

  private modeBtnCss(primary: boolean): string {
    return `
      width:100%;padding:14px;margin-top:10px;border-radius:6px;cursor:pointer;
      border:1px solid ${primary ? '#efefef' : '#2f2f2f'};
      background:${primary ? 'linear-gradient(135deg,#efefef,#cdcdcd)' : '#101010'};
      color:${primary ? '#000' : '#ddd'};
      font-size:18px;letter-spacing:1px;font-family:'Courier New', monospace;
    `;
  }

  private showLobby() {
    this.state = 'lobby';
    this.container.innerHTML = '';
    this.lobbyUI.show();
  }

  private showOnlineEntry(prefillCode = '') {
    this.state = 'online_entry';
    this.onlineLobbyUI.showEntry({
      onBackToMode: () => this.showModeMenu(),
      onCreate: async (name, laps, aiCount, spectatorHost, trackId) => {
        try {
          this.selectedTrackId = trackId || 'default';
          const created = await this.roomClient.createRoom(name, laps, aiCount, spectatorHost, this.selectedTrackId);
          this.onlineMemberId = created.memberId;
          this.showOnlineRoom(created.room);
        } catch (err: any) {
          this.onlineLobbyUI.setStatus(err?.message ?? 'Failed to create room');
        }
      },
      onJoin: async (code, name) => {
        const joinCode = code || prefillCode;
        if (!joinCode) {
          this.onlineLobbyUI.setStatus('Enter a room code');
          return;
        }
        try {
          const joined = await this.roomClient.joinRoom(joinCode, name);
          this.onlineMemberId = joined.memberId;
          this.showOnlineRoom(joined.room);
        } catch (err: any) {
          this.onlineLobbyUI.setStatus(err?.message ?? 'Failed to join room');
        }
      },
    });
  }

  private showOnlineRoom(room: RoomState) {
    this.state = 'online_room';
    this.onlineRoom = room;
    if (!this.onlineMemberId) return;
    this.onlineLobbyUI.showRoom(room, this.onlineMemberId, {
      onBack: () => {
        this.roomClient.leave();
        this.roomClient.disconnect();
        this.onlineRoom = null;
        this.onlineMemberId = null;
        this.showModeMenu();
      },
      onPatchSettings: s => this.roomClient.patchSettings(s),
      onStart: () => this.roomClient.startRace(null, room.settings.trackId),
      onSendChat: txt => this.roomClient.sendChat(txt),
    });
  }

  private async onStartGame(
    playerNames: string[],
    isAI: boolean[],
    chainClasses: ChainClass[],
    wager: number,
    laps: number,
    skipPayment: boolean,
    trackId: string,
  ) {
    this.playerNames = playerNames;
    this.isAI = isAI;
    this.chainClasses = chainClasses;
    this.wagerAmount = wager;
    this.totalLaps = laps;
    this.selectedTrackId = trackId || 'default';

    if (!skipPayment) {
      this.state = 'payment';
      this.container.innerHTML = '';
      try {
        const res = await fetch('/api/sessions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ wagerAmount: wager, playerNames }),
        });
        if (!res.ok) throw new Error('Failed to create session');
        const data = await res.json();
        this.sessionId = data.sessionId;
        const paid = await this.paymentUI.show(data);
        if (!paid) {
          this.showLobby();
          return;
        }
      } catch {
        void this.startRace();
        return;
      }
    }

    void this.startRace();
  }

  private async startRace() {
    const trackLayout = await this.resolveTrackLayout(this.selectedTrackId);
    this.state = 'racing';
    this.container.innerHTML = '';
    this.game = new Game(
      this.container,
      this.playerNames,
      this.isAI,
      this.chainClasses,
      this.totalLaps,
      undefined,
      trackLayout,
      this.onRaceFinished.bind(this),
    );
    this.game.start();
  }

  private startOnlineRace(room: RoomState) {
    if (!this.onlineMemberId) return;
    const membersBySlot = [...room.members].sort((a, b) => a.slotIndex - b.slotIndex);
    const names = ['Player 1', 'Player 2', 'Player 3', 'Player 4'];
    const isAI = [true, true, true, true];
    for (const m of membersBySlot) {
      if (m.slotIndex < 0 || m.slotIndex >= 4) continue;
      names[m.slotIndex] = m.name;
      isAI[m.slotIndex] = false;
    }
    let aiToFill = room.settings.aiCount;
    for (let i = 0; i < 4; i++) {
      if (!isAI[i]) continue;
      if (aiToFill > 0) {
        names[i] = `AI ${i + 1}`;
        isAI[i] = true;
        aiToFill--;
      }
    }
    const localSlot = room.members.find(m => m.memberId === this.onlineMemberId)?.slotIndex ?? -1;
    this.state = 'racing';
    this.onlineFinishHandled = false;
    this.container.innerHTML = '';
    this.game = new Game(
      this.container,
      names,
      isAI,
      room.settings.chainClasses ?? ['balanced', 'balanced', 'balanced', 'balanced'],
      room.settings.laps,
      {
        enabled: true,
        roomId: room.roomId,
        memberId: this.onlineMemberId,
        localSlot,
        sendInput: input => this.roomClient.sendInput(input),
        getOnlineStartAt: () => this.onlineRoom?.race?.startedAt ?? null,
        trackLayout: room.race?.trackLayout ?? null,
      },
      null,
      this.onRaceFinished.bind(this),
    );
    if (this.latestRoomSnapshot) {
      this.game.setOnlineSnapshot(this.latestRoomSnapshot);
    }
    this.game.setOnlineStandings(room.race?.standings?.placementOrder ?? null);
    this.game.setOnlineRoster(room.members);
    this.game.setOnlineStartAt(room.race?.startedAt ?? null);
    this.game.start();
  }

  private async onRaceFinished(top3Ids: number[]) {
    this.onlineFinishHandled = false;
    if (this.onlineFinishTransitionTimeoutId !== null) {
      clearTimeout(this.onlineFinishTransitionTimeoutId);
      this.onlineFinishTransitionTimeoutId = null;
    }
    this.state = 'result';
    if (this.game) {
      this.game.dispose();
      this.game = null;
    }
    if (this.onlineRoom) {
      this.roomClient.leave();
      this.roomClient.disconnect();
      this.onlineRoom = null;
      this.onlineMemberId = null;
      this.latestRoomSnapshot = null;
    }

    const winnerId = top3Ids[0] ?? 0;
    const winnerName = this.playerNames[winnerId];
    const top3Names = top3Ids
      .slice(0, 3)
      .map(id => this.playerNames[id] ?? `Player ${id + 1}`);

    if (this.sessionId) {
      try {
        const res = await fetch(`/api/sessions/${this.sessionId}/result`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ winnerId: `player${winnerId + 1}` }),
        });
        if (res.ok) {
          const data = await res.json();
          this.resultUI.show(winnerName, top3Names, data.amount, data.lnurl, () => this.showModeMenu());
          return;
        }
      } catch { /* fall through to simple result */ }
    }

    this.resultUI.show(
      winnerName,
      top3Names,
      this.wagerAmount * 2 * (1 - GAME_CONFIG.REVENUE_SPLIT_PERCENT / 100),
      null,
      () => this.showModeMenu(),
    );
  }

  private async refreshTracks() {
    try {
      const res = await fetch('/api/tracks');
      if (!res.ok) return;
      const data = await res.json() as { tracks?: Array<{ id: string; name: string }> };
      const tracks = Array.isArray(data.tracks) && data.tracks.length > 0
        ? data.tracks.map(t => ({ id: t.id, name: t.name }))
        : [{ id: 'default', name: 'Default Track' }];
      this.tracks = tracks;
      if (!this.tracks.some(t => t.id === this.selectedTrackId)) this.selectedTrackId = this.tracks[0].id;
      this.lobbyUI.setTracks(this.tracks);
      this.onlineLobbyUI.setTracks(this.tracks);
    } catch {
      // Keep defaults offline.
    }
  }

  private async resolveTrackLayout(trackId: string): Promise<TrackCustomLayout | null> {
    try {
      const res = await fetch(`/api/tracks/${encodeURIComponent(trackId || 'default')}`);
      if (!res.ok) return null;
      const data = await res.json() as { track?: TrackDefinition };
      return data.track?.layout ?? null;
    } catch {
      return null;
    }
  }

  private showAdminMenu() {
    this.state = 'admin';
    this.container.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.style.cssText = `
      width:100%;height:100%;display:flex;align-items:center;justify-content:center;
      background:radial-gradient(circle at center,#080808 0%,#000 70%);
      color:#f0f0f0;font-family:'Courier New', monospace;
    `;
    const card = document.createElement('div');
    card.style.cssText = `
      width:min(680px,94vw);background:#090909;border:1px solid #2b2b2b;border-radius:10px;
      padding:20px;box-shadow:0 0 24px rgba(255,255,255,0.08);
    `;
    wrap.appendChild(card);
    const title = document.createElement('div');
    title.textContent = 'ADMIN TRACK CATALOG';
    title.style.cssText = 'font-size:24px;letter-spacing:2px;color:#fff;margin-bottom:12px;';
    card.appendChild(title);

    const secretInput = document.createElement('input');
    secretInput.type = 'password';
    secretInput.placeholder = 'TRACK ADMIN SECRET';
    secretInput.style.cssText = 'width:100%;padding:10px;border-radius:6px;border:1px solid #333;background:#101010;color:#e8e8e8;';
    card.appendChild(secretInput);

    const status = document.createElement('div');
    status.style.cssText = 'min-height:18px;color:#9b9b9b;font-size:12px;margin:8px 0 12px;';
    card.appendChild(status);

    const trackSelect = document.createElement('select');
    trackSelect.style.cssText = 'width:100%;padding:10px;border-radius:6px;border:1px solid #333;background:#101010;color:#e8e8e8;';
    for (const t of this.tracks) {
      const opt = document.createElement('option');
      opt.value = t.id;
      opt.textContent = `${t.name} (${t.id})`;
      trackSelect.appendChild(opt);
    }
    card.appendChild(trackSelect);

    const nameInput = document.createElement('input');
    nameInput.placeholder = 'Track name (for save/update)';
    nameInput.style.cssText = 'width:100%;padding:10px;border-radius:6px;border:1px solid #333;background:#101010;color:#e8e8e8;margin-top:8px;';
    card.appendChild(nameInput);

    const row = document.createElement('div');
    row.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px;';
    const openParamBtn = document.createElement('button');
    openParamBtn.textContent = 'OPEN PARAM EDITOR';
    openParamBtn.style.cssText = this.modeBtnCss(false);
    openParamBtn.onclick = () => this.lobbyUI.showTrackEditor();
    row.appendChild(openParamBtn);
    const openBuilderBtn = document.createElement('button');
    openBuilderBtn.textContent = 'OPEN GRAPHICAL BUILDER';
    openBuilderBtn.style.cssText = this.modeBtnCss(false);
    openBuilderBtn.onclick = () => this.lobbyUI.showGraphicalTrackBuilder();
    row.appendChild(openBuilderBtn);
    card.appendChild(row);

    const saveBtn = document.createElement('button');
    saveBtn.textContent = 'SAVE CURRENT BUILDER LAYOUT';
    saveBtn.style.cssText = this.modeBtnCss(true);
    saveBtn.onclick = async () => {
      const layout = Track.getCustomLayout();
      if (!layout) {
        status.textContent = 'No local builder layout found. Build one first.';
        return;
      }
      const selectedId = trackSelect.value || '';
      const payload = {
        id: selectedId === 'default' ? undefined : selectedId,
        name: nameInput.value.trim() || this.tracks.find(t => t.id === selectedId)?.name || 'Custom Track',
        layout,
      };
      const method = selectedId && selectedId !== 'default' ? 'PUT' : 'POST';
      const url = method === 'PUT' ? `/api/admin/tracks/${encodeURIComponent(selectedId)}` : '/api/admin/tracks';
      const res = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'x-admin-secret': secretInput.value,
        },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        status.textContent = `Save failed: ${res.status}`;
        return;
      }
      status.textContent = 'Track saved.';
      await this.refreshTracks();
      this.showAdminMenu();
    };
    card.appendChild(saveBtn);

    const deleteBtn = document.createElement('button');
    deleteBtn.textContent = 'DELETE SELECTED TRACK';
    deleteBtn.style.cssText = this.modeBtnCss(false);
    deleteBtn.onclick = async () => {
      const selectedId = trackSelect.value;
      if (!selectedId || selectedId === 'default') {
        status.textContent = 'Default track cannot be deleted.';
        return;
      }
      const res = await fetch(`/api/admin/tracks/${encodeURIComponent(selectedId)}`, {
        method: 'DELETE',
        headers: { 'x-admin-secret': secretInput.value },
      });
      if (!res.ok) {
        status.textContent = `Delete failed: ${res.status}`;
        return;
      }
      status.textContent = 'Track deleted.';
      await this.refreshTracks();
      this.showAdminMenu();
    };
    card.appendChild(deleteBtn);

    const backBtn = document.createElement('button');
    backBtn.textContent = 'BACK';
    backBtn.style.cssText = this.modeBtnCss(false);
    backBtn.onclick = () => this.showModeMenu();
    card.appendChild(backBtn);

    this.container.appendChild(wrap);
  }

  private onRoomState(room: RoomState) {
    this.onlineRoom = room;
    if (this.game && this.state === 'racing') {
      this.game.setOnlineStandings(room.race?.standings?.placementOrder ?? null);
      this.game.setOnlineRoster(room.members);
      this.game.setOnlineStartAt(room.race?.startedAt ?? null);
      if (room.phase === 'finished' && !this.onlineFinishHandled) {
        this.onlineFinishHandled = true;
        const top3 = (room.race?.standings?.placementOrder ?? []).slice(0, 3);
        const top3Resolved = top3.length > 0 ? top3 : [0, 1, 2];
        this.game.applyAuthoritativeRaceFinished(top3Resolved);
        this.onlineFinishTransitionTimeoutId = window.setTimeout(() => {
          this.onlineFinishTransitionTimeoutId = null;
          void this.onRaceFinished(top3Resolved);
        }, 2000);
      }
    }
    if (this.state === 'online_room' && this.onlineMemberId) {
      this.showOnlineRoom(room);
      if (room.phase === 'countdown' || room.phase === 'racing') {
        this.startOnlineRace(room);
      }
    }
    if (this.state === 'online_entry' && this.onlineMemberId) {
      this.showOnlineRoom(room);
    }
  }

  private onRoomChat(msg: ChatMessage) {
    if (this.state === 'online_room') this.onlineLobbyUI.pushChat(msg);
  }
}

new ChainRaceApp();
