import type { Server } from 'socket.io';
import { Room } from './models/Room';
import { RoomSettings } from './types';

// no 0/O/1/I to keep codes easy to read out loud
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 6;

/** Registry of all live rooms. */
export class RoomManager {
  private readonly rooms = new Map<string, Room>();

  constructor(private readonly io: Server) {}

  create(settings: Partial<RoomSettings>): Room {
    const room = new Room(this.generateCode(), this.io, settings);
    this.rooms.set(room.id, room);
    return room;
  }

  get(roomId: string): Room | undefined {
    return this.rooms.get(String(roomId || '').toUpperCase().trim());
  }

  delete(roomId: string): void {
    this.rooms.get(roomId)?.dispose();
    this.rooms.delete(roomId);
  }

  /** Public rooms that still have space (games in progress can be joined too). */
  listPublic() {
    return [...this.rooms.values()]
      .filter((r) => !r.settings.isPrivate && !r.isFull && !r.isEmpty && r.game.phase !== 'game_over')
      .map((r) => r.summary());
  }

  /** Random open public room for "Quick play", preferring rooms still in the lobby. */
  findPublicRoom(clientId: string): Room | undefined {
    const open = [...this.rooms.values()].filter(
      (r) => !r.settings.isPrivate && !r.isFull && !r.isEmpty && !r.isBanned(clientId) && r.game.phase !== 'game_over',
    );
    const lobby = open.filter((r) => r.game.phase === 'lobby');
    const pool = lobby.length ? lobby : open;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  get size(): number {
    return this.rooms.size;
  }

  private generateCode(): string {
    let code: string;
    do {
      code = Array.from({ length: CODE_LENGTH }, () => CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]).join('');
    } while (this.rooms.has(code));
    return code;
  }
}
