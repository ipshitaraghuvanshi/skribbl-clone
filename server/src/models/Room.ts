import type { Server } from 'socket.io';
import { DrawingBoard } from '../game/DrawingBoard';
import { Game } from '../game/Game';
import { CATEGORY_KEYS } from '../game/words';
import { RoomSettings } from '../types';
import { Player } from './Player';

export const DEFAULT_SETTINGS: RoomSettings = {
  maxPlayers: 8,
  rounds: 3,
  drawTime: 80,
  wordCount: 3,
  hints: 2,
  wordMode: 'normal',
  isPrivate: true,
  category: 'all',
  customWords: [],
  customWordsOnly: false,
};

const clamp = (v: unknown, min: number, max: number, fallback: number): number => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

/** Validates/clamps arbitrary client input into a safe settings object. */
export function sanitizeSettings(input: Partial<RoomSettings> | undefined, base = DEFAULT_SETTINGS): RoomSettings {
  const s = input ?? {};
  const customWords = Array.isArray(s.customWords)
    ? Array.from(
        new Set(
          s.customWords
            .map((w) => String(w).trim().toLowerCase().slice(0, 30))
            .filter((w) => w.length >= 2),
        ),
      ).slice(0, 500)
    : base.customWords;
  return {
    maxPlayers: clamp(s.maxPlayers, 2, 20, base.maxPlayers),
    rounds: clamp(s.rounds, 2, 10, base.rounds),
    drawTime: clamp(s.drawTime, 15, 240, base.drawTime),
    wordCount: clamp(s.wordCount, 1, 5, base.wordCount),
    hints: clamp(s.hints, 0, 5, base.hints),
    wordMode: s.wordMode && ['normal', 'hidden', 'combination'].includes(s.wordMode) ? s.wordMode : base.wordMode,
    isPrivate: typeof s.isPrivate === 'boolean' ? s.isPrivate : base.isPrivate,
    category: s.category && CATEGORY_KEYS.includes(s.category) ? s.category : base.category,
    customWords,
    customWordsOnly: typeof s.customWordsOnly === 'boolean' ? s.customWordsOnly : base.customWordsOnly,
  };
}

export type SystemTone = 'info' | 'success' | 'warning' | 'danger';

/**
 * A room: participants, settings, moderation, the shared canvas and the Game.
 * Owns all broadcasting so that Game logic never touches sockets directly.
 */
export class Room {
  readonly players = new Map<string, Player>();
  readonly board = new DrawingBoard();
  readonly game: Game;
  hostId: string | null = null;
  settings: RoomSettings;
  readonly createdAt = Date.now();

  private readonly bannedClientIds = new Set<string>();
  /** targetId -> set of voter ids */
  private readonly kickVotes = new Map<string, Set<string>>();

  constructor(
    public readonly id: string,
    private readonly io: Server,
    settings: Partial<RoomSettings>,
  ) {
    this.settings = sanitizeSettings(settings);
    this.game = new Game(this);
  }

  // ---------------------------------------------------------------- membership

  get playerList(): Player[] {
    return [...this.players.values()];
  }

  get isFull(): boolean {
    return this.players.size >= this.settings.maxPlayers;
  }

  isBanned(clientId: string): boolean {
    return this.bannedClientIds.has(clientId);
  }

  addPlayer(player: Player): void {
    this.players.set(player.id, player);
    if (!this.hostId) this.hostId = player.id;
    this.broadcast('player_joined', { player: this.publicPlayer(player), players: this.publicPlayers() });
    this.chatSystem(`${player.name} joined the room.`, 'success');
    this.broadcastState();
  }

  removePlayer(playerId: string, reason: 'left' | 'kicked' | 'banned' = 'left'): void {
    const player = this.players.get(playerId);
    if (!player) return;
    this.players.delete(playerId);
    this.kickVotes.delete(playerId);
    this.kickVotes.forEach((voters) => voters.delete(playerId));

    if (this.hostId === playerId) {
      this.hostId = this.playerList[0]?.id ?? null;
      const newHost = this.hostId ? this.players.get(this.hostId) : null;
      if (newHost) this.chatSystem(`${newHost.name} is now the host.`, 'info');
    }

    this.broadcast('player_left', { playerId, players: this.publicPlayers() });
    const verb = reason === 'left' ? 'left the room' : reason === 'kicked' ? 'was kicked' : 'was banned';
    this.chatSystem(`${player.name} ${verb}.`, 'danger');
    this.game.onPlayerLeft(playerId);
    this.broadcastState();
  }

  get isEmpty(): boolean {
    return this.players.size === 0;
  }

  dispose(): void {
    this.game.stop();
  }

  // ---------------------------------------------------------------- lobby

  updateSettings(playerId: string, input: Partial<RoomSettings>): boolean {
    if (playerId !== this.hostId || this.game.isRunning) return false;
    this.settings = sanitizeSettings(input, this.settings);
    // never shrink below the current headcount
    this.settings.maxPlayers = Math.max(this.settings.maxPlayers, this.players.size);
    this.broadcastState();
    return true;
  }

  setReady(playerId: string, ready: boolean): void {
    const p = this.players.get(playerId);
    if (!p || this.game.isRunning) return;
    p.isReady = ready;
    this.broadcastState();
  }

