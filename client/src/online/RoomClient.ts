import {
  ChatMessage,
  OnlineRaceSnapshot,
  OnlineRaceInput,
  GAME_CONFIG,
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
  onMemberPing?: (roomId: string, memberId: string, pingMs: number) => void;
  onConnectionState?: (state: 'connecting' | 'connected' | 'subscribing' | 'subscribed' | 'reconnecting') => void;
  onError?: (message: string) => void;
};

export class RoomClient {
  private ws: WebSocket | null = null;
  private handlers: Handlers = {};
  private roomId: string | null = null;
  private memberId: string | null = null;
  private memberToken: string | null = null;
  private wsReady = false;
  private shouldReconnect = true;
  private reconnectAttempts = 0;
  private reconnectTimer: number | null = null;

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
    this.shouldReconnect = true;
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
          maxHumans: GAME_CONFIG.MAX_PLAYERS,
          chainClasses: Array.from({ length: GAME_CONFIG.MAX_PLAYERS }, () => 'balanced'),
          routeId,
          mode,
        },
        spectatorHost,
      }),
    });
    if (!res.ok) throw new Error('Failed to create room');
    const data = await res.json();
    this.setIdentity(data.room.roomId, data.memberId, data.memberToken);
    this.handlers.onConnectionState?.('connecting');
    await this.ensureSocket();
    this.handlers.onConnectionState?.('subscribing');
    this.subscribe();
    this.handlers.onConnectionState?.('subscribed');
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
    this.handlers.onConnectionState?.('connecting');
    await this.ensureSocket();
    this.handlers.onConnectionState?.('subscribing');
    this.subscribe();
    this.handlers.onConnectionState?.('subscribed');
    return data as { room: RoomState; memberId: string; memberToken: string };
  }

  async patchSettings(settings: Partial<{ laps: number; aiCount: number; chainClasses: Array<'balanced' | 'light' | 'heavy'>; routeId: string; mode: GameMode; wager: any }>) {
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

  async setName(name: string) {
    const id = this.getRequiredIdentity();
    const res = await fetch(`/api/rooms/${id.roomId}/name`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        memberId: id.memberId,
        memberToken: id.memberToken,
        name,
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Failed to update name' }));
      throw new Error(err.error ?? 'Failed to update name');
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

  async getSettlement() {
    const id = this.getRequiredIdentity();
    const params = new URLSearchParams({
      memberId: id.memberId,
      memberToken: id.memberToken,
    });
    const res = await fetch(`/api/rooms/${id.roomId}/settlement?${params.toString()}`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Failed to load settlement' }));
      throw new Error(err.error ?? 'Failed to load settlement');
    }
    return res.json() as Promise<{ settlement: any }>;
  }

  async createClaimTicket() {
    const id = this.getRequiredIdentity();
    const res = await fetch(`/api/rooms/${id.roomId}/settlement/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        memberId: id.memberId,
        memberToken: id.memberToken,
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Failed to create claim' }));
      throw new Error(err.error ?? 'Failed to create claim');
    }
    return res.json() as Promise<{ claimToken: string; amountSat: number }>;
  }

  async createDepositInvoice() {
    const id = this.getRequiredIdentity();
    const res = await fetch(`/api/rooms/${id.roomId}/deposits/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        memberId: id.memberId,
        memberToken: id.memberToken,
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Failed to create deposit invoice' }));
      throw new Error(err.error ?? 'Failed to create deposit invoice');
    }
    return res.json() as Promise<{ invoice: { paymentHash: string; bolt11: string; amountSat: number; paid: boolean } }>;
  }

  async getDepositStatus() {
    const id = this.getRequiredIdentity();
    const params = new URLSearchParams({
      memberId: id.memberId,
      memberToken: id.memberToken,
    });
    const res = await fetch(`/api/rooms/${id.roomId}/deposits/status?${params.toString()}`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Failed to fetch deposits status' }));
      throw new Error(err.error ?? 'Failed to fetch deposits status');
    }
    return res.json() as Promise<{ deposits: Array<{ memberId: string; amountSat: number; paid: boolean }> }>;
  }

  async redeemClaimTicket(claimToken: string) {
    const id = this.getRequiredIdentity();
    const res = await fetch(`/api/rooms/${id.roomId}/settlement/withdraw`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        memberId: id.memberId,
        memberToken: id.memberToken,
        claimToken,
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Failed to withdraw payout' }));
      throw new Error(err.error ?? 'Failed to withdraw payout');
    }
    return res.json() as Promise<{ lnurl: string | null; amount: number }>;
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
    this.shouldReconnect = false;
    this.send({
      type: 'room_leave',
      roomId: this.roomId,
      memberId: this.memberId,
      memberToken: this.memberToken,
    });
  }

  disconnect() {
    this.shouldReconnect = false;
    if (this.reconnectTimer != null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
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
        this.reconnectAttempts = 0;
        this.handlers.onConnectionState?.('connected');
        resolve();
      };
      ws.onerror = () => reject(new Error('WebSocket connection failed'));
      ws.onclose = () => {
        this.wsReady = false;
        if (this.shouldReconnect) this.scheduleReconnect();
      };
      ws.onmessage = ev => {
        try {
          const msg = JSON.parse(ev.data) as RoomServerMessage;
          if (msg.type === 'room_ping') {
            this.send({ type: 'room_pong', sentAt: msg.sentAt });
            return;
          }
          if (msg.type === 'room_state') this.handlers.onRoomState?.(msg.room);
          else if (msg.type === 'chat_message') this.handlers.onChatMessage?.(msg.roomId, msg.message);
          else if (msg.type === 'race_snapshot') this.handlers.onRaceSnapshot?.(msg.roomId, msg.snapshot);
          else if (msg.type === 'room_member_ping') this.handlers.onMemberPing?.(msg.roomId, msg.memberId, msg.pingMs);
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

  private scheduleReconnect() {
    if (!this.roomId || !this.memberId || !this.memberToken) return;
    if (this.reconnectTimer != null) return;
    const delayMs = Math.min(5000, 500 * Math.max(1, this.reconnectAttempts + 1));
    this.reconnectAttempts += 1;
    this.handlers.onConnectionState?.('reconnecting');
    this.reconnectTimer = window.setTimeout(async () => {
      this.reconnectTimer = null;
      try {
        this.handlers.onConnectionState?.('connecting');
        await this.ensureSocket();
        this.handlers.onConnectionState?.('subscribing');
        this.subscribe();
        this.handlers.onConnectionState?.('subscribed');
      } catch {
        this.scheduleReconnect();
      }
    }, delayMs);
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

