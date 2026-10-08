import type { Room } from '../models/Room';
import type { Player } from '../models/Player';
import { LeaderboardEntry, Phase } from '../types';
import { checkGuess } from '../utils/wordMatch';
import { ALL_WORDS, WORD_CATEGORIES, pickWords } from './words';

const CHOOSE_TIME_MS = 15_000;
const TURN_END_TIME_MS = 5_000;
const MAX_GUESS_POINTS = 500;
const MIN_GUESS_POINTS = 50;
const DRAWER_POINTS_PER_GUESS = 50;

export type TurnEndReason = 'time_up' | 'all_guessed' | 'drawer_left';

export interface TurnResult {
  word: string;
  reason: TurnEndReason;
  drawerId: string;
  scores: { id: string; name: string; points: number }[];
}

/**
 * Turn/round state machine for a single room.
 *
 * lobby -> choosing -> drawing -> turn_end -> (choosing ... ) -> game_over -> lobby
 *
 * A "round" = every player draws once. A "turn" = one drawer.
 * All timers are server-authoritative; clients only receive the remaining time.
 */
export class Game {
  phase: Phase = 'lobby';
  round = 0;
  drawerId: string | null = null;
  word: string | null = null;
  wordOptions: string[] = [];
  lastTurn: TurnResult | null = null;
  leaderboard: LeaderboardEntry[] = [];

  private drawerQueue: string[] = [];
  private revealed = new Set<number>();
  private usedWords = new Set<string>();
  private phaseEndsAt = 0;
  private phaseDurationMs = 0;
  private drawStartedAt = 0;
  private timer: NodeJS.Timeout | null = null;
  private ticker: NodeJS.Timeout | null = null;

  constructor(private readonly room: Room) {}

  get isRunning(): boolean {
    return this.phase !== 'lobby' && this.phase !== 'game_over';
  }

  get timeLeftMs(): number {
    return this.phaseEndsAt ? Math.max(0, this.phaseEndsAt - Date.now()) : 0;
  }

  get durationMs(): number {
    return this.phaseDurationMs;
  }

  // ---------------------------------------------------------------- lifecycle

  start(): void {
    this.stopTimers();
    this.room.players.forEach((p) => p.resetForGame());
    this.usedWords.clear();
    this.lastTurn = null;
    this.leaderboard = [];
    this.round = 0;
    this.room.chatSystem('The game has started!', 'info');
    this.nextRound();
  }

  /** Back to the lobby (after game over or when too many players left). */
  reset(): void {
    this.stopTimers();
    this.phase = 'lobby';
    this.round = 0;
    this.drawerId = null;
    this.word = null;
    this.wordOptions = [];
    this.phaseEndsAt = 0;
    this.room.players.forEach((p) => {
      p.isReady = false;
      p.hasGuessed = false;
    });
    this.room.board.clear();
    this.room.broadcast('canvas_clear', {});
    this.room.broadcastState();
  }

  stop(): void {
    this.stopTimers();
  }

  private nextRound(): void {
    this.round += 1;
    if (this.round > this.room.settings.rounds) {
      this.endGame();
      return;
    }
    // everyone currently in the room draws once this round, in join order
    this.drawerQueue = this.room.playerList.map((p) => p.id);
    this.room.chatSystem(`Round ${this.round} of ${this.room.settings.rounds}`, 'info');
    this.nextTurn();
  }

  private nextTurn(): void {
    let next: string | undefined;
    while ((next = this.drawerQueue.shift())) {
      if (this.room.players.has(next)) break;
    }
    if (!next) {
      this.nextRound();
      return;
    }
    this.startChoosing(next);
  }

  // ---------------------------------------------------------------- choosing

