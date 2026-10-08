import type { Server, Socket } from 'socket.io';
import { Player } from '../models/Player';
import { Room } from '../models/Room';
import { RoomManager } from '../RoomManager';
import { Point, RoomSettings } from '../types';

type Ack = (res: { ok: boolean; error?: string; [k: string]: unknown }) => void;

const MAX_NAME = 20;
const MAX_MESSAGE = 100;
const CHAT_COOLDOWN_MS = 250;
const MAX_POINTS_PER_MESSAGE = 200;
const AVATARS = ['😀', '😎', '🤠', '👻', '🐱', '🐶', '🦊', '🐼', '🐸', '🐵', '🦄', '🐙', '🤖', '👽', '🎃', '🐧'];

const cleanName = (name: unknown): string => {
  const n = String(name ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);
  return n || `Guest${Math.floor(Math.random() * 1000)}`;
};
const cleanAvatar = (a: unknown): string => (AVATARS.includes(String(a)) ? String(a) : AVATARS[0]);
const cleanClientId = (id: unknown, fallback: string): string => {
  const s = String(id ?? '').slice(0, 64);
  return /^[\w-]{6,64}$/.test(s) ? s : fallback;
};
const clamp01 = (n: unknown): number => {
  const v = Number(n);
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;
};
const toPoint = (p: any): Point => ({ x: clamp01(p?.x), y: clamp01(p?.y) });
const safeAck = (ack: unknown): Ack => (typeof ack === 'function' ? (ack as Ack) : () => undefined);

/**
 * Wires every socket event to the right Room / Game method.
 * All input validation lives here so the domain classes can trust their arguments.
 */
export class MessageHandler {
  constructor(
    private readonly io: Server,
    private readonly rooms: RoomManager,
  ) {}

  attach(socket: Socket): void {
    const on = (event: string, fn: (...args: any[]) => void) =>
      socket.on(event, (...args: any[]) => {
        try {
          fn(...args);
        } catch (err) {
          console.error(`[socket] error handling "${event}":`, err);
        }
      });

    // ------------------------------------------------------------ rooms & lobby
    on('create_room', (data: any, ack: unknown) => {
      const reply = safeAck(ack);
      const room = this.rooms.create((data?.settings ?? {}) as Partial<RoomSettings>);
      this.joinRoom(socket, room, data?.hostName, data?.avatar, data?.clientId);
      reply({ ok: true, roomId: room.id });
    });

    on('join_room', (data: any, ack: unknown) => {
      const reply = safeAck(ack);
      const room = this.rooms.get(data?.roomId);
      if (!room) return reply({ ok: false, error: 'Room not found. Check the code or link.' });
      const clientId = cleanClientId(data?.clientId, socket.id);
      if (room.isBanned(clientId)) return reply({ ok: false, error: 'You are banned from this room.' });
      if (room.isFull && !room.players.has(socket.id)) return reply({ ok: false, error: 'This room is full.' });
      this.joinRoom(socket, room, data?.playerName, data?.avatar, clientId);
      reply({ ok: true, roomId: room.id });
    });

    on('quick_play', (data: any, ack: unknown) => {
      const reply = safeAck(ack);
      const clientId = cleanClientId(data?.clientId, socket.id);
      const room = this.rooms.findPublicRoom(clientId) ?? this.rooms.create({ isPrivate: false });
      this.joinRoom(socket, room, data?.playerName, data?.avatar, clientId);
      reply({ ok: true, roomId: room.id });
    });

    on('list_rooms', (_data: unknown, ack: unknown) => {
      safeAck(ack)({ ok: true, rooms: this.rooms.listPublic() });
    });

    on('leave_room', () => this.leaveCurrentRoom(socket));

    on('update_settings', (data: any) => {
      this.withRoom(socket, (room) => room.updateSettings(socket.id, data?.settings ?? {}));
    });

    on('set_ready', (data: any) => {
      this.withRoom(socket, (room) => room.setReady(socket.id, !!data?.ready));
    });

    on('start_game', (_data: unknown, ack: unknown) => {
      const reply = safeAck(ack);
      this.withRoom(socket, (room) => {
        const error = room.startGame(socket.id);
        reply(error ? { ok: false, error } : { ok: true });
      });
    });

    on('return_to_lobby', () => {
      this.withRoom(socket, (room) => {
        if (socket.id === room.hostId && room.game.phase === 'game_over') room.game.reset();
      });
    });

    // ------------------------------------------------------------ moderation
    on('kick_player', (data: any, ack: unknown) => {
      const reply = safeAck(ack);
      this.withRoom(socket, (room) => {
        const error = room.kick(socket.id, String(data?.playerId), !!data?.ban);
        reply(error ? { ok: false, error } : { ok: true });
      });
    });

    on('vote_kick', (data: any, ack: unknown) => {
      const reply = safeAck(ack);
      this.withRoom(socket, (room) => {
        const error = room.voteKick(socket.id, String(data?.playerId));
        reply(error ? { ok: false, error } : { ok: true });
      });
    });

    // ------------------------------------------------------------ game
    on('word_chosen', (data: any) => {
      this.withRoom(socket, (room) => room.game.chooseWord(socket.id, String(data?.word ?? '')));
    });

    // ------------------------------------------------------------ drawing
    on('draw_start', (data: any) => {
      this.withDrawer(socket, (room) => {
        const stroke = {
          id: String(data?.strokeId ?? '').slice(0, 40),
          color: /^#[0-9a-f]{6}$/i.test(data?.color) ? data.color : '#000000',
          size: Math.min(60, Math.max(1, Number(data?.size) || 4)),
          tool: data?.tool === 'eraser' ? ('eraser' as const) : ('brush' as const),
          points: [toPoint(data)],
        };
        if (!stroke.id || !room.board.start(stroke)) return;
        room.broadcastExcept(socket.id, 'draw_data', { type: 'start', stroke });
      });
    });

    on('draw_move', (data: any) => {
      this.withDrawer(socket, (room) => {
        const raw = Array.isArray(data?.points) ? data.points : [data];
        const points = room.board.move(String(data?.strokeId ?? ''), raw.slice(0, MAX_POINTS_PER_MESSAGE).map(toPoint));
        if (points.length) room.broadcastExcept(socket.id, 'draw_data', { type: 'move', strokeId: data.strokeId, points });
      });
    });

    on('request_canvas', () => {
      this.withRoom(socket, (room) => socket.emit('canvas_state', { strokes: room.board.all }));
    });

    on('draw_end', (data: any) => {
      this.withDrawer(socket, (room) => {
        room.broadcastExcept(socket.id, 'draw_data', { type: 'end', strokeId: String(data?.strokeId ?? '') });
      });
    });

    on('canvas_clear', () => {
      this.withDrawer(socket, (room) => {
        room.board.clear();
        room.broadcast('canvas_clear', {});
      });
    });

    on('draw_undo', () => {
      this.withDrawer(socket, (room) => {
        room.board.undo();
        // send the authoritative stroke list so every client redraws identically
        room.broadcast('draw_undo', { strokes: room.board.all });
      });
    });

    // ------------------------------------------------------------ chat & guessing
    // "guess" and "chat" share one input box, the server decides what a line is.
    on('guess', (data: any) => this.handleText(socket, data?.text));
    on('chat', (data: any) => this.handleText(socket, data?.text));

    socket.on('disconnect', () => this.leaveCurrentRoom(socket));
  }

