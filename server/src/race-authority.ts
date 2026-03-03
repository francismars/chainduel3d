import { RoomManager, RoomState } from './room.js';

export class RaceAuthority {
  private timer: NodeJS.Timer | null = null;
  private readonly tickHz = 30;
  private rooms: RoomManager;
  private onRaceTick: (roomId: string, race: NonNullable<RoomState['race']>) => void;

  constructor(rooms: RoomManager, onRaceTick: (roomId: string, race: NonNullable<RoomState['race']>) => void) {
    this.rooms = rooms;
    this.onRaceTick = onRaceTick;
  }

  start() {
    if (this.timer) return;
    const stepMs = Math.floor(1000 / this.tickHz);
    this.timer = setInterval(() => {
      const roomIds = this.rooms.listActiveRaceRoomIds();
      for (const roomId of roomIds) {
        const race = this.rooms.tickRace(roomId, 1 / this.tickHz);
        if (race) this.onRaceTick(roomId, race);
      }
    }, stepMs);
  }

  stop() {
    if (!this.timer) return;
    clearInterval(this.timer as unknown as number);
    this.timer = null;
  }
}

