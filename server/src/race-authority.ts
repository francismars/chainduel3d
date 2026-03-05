import { RoomManager, RoomState } from './room.js';

export class RaceAuthority {
  private timer: NodeJS.Timer | null = null;
  private readonly tickHz = 30;
  private rooms: RoomManager;
  private onRaceTick: (roomId: string, race: NonNullable<RoomState['race']>) => void;
  private onTickMetrics?: (metrics: { activeRooms: number; loopDurationMs: number }) => void;

  constructor(
    rooms: RoomManager,
    onRaceTick: (roomId: string, race: NonNullable<RoomState['race']>) => void,
    onTickMetrics?: (metrics: { activeRooms: number; loopDurationMs: number }) => void,
  ) {
    this.rooms = rooms;
    this.onRaceTick = onRaceTick;
    this.onTickMetrics = onTickMetrics;
  }

  start() {
    if (this.timer) return;
    const stepMs = Math.floor(1000 / this.tickHz);
    this.timer = setInterval(() => {
      const startedAt = Date.now();
      const roomIds = this.rooms.listActiveRaceRoomIds();
      for (const roomId of roomIds) {
        const race = this.rooms.tickRace(roomId, 1 / this.tickHz);
        if (race) this.onRaceTick(roomId, race);
      }
      this.onTickMetrics?.({
        activeRooms: roomIds.length,
        loopDurationMs: Date.now() - startedAt,
      });
    }, stepMs);
  }

  stop() {
    if (!this.timer) return;
    clearInterval(this.timer as unknown as number);
    this.timer = null;
  }
}

