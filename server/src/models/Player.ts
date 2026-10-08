import { PublicPlayer } from '../types';

/** A connected participant. One Player per socket connection. */
export class Player {
  score = 0;
  isReady = false;
  hasGuessed = false;
  /** Points earned in the current turn (shown on the turn-end screen). */
  turnPoints = 0;
  /** Timestamp of the last chat message (simple rate limiting). */
  lastMessageAt = 0;

  constructor(
    public readonly id: string, // socket id
    public readonly clientId: string, // persistent browser id (used for bans)
    public name: string,
    public avatar: string,
  ) {}

  resetForGame(): void {
    this.score = 0;
    this.turnPoints = 0;
    this.hasGuessed = false;
  }

  resetForTurn(): void {
    this.turnPoints = 0;
    this.hasGuessed = false;
  }

  addPoints(points: number): void {
    this.score += points;
    this.turnPoints += points;
  }

  toPublic(extra: { isHost: boolean; isDrawer: boolean; votesToKick: number }): PublicPlayer {
    return {
      id: this.id,
      name: this.name,
      avatar: this.avatar,
      score: this.score,
      isReady: this.isReady,
      hasGuessed: this.hasGuessed,
      ...extra,
    };
  }
}
