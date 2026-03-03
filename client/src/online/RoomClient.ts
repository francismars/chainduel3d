import {
  ChatMessage,
  OnlineRaceSnapshot,
  OnlineRaceInput,
  GameMode,
  RouteCustomLayout,
  RoomClientMessage,
  RoomServerMessage,
  RoomState,
} from 'shared/types';

type Handlers = {
  onRoomState?: (room: RoomState) => void;
  onChatMessage?: (roomId: string, msg: ChatMessage) => void;
  onRaceSnapshot?: (roomId: string, snapshot: OnlineRaceSnapshot) => void;
  onError?: (message: string) => void;
};

export class RoomClient {
  private ws: WebSocket | null = null;
  private handlers: Handlers = {};
  private roomId: string | null = null;
  private memberId: string | null = null;
  private memberToken: string | null = null;
  private wsReady = false;

  setHandlers(handlers: Handlers) {
    this.handlers = handlers;
  }

  getIdentity() {
    return {
      roomId: this.roomId,
      memberId: this.memberId,
      memberToken: this.memberToken,
    };
  }

  setIdentity(roomId: string, memberId: string, memberToken: string) {
    this.roomId = roomId;
    this.memberId = memberId;
    this.memberToken = memberToken;
  }

  async createRoom(
    hostName: string,
    laps: number,
    aiCount: number,
    spectatorHost = false,
    routeId = 'default',
    mode: GameMode = 'classic',
  ) {
    const res = await fetch('/api/rooms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        hostName,
        settings: {
          laps,
          aiCount,
          maxHumans: 4,
          chainClasses: ['balanced', 'balanced', 'balanced', 'balanced'],
          routeId,
          mode,
        },
        spectatorHost,
      }),
    });
    if (!res.ok) throw new Error('Failed to create room');
    const data = await res.json();
    this.setIdentity(data.room.roomId, data.memberId, data.memberToken);
    await this.ensureSocket();
    this.subscribe();
    return data as { room: RoomState; memberId: string; memberToken: string };
  }

  async joinRoom(code: string, name: string) {
    const res = await fetch('/api/rooms/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: code.toUpperCase(), name }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Join failed' }));
      throw new Error(err.error ?? 'Join failed');
    }
    const data = await res.json();
    this.setIdentity(data.room.roomId, data.memberId, data.memberToken);
    await this.ensureSocket();
    this.subscribe();
    return data as { room: RoomState; memberId: string; memberToken: string };
  }

  async patchSettings(settings: Partial<{ laps: number; aiCount: number; chainClasses: Array<'balanced' | 'light' | 'heavy'>; routeId: string; mode: GameMode }>) {
    const id = this.getRequiredIdentity();
    await fetch(`/api/rooms/${id.roomId}/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        memberId: id.memberId,
        memberToken: id.memberToken,
        settings,
      }),
    });
  }

  async startRace(routeLayout?: RouteCustomLayout | null, routeId?: string) {
    const id = this.getRequiredIdentity();
    const res = await fetch(`/api/rooms/${id.roomId}/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        memberId: id.memberId,
        memberToken: id.memberToken,
        routeLayout: routeLayout ?? null,
        routeId,
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Failed to start race' }));
      throw new Error(err.error ?? 'Failed to start race');
    }
  }

  async kickMember(targetMemberId: string) {
    const id = this.getRequiredIdentity();
    const res = await fetch(`/api/rooms/${id.roomId}/kick`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        memberId: id.memberId,
        memberToken: id.memberToken,
        targetMemberId,
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Failed to kick member' }));
      throw new Error(err.error ?? 'Failed to kick member');
    }
  }

  async setReady(ready: boolean) {
    const id = this.getRequiredIdentity();
    const res = await fetch(`/api/rooms/${id.roomId}/ready`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        memberId: id.memberId,
        memberToken: id.memberToken,
        ready,
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Failed to update ready status' }));
      throw new Error(err.error ?? 'Failed to update ready status');
    }
  }

  async rematch() {
    const id = this.getRequiredIdentity();
    const res = await fetch(`/api/rooms/${id.roomId}/rematch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        memberId: id.memberId,
        memberToken: id.memberToken,
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Failed to return to lobby' }));
      throw new Error(err.error ?? 'Failed to return to lobby');
    }
    const data = await res.json();
    return data as { room: RoomState };
  }

  sendChat(text: string) {
    if (!text.trim()) return;
    const id = this.getRequiredIdentity();
    this.send({
      type: 'room_chat_send',
      roomId: id.roomId,
      memberId: id.memberId,
      memberToken: id.memberToken,
      text: text.trim(),
    });
  }

  sendInput(input: OnlineRaceInput) {
    const id = this.getRequiredIdentity();
    this.send({
      type: 'race_input',
      roomId: id.roomId,
      memberId: id.memberId,
      memberToken: id.memberToken,
      input,
    });
  }

  leave() {
    if (!this.roomId || !this.memberId || !this.memberToken) return;
    this.send({
      type: 'room_leave',
      roomId: this.roomId,
      memberId: this.memberId,
      memberToken: this.memberToken,
    });
  }

  disconnect() {
    this.ws?.close();
    this.ws = null;
    this.wsReady = false;
  }

  private subscribe() {
    const id = this.getRequiredIdentity();
    this.send({
      type: 'room_subscribe',
      roomId: id.roomId,
      memberId: id.memberId,
      memberToken: id.memberToken,
    });
  }

  private async ensureSocket() {
    if (this.ws && this.wsReady) return;
    if (this.ws && !this.wsReady) return;
    await new Promise<void>((resolve, reject) => {
      const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${protocol}//${location.host}/ws`);
      this.ws = ws;
      ws.onopen = () => {
        this.wsReady = true;
        resolve();
      };
      ws.onerror = () => reject(new Error('WebSocket connection failed'));
      ws.onclose = () => {
        this.wsReady = false;
      };
      ws.onmessage = ev => {
        try {
          const msg = JSON.parse(ev.data) as RoomServerMessage;
          if (msg.type === 'room_state') this.handlers.onRoomState?.(msg.room);
          else if (msg.type === 'chat_message') this.handlers.onChatMessage?.(msg.roomId, msg.message);
          else if (msg.type === 'race_snapshot') this.handlers.onRaceSnapshot?.(msg.roomId, msg.snapshot);
          else if (msg.type === 'error') this.handlers.onError?.(msg.message);
        } catch {
          // ignore malformed ws payloads
        }
      };
    });
  }

  private send(msg: RoomClientMessage) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify(msg));
  }

  private getRequiredIdentity() {
    if (!this.roomId || !this.memberId || !this.memberToken) throw new Error('Not in room');
    return {
      roomId: this.roomId,
      memberId: this.memberId,
      memberToken: this.memberToken,
    };
  }
}

