import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { socket } from '../socket';
import { Point, Stroke } from '../types';

/** Logical canvas resolution. Coordinates on the wire are normalised to 0..1 so any screen size works. */
const WIDTH = 800;
const HEIGHT = 600;

export const COLORS = [
  '#000000', '#4b5563', '#9ca3af', '#ffffff', '#7f1d1d', '#ef4444', '#f97316', '#facc15',
  '#84cc16', '#16a34a', '#06b6d4', '#2563eb', '#1e3a8a', '#7c3aed', '#db2777', '#f9a8d4',
  '#78350f', '#d97706',
];
export const SIZES = [2, 5, 10, 18, 30];

export interface CanvasHandle {
  replay: (strokes: Stroke[]) => void;
}

interface Props {
  isDrawer: boolean;
}

const strokeColor = (s: Stroke) => (s.tool === 'eraser' ? '#ffffff' : s.color);

function drawSegment(ctx: CanvasRenderingContext2D, s: Stroke, from: Point, to: Point) {
  ctx.strokeStyle = strokeColor(s);
  ctx.lineWidth = s.size;
  ctx.beginPath();
  ctx.moveTo(from.x * WIDTH, from.y * HEIGHT);
  ctx.lineTo(to.x * WIDTH, to.y * HEIGHT);
  ctx.stroke();
}

function drawDot(ctx: CanvasRenderingContext2D, s: Stroke, p: Point) {
  ctx.fillStyle = strokeColor(s);
  ctx.beginPath();
  ctx.arc(p.x * WIDTH, p.y * HEIGHT, s.size / 2, 0, Math.PI * 2);
  ctx.fill();
}

function drawStroke(ctx: CanvasRenderingContext2D, s: Stroke) {
  if (!s.points.length) return;
  drawDot(ctx, s, s.points[0]);
  for (let i = 1; i < s.points.length; i++) drawSegment(ctx, s, s.points[i - 1], s.points[i]);
}