  private startChoosing(drawerId: string): void {
    this.stopTimers();
    this.phase = 'choosing';
    this.drawerId = drawerId;
    this.word = null;
    this.revealed.clear();
    this.room.players.forEach((p) => p.resetForTurn());
    this.room.board.clear();
    this.room.broadcast('canvas_clear', {});

    this.wordOptions = this.generateOptions();
    this.setPhaseTimer(CHOOSE_TIME_MS, () => this.chooseWord(drawerId, this.wordOptions[0]));

    const drawer = this.room.players.get(drawerId)!;
    // drawer gets the options, everyone else just learns who is choosing
    this.room.playerList.forEach((p) => {
      this.room.emitTo(p.id, 'round_start', {
        round: this.round,
        drawerId,
        drawerName: drawer.name,
        drawTime: this.room.settings.drawTime,
        wordOptions: p.id === drawerId ? this.wordOptions : [],
      });
    });
    this.room.broadcastState();
  }

  private generateOptions(): string[] {
    const s = this.room.settings;
    const builtIn = s.category !== 'all' && WORD_CATEGORIES[s.category] ? WORD_CATEGORIES[s.category] : ALL_WORDS;
    let pool = s.customWords.length ? (s.customWordsOnly ? s.customWords : [...builtIn, ...s.customWords]) : builtIn;
    if (pool.length < s.wordCount) pool = [...pool, ...ALL_WORDS];

    if (s.wordMode === 'combination') {
      // two words glued together, e.g. "fire truck"
      return Array.from({ length: s.wordCount }, () => pickWords(pool, 2, this.usedWords).join(' '));
    }
    return pickWords(pool, s.wordCount, this.usedWords);
  }

  chooseWord(playerId: string, word: string): boolean {
    if (this.phase !== 'choosing' || playerId !== this.drawerId) return false;
    if (!this.wordOptions.includes(word)) return false;
    this.word = word;
    this.usedWords.add(word);
    this.startDrawing();
    return true;
  }

  // ---------------------------------------------------------------- drawing

  private startDrawing(): void {
    this.phase = 'drawing';
    this.drawStartedAt = Date.now();
    const drawTimeMs = this.room.settings.drawTime * 1000;
    this.setPhaseTimer(drawTimeMs, () => this.endTurn('time_up'));
    this.ticker = setInterval(() => this.tick(), 1000);
    const drawer = this.room.players.get(this.drawerId!);
    this.room.chatSystem(`${drawer?.name ?? 'Someone'} is drawing now!`, 'info');
    this.room.broadcastState();
  }

  /** Reveals hint letters at evenly spaced moments during the turn. */
  private tick(): void {
    if (this.phase !== 'drawing' || !this.word) return;
    const { hints, wordMode, drawTime } = this.room.settings;
    if (hints <= 0 || wordMode === 'hidden') return;

    const letterIdx = [...this.word].map((c, i) => (c === ' ' ? -1 : i)).filter((i) => i >= 0);
    const maxReveal = Math.min(hints, Math.max(0, letterIdx.length - 1));
    const elapsed = (Date.now() - this.drawStartedAt) / 1000;
    const interval = drawTime / (hints + 1);
    const shouldHave = Math.min(maxReveal, Math.floor(elapsed / interval));

    let changed = false;
    while (this.revealed.size < shouldHave) {
      const hidden = letterIdx.filter((i) => !this.revealed.has(i));
      if (!hidden.length) break;
      this.revealed.add(hidden[Math.floor(Math.random() * hidden.length)]);
      changed = true;
    }
    if (changed) this.room.broadcastState();
  }

  /** "_ _ a _ _" style hint as a character array ("_" = hidden, " " = word gap). */
  hintFor(): string[] | null {
    if (!this.word) return null;
    if (this.room.settings.wordMode === 'hidden') return null;
    return [...this.word].map((c, i) => (c === ' ' ? ' ' : this.revealed.has(i) ? c : '_'));
  }

  // ---------------------------------------------------------------- guessing

