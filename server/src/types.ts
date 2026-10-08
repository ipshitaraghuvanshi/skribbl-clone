export type WordMode = 'normal' | 'hidden' | 'combination';

export type Phase = 'lobby' | 'choosing' | 'drawing' | 'turn_end' | 'game_over';

export interface RoomSettings {
  maxPlayers: number; // 2-20
  rounds: number; // 2-10
  drawTime: number; // seconds, 15-240
  wordCount: number; // 1-5 options for the drawer
  hints: number; // 0-5 (0 = disabled)
  wordMode: WordMode;
  isPrivate: boolean;
  category: string; // 'all' or a category key
  customWords: string[];
  customWordsOnly: boolean;
}

export interface Point {
  x: number; // normalised 0..1
  y: number; // normalised 0..1
}

export interface Stroke {
  id: string;
  color: string;
  size: number;
  tool: 'brush' | 'eraser';
  points: Point[];
}

export interface PublicPlayer {
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