const newId = () => `${socket.id ?? 'x'}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

const DrawingCanvas = forwardRef<CanvasHandle, Props>(function DrawingCanvas({ isDrawer }, ref) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const strokes = useRef<Stroke[]>([]);
  const current = useRef<Stroke | null>(null);
  const pending = useRef<Point[]>([]);
  const frame = useRef<number | null>(null);
  const replayTimer = useRef<number | null>(null);

  const [tool, setTool] = useState<'brush' | 'eraser'>('brush');
  const [color, setColor] = useState(COLORS[0]);
  const [size, setSize] = useState(SIZES[1]);

  const ctx = () => {
    const c = canvasRef.current?.getContext('2d');
    if (c) {
      c.lineCap = 'round';
      c.lineJoin = 'round';
    }
    return c ?? null;
  };

  const redraw = useCallback(() => {
    const c = ctx();
    if (!c) return;
    c.fillStyle = '#ffffff';
    c.fillRect(0, 0, WIDTH, HEIGHT);
    strokes.current.forEach((s) => drawStroke(c, s));
  }, []);

  const stopReplay = () => {
    if (replayTimer.current) window.clearInterval(replayTimer.current);
    replayTimer.current = null;
  };

  // ------------------------------------------------------------ incoming events (viewers)
  useEffect(() => {
    redraw();

    const onDrawData = (d: { type: 'start' | 'move' | 'end'; stroke?: Stroke; strokeId?: string; points?: Point[] }) => {
      stopReplay();
      const c = ctx();
      if (!c) return;
      if (d.type === 'start' && d.stroke) {
        strokes.current.push(d.stroke);
        drawDot(c, d.stroke, d.stroke.points[0]);
      } else if (d.type === 'move' && d.points) {
        const s = strokes.current.find((x) => x.id === d.strokeId);
        if (!s) return;
        d.points.forEach((p) => {
          drawSegment(c, s, s.points[s.points.length - 1], p);
          s.points.push(p);
        });
      }
    };
    const onClear = () => {
      stopReplay();
      strokes.current = [];
      current.current = null;
      redraw();
    };
    // undo + late join both send the authoritative list
    const onFullState = (d: { strokes: Stroke[] }) => {
      stopReplay();
      strokes.current = d.strokes.map((s) => ({ ...s, points: [...s.points] }));
      redraw();
    };

    socket.on('draw_data', onDrawData);
    socket.on('canvas_clear', onClear);
    socket.on('draw_undo', onFullState);
    socket.on('canvas_state', onFullState);
    // ask for the current drawing in case we mounted mid-turn (late join)
    socket.emit('request_canvas');
    return () => {
      socket.off('draw_data', onDrawData);
      socket.off('canvas_clear', onClear);
      socket.off('draw_undo', onFullState);
      socket.off('canvas_state', onFullState);
      stopReplay();
    };
  }, [redraw]);

  // ------------------------------------------------------------ replay of last drawing
  useImperativeHandle(ref, () => ({
    replay(list: Stroke[]) {
      stopReplay();
      const steps: { s: Stroke; i: number }[] = [];
      list.forEach((s) => s.points.forEach((_, i) => steps.push({ s, i })));
      if (!steps.length) return;
      strokes.current = [];
      redraw();
      const c = ctx();
      if (!c) return;
      const perTick = Math.max(1, Math.ceil(steps.length / 150)); // ~3 seconds
      let k = 0;
      replayTimer.current = window.setInterval(() => {
        for (let n = 0; n < perTick && k < steps.length; n++, k++) {
          const { s, i } = steps[k];
          if (i === 0) drawDot(c, s, s.points[0]);
          else drawSegment(c, s, s.points[i - 1], s.points[i]);
        }
        if (k >= steps.length) {
          stopReplay();
          strokes.current = list.map((s) => ({ ...s, points: [...s.points] }));
        }
      }, 20);
    },
  }));

  // ------------------------------------------------------------ local drawing (drawer)
  const toPoint = (e: React.PointerEvent): Point => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height)),
    };
  };

  /** Points are batched and sent once per animation frame to keep socket traffic low. */
  const flush = () => {
    frame.current = null;
    const s = current.current;
    if (!s || !pending.current.length) return;
    socket.emit('draw_move', { strokeId: s.id, points: pending.current });
    pending.current = [];
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawer || e.button > 0) return;
    stopReplay();
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = toPoint(e);
    const s: Stroke = { id: newId(), color, size, tool, points: [p] };
    current.current = s;
    strokes.current.push(s);
    const c = ctx();
    if (c) drawDot(c, s, p);
    socket.emit('draw_start', { strokeId: s.id, x: p.x, y: p.y, color, size, tool });
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const s = current.current;
    if (!isDrawer || !s) return;
    const p = toPoint(e);
    const last = s.points[s.points.length - 1];
    if (Math.abs(last.x - p.x) < 0.001 && Math.abs(last.y - p.y) < 0.001) return;
    const c = ctx();
    if (c) drawSegment(c, s, last, p);
    s.points.push(p);
    pending.current.push(p);
    if (frame.current == null) frame.current = requestAnimationFrame(flush);
  };

  const endStroke = () => {
    const s = current.current;
    if (!s) return;
    if (frame.current != null) cancelAnimationFrame(frame.current);
    flush();
    socket.emit('draw_end', { strokeId: s.id });
    current.current = null;
  };

  const undo = useCallback(() => socket.emit('draw_undo'), []);
  const clear = () => socket.emit('canvas_clear');

  // Ctrl/Cmd + Z for undo
  useEffect(() => {
    if (!isDrawer) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        undo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isDrawer, undo]);

  return (
    <div className="canvas-wrap">
      <canvas
        ref={canvasRef}
        width={WIDTH}
        height={HEIGHT}
        className={`canvas ${isDrawer ? 'drawing' : ''}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endStroke}
        onPointerCancel={endStroke}
        onLostPointerCapture={endStroke}
      />
      {isDrawer && (
        <div className="toolbar">
          <div className="colors">
            {COLORS.map((c) => (
              <button
                key={c}
                className={`swatch ${color === c && tool === 'brush' ? 'active' : ''}`}
                style={{ background: c }}
                aria-label={`Color ${c}`}
                onClick={() => {
                  setColor(c);
                  setTool('brush');
                }}
              />
            ))}
          </div>
          <div className="sizes">
            {SIZES.map((s) => (
              <button key={s} className={`size-btn ${size === s ? 'active' : ''}`} onClick={() => setSize(s)} aria-label={`Size ${s}`}>
                <span style={{ width: Math.max(4, s * 0.8), height: Math.max(4, s * 0.8), background: tool === 'eraser' ? '#9ca3af' : color }} />
              </button>
            ))}
          </div>
          <div className="tools">
            <button className={`tool-btn ${tool === 'brush' ? 'active' : ''}`} onClick={() => setTool('brush')} title="Brush">
              🖌️
            </button>
            <button className={`tool-btn ${tool === 'eraser' ? 'active' : ''}`} onClick={() => setTool('eraser')} title="Eraser">
              🧽
            </button>
            <button className="tool-btn" onClick={undo} title="Undo (Ctrl+Z)">
              ↶
            </button>
            <button className="tool-btn" onClick={clear} title="Clear canvas">
              🗑️
            </button>
          </div>
        </div>
      )}
    </div>
  );
});

export default DrawingCanvas;
