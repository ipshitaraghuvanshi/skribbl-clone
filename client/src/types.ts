export type WordMode = 'normal' | 'hidden' | 'combination';
export type Phase = 'lobby' | 'choosing' | 'drawing' | 'turn_end' | 'game_over';

export interface RoomSettings {
  maxPlayers: number;
  rounds: number;
  drawTime: number;
  wordCount: number;
  hints: number;
  wordMode: WordMode;
  isPrivate: boolean;
  category: string;
  customWords: string[];
  customWordsOnly: boolean;
}

export interface Player {
  id: string;
  name: string;
  avatar: string;
  score: number;
  isHost: boolean;
  isReady: boolean;
  hasGuessed: boolean;
  isDrawer: boolean;
  votesToKick: number;
}

export interface LeaderboardEntry {
  id: string;
  name: string;
  avatar: string;
  score: number;
  rank: number;
}

export interface TurnResult {
  word: string;
  reason: 'time_up' | 'all_guessed' | 'drawer_left';
  drawerId: string;
  scores: { id: string; name: string; points: number }[];
}

export interface GameState {
  roomId: string;
  hostId: string | null;
  settings: RoomSettings;
  players: Player[];
  votesNeeded: number;
  phase: Phase;
  round: number;
  totalRounds: number;
  drawerId: string | null;
  word: string | null;
  hint: string[] | null;
  wordLength: number;
  wordOptions: string[];
  timeLeftMs: number;
  phaseDurationMs: number;
  lastTurn: TurnResult | null;
  leaderboard: LeaderboardEntry[];
}

export interface ChatMessage {
  id: number;
  system?: boolean;
  tone?: 'info' | 'success' | 'warning' | 'danger';
  playerId?: string | null;
  playerName?: string | null;
  text: string;
  guessedGroup?: boolean;
}

export interface Point {
  x: number;
  y: number;
}

export interface Stroke {
  id: string;
  color: string;
  size: number;
  tool: 'brush' | 'eraser';
  points: Point[];
}

export interface PublicRoom {
  roomId: string;
  hostName: string;
  players: number;
  maxPlayers: number;
  phase: Phase;
  round: number;
  rounds: number;
}