  /** Returns an error message, or null when the game was started. */
  startGame(playerId: string): string | null {
    if (playerId !== this.hostId) return 'Only the host can start the game.';
    if (this.game.isRunning) return 'The game is already running.';
    if (this.players.size < 2) return 'At least 2 players are needed to start.';
    const notReady = this.playerList.filter((p) => p.id !== this.hostId && !p.isReady);
    if (notReady.length) return `Waiting for ${notReady.map((p) => p.name).join(', ')} to get ready.`;
    this.game.start();
    return null;
  }

  // ---------------------------------------------------------------- moderation

  kick(byId: string, targetId: string, ban: boolean): string | null {
    if (byId !== this.hostId) return 'Only the host can do that.';
    if (byId === targetId) return "You can't kick yourself.";
    return this.expel(targetId, ban ? 'banned' : 'kicked');
  }

  voteKick(byId: string, targetId: string): string | null {
    if (byId === targetId) return "You can't vote against yourself.";
    const target = this.players.get(targetId);
    const voter = this.players.get(byId);
    if (!target || !voter) return 'Player not found.';
    const voters = this.kickVotes.get(targetId) ?? new Set<string>();
    voters.add(byId);
    this.kickVotes.set(targetId, voters);
    const needed = this.votesNeeded();
    this.chatSystem(`${voter.name} voted to kick ${target.name} (${voters.size}/${needed}).`, 'warning');
    if (voters.size >= needed) return this.expel(targetId, 'banned');
    this.broadcastState();
    return null;
  }

  private votesNeeded(): number {
    return Math.max(2, Math.floor((this.players.size - 1) / 2) + 1);
  }

  private expel(targetId: string, reason: 'kicked' | 'banned'): string | null {
    const target = this.players.get(targetId);
    if (!target) return 'Player not found.';
    if (reason === 'banned') this.bannedClientIds.add(target.clientId);
    const socket = this.io.sockets.sockets.get(targetId);
    socket?.emit('kicked', { reason, roomId: this.id });
    if (socket) {
      socket.leave(this.id);
      socket.data.roomId = undefined;
    }
    this.removePlayer(targetId, reason);
    return null;
  }

  // ---------------------------------------------------------------- messaging

  broadcast(event: string, payload: unknown): void {
    this.io.to(this.id).emit(event, payload);
  }

  /** Broadcast to everyone in the room except one socket (used for drawing). */
  broadcastExcept(exceptId: string, event: string, payload: unknown): void {
    this.io.to(this.id).except(exceptId).emit(event, payload);
  }

  emitTo(playerId: string, event: string, payload: unknown): void {
    this.io.to(playerId).emit(event, payload);
  }

  chatSystem(text: string, tone: SystemTone = 'info'): void {
    this.broadcast('chat_message', { system: true, tone, text, playerId: null, playerName: null });
  }

  /** Messages from the drawer / players who already guessed are only shown to that group. */
  chatToGuessedGroup(payload: unknown): void {
    this.playerList
      .filter((p) => p.hasGuessed || p.id === this.game.drawerId)
      .forEach((p) => this.emitTo(p.id, 'chat_message', payload));
  }

  // ---------------------------------------------------------------- state

  publicPlayer(p: Player) {
    return p.toPublic({
      isHost: p.id === this.hostId,
      isDrawer: p.id === this.game.drawerId,
      votesToKick: this.kickVotes.get(p.id)?.size ?? 0,
    });
  }

  publicPlayers() {
    return this.playerList.map((p) => this.publicPlayer(p));
  }

  /** Personalised view of the game: the word is only revealed to people allowed to see it. */
  stateFor(playerId: string) {
    const g = this.game;
    const player = this.players.get(playerId);
    const isDrawer = playerId === g.drawerId;
    const canSeeWord = isDrawer || !!player?.hasGuessed || g.phase === 'turn_end' || g.phase === 'game_over';
    return {
      roomId: this.id,
      hostId: this.hostId,
      settings: this.settings,
      players: this.publicPlayers(),
      votesNeeded: this.votesNeeded(),
      phase: g.phase,
      round: g.round,
      totalRounds: this.settings.rounds,
      drawerId: g.drawerId,
      word: canSeeWord ? g.word : null,
      hint: g.phase === 'drawing' ? g.hintFor() : null,
      wordLength: g.word ? g.word.replace(/ /g, '').length : 0,
      wordOptions: isDrawer && g.phase === 'choosing' ? g.wordOptions : [],
      timeLeftMs: g.timeLeftMs,
      phaseDurationMs: g.durationMs,
      lastTurn: g.phase === 'turn_end' ? g.lastTurn : null,
      leaderboard: g.phase === 'game_over' ? g.leaderboard : [],
    };
  }

  broadcastState(): void {
    this.players.forEach((p) => this.emitTo(p.id, 'game_state', this.stateFor(p.id)));
  }

  summary() {
    const host = this.hostId ? this.players.get(this.hostId) : null;
    return {
      roomId: this.id,
      hostName: host?.name ?? '-',
      players: this.players.size,
      maxPlayers: this.settings.maxPlayers,
      phase: this.game.phase,
      round: this.game.round,
      rounds: this.settings.rounds,
    };
  }
}