  // ---------------------------------------------------------------- helpers

  private joinRoom(socket: Socket, room: Room, name: unknown, avatar: unknown, clientId: unknown): void {
    if (socket.data.roomId === room.id && room.players.has(socket.id)) return;
    this.leaveCurrentRoom(socket);
    const player = new Player(socket.id, cleanClientId(clientId, socket.id), cleanName(name), cleanAvatar(avatar));
    socket.join(room.id);
    socket.data.roomId = room.id;
    room.addPlayer(player);
    // late joiners get the current drawing
    socket.emit('canvas_state', { strokes: room.board.all });
  }

  private leaveCurrentRoom(socket: Socket): void {
    const roomId: string | undefined = socket.data.roomId;
    if (!roomId) return;
    socket.data.roomId = undefined;
    socket.leave(roomId);
    const room = this.rooms.get(roomId);
    if (!room) return;
    room.removePlayer(socket.id);
    if (room.isEmpty) this.rooms.delete(room.id);
  }

  private withRoom(socket: Socket, fn: (room: Room) => void): void {
    const room = socket.data.roomId ? this.rooms.get(socket.data.roomId) : undefined;
    if (room && room.players.has(socket.id)) fn(room);
  }

  /** Only the current drawer, while drawing, may touch the canvas. */
  private withDrawer(socket: Socket, fn: (room: Room) => void): void {
    this.withRoom(socket, (room) => {
      if (room.game.phase === 'drawing' && room.game.drawerId === socket.id) fn(room);
    });
  }

  private handleText(socket: Socket, rawText: unknown): void {
    this.withRoom(socket, (room) => {
      const player = room.players.get(socket.id)!;
      const text = String(rawText ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_MESSAGE);
      if (!text) return;
      const now = Date.now();
      if (now - player.lastMessageAt < CHAT_COOLDOWN_MS) return;
      player.lastMessageAt = now;

      const message = { playerId: player.id, playerName: player.name, text };
      switch (room.game.handleGuess(player, text)) {
        case 'correct':
          return; // the word itself is never broadcast
        case 'close':
          socket.emit('guess_result', { correct: false, close: true, playerId: player.id, playerName: player.name, points: 0 });
          socket.emit('chat_message', { system: true, tone: 'warning', text: `'${text}' is close!` });
          return;
        case 'private_chat':
          room.chatToGuessedGroup({ ...message, guessedGroup: true });
          return;
        default:
          if (room.game.phase === 'drawing') {
            socket.emit('guess_result', { correct: false, playerId: player.id, playerName: player.name, points: 0 });
          }
          room.broadcast('chat_message', message);
      }
    });
  }
}
