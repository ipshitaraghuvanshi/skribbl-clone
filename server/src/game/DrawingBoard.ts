import { Point, Stroke } from '../types';

const MAX_STROKES = 2000;
const MAX_POINTS_PER_STROKE = 5000;

/**
 * Server-side copy of the canvas for the current turn.
 * Kept so that late joiners get the full drawing, undo can be applied
 * authoritatively, and the last turn's drawing can be replayed.
 */
export class DrawingBoard {
  private strokes: Stroke[] = [];

  get all(): Stroke[] {
    return this.strokes;
  }

  start(stroke: Stroke): boolean {
    if (this.strokes.length >= MAX_STROKES) return false;
    this.strokes.push({ ...stroke, points: stroke.points.slice(0, 1) });
    return true;
  }

  /** Appends points to an existing stroke; returns the points actually accepted. */
  move(strokeId: string, points: Point[]): Point[] {
    const stroke = this.find(strokeId);
    if (!stroke) return [];
    const room = MAX_POINTS_PER_STROKE - stroke.points.length;
    const accepted = points.slice(0, Math.max(0, room));
    stroke.points.push(...accepted);
    return accepted;
  }

  undo(): Stroke | undefined {
    return this.strokes.pop();
  }

  clear(): void {
    this.strokes = [];
  }

  snapshot(): Stroke[] {
    return this.strokes.map((s) => ({ ...s, points: [...s.points] }));
  }

  private find(id: string): Stroke | undefined {
    // the active stroke is almost always the last one
    for (let i = this.strokes.length - 1; i >= 0; i--) {
      if (this.strokes[i].id === id) return this.strokes[i];
    }
    return undefined;
  }
}