  /**
   * Handles a chat line during the game. Returns true if it was consumed as a guess
   * (correct / close), false if it should be treated as a normal chat message.
   */
  handleGuess(player: Player, text: string): 'correct' | 'close' | 'chat' | 'private_chat' {
    if (this.phase !== 'drawing' || !this.word) return 'chat';
    // drawer and players who already guessed may only talk among themselves
    if (player.id === this.drawerId || player.hasGuessed) return 'private_chat';

    const verdict = checkGuess(text, this.word);
    if (verdict === 'close') return 'close';
    if (verdict === 'wrong') return 'chat';

    const drawTimeMs = this.room.settings.drawTime * 1000;
    const ratio = this.timeLeftMs / drawTimeMs;
    const points = Math.max(MIN_GUESS_POINTS, Math.round(MAX_GUESS_POINTS * ratio));
    player.hasGuessed = true;
    player.addPoints(points);
    this.room.players.get(this.drawerId!)?.addPoints(DRAWER_POINTS_PER_GUESS);

    this.room.broadcast('guess_result', {
      correct: true,
      playerId: player.id,
      playerName: player.name,
      points,
    });
    this.room.chatSystem(`${player.name} guessed the word!`, 'success');
    this.room.broadcastState();

    if (this.everyoneGuessed()) this.endTurn('all_guessed');
    return 'correct';
  }

  private everyoneGuessed(): boolean {
    const guessers = this.room.playerList.filter((p) => p.id !== this.drawerId);
    return guessers.length > 0 && guessers.every((p) => p.hasGuessed);
  }

  // ---------------------------------------------------------------- turn end

  endTurn(reason: TurnEndReason): void {
    if (this.phase !== 'drawing' && this.phase !== 'choosing') return;
    this.stopTimers();
    // if the drawer left while still choosing there is no word to reveal
    const word = this.word ?? '';
    this.phase = 'turn_end';

    this.lastTurn = {
      word,
      reason,
      drawerId: this.drawerId ?? '',
      scores: this.room.playerList
        .map((p) => ({ id: p.id, name: p.name, points: p.turnPoints }))
        .sort((a, b) => b.points - a.points),
    };

    const nextDrawer = this.drawerQueue.find((id) => this.room.players.has(id)) ?? null;
    this.room.broadcast('round_end', {
      word,
      reason,
      scores: this.lastTurn.scores,
      nextDrawer,
      drawing: this.room.board.snapshot(),
    });
    const reasonText =
      reason === 'all_guessed' ? 'Everyone guessed it!' : reason === 'drawer_left' ? 'The drawer left.' : "Time's up!";
    this.room.chatSystem(word ? `${reasonText} The word was "${word}".` : reasonText, 'info');

    this.setPhaseTimer(TURN_END_TIME_MS, () => this.nextTurn());
    this.room.broadcastState();
  }

  private endGame(): void {
    this.stopTimers();
    this.phase = 'game_over';
    this.phaseEndsAt = 0;
    this.drawerId = null;
    this.word = null;
    this.leaderboard = this.buildLeaderboard();
    const winner = this.leaderboard[0] ?? null;
    this.room.broadcast('game_over', { winner, leaderboard: this.leaderboard });
    if (winner) this.room.chatSystem(`${winner.name} won the game with ${winner.score} points!`, 'success');
    this.room.broadcastState();
  }

  buildLeaderboard(): LeaderboardEntry[] {
    const sorted = this.room.playerList.sort((a, b) => b.score - a.score);
    let rank = 0;
    let prevScore = -1;
    return sorted.map((p, i) => {
      if (p.score !== prevScore) rank = i + 1;
      prevScore = p.score;
      return { id: p.id, name: p.name, avatar: p.avatar, score: p.score, rank };
    });
  }

  // ---------------------------------------------------------------- membership

  onPlayerLeft(playerId: string): void {
    if (!this.isRunning) return;
    if (this.room.players.size < 2) {
      this.room.chatSystem('Not enough players - game ended.', 'warning');
      this.endGame();
      return;
    }
    if (playerId === this.drawerId && (this.phase === 'choosing' || this.phase === 'drawing')) {
      this.endTurn('drawer_left');
    } else if (this.phase === 'drawing' && this.everyoneGuessed()) {
      this.endTurn('all_guessed');
    }
  }

  // ---------------------------------------------------------------- timers

  private setPhaseTimer(ms: number, onDone: () => void): void {
    this.stopTimers();
    this.phaseDurationMs = ms;
    this.phaseEndsAt = Date.now() + ms;
    this.timer = setTimeout(onDone, ms);
  }

  private stopTimers(): void {
    if (this.timer) clearTimeout(this.timer);
    if (this.ticker) clearInterval(this.ticker);
    this.timer = null;
    this.ticker = null;
  }
}
