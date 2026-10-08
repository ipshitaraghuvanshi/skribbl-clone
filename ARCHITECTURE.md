# Architecture

```
 Browser (React)                                   Node.js server
┌──────────────────────────┐   Socket.IO (ws)   ┌──────────────────────────────────────┐
│ App ─ useGame (state)    │ ◀──── game_state ── │ MessageHandler  (validate + route)   │
│  ├ Home / Lobby          │ ──── create_room ─▶ │      │                               │
│  └ GameView              │ ──── guess/chat ──▶ │ RoomManager ── Room ── Player[]      │
│      ├ DrawingCanvas ────┼─ draw_start/move ─▶ │                 ├── DrawingBoard     │
│      │   ◀───────────────┼──── draw_data ───── │                 └── Game (FSM+timers)│
│      ├ PlayerList        │                     │                                      │
│      └ Chat              │                     │ Express: /health, /api/rooms, static │
└──────────────────────────┘                     └──────────────────────────────────────┘
```

The server is the **single source of truth**. Clients only send intents (`draw_move`, `guess`, `word_chosen`, …); the server validates them, updates state, and pushes the result.

## 1. Server classes (OOP)

| Class | Responsibility |
|---|---|
| `RoomManager` | Creates rooms with unique 6-char codes, looks them up, lists public rooms, picks a random open room for quick play, deletes empty rooms. |
| `MessageHandler` | Attaches all socket listeners. Validates/sanitises every payload (names, colours, sizes, coordinates, text length, chat rate-limit) and delegates to `Room`/`Game`. Domain classes never see raw input. |
| `Room` | Players, host, settings (clamped by `sanitizeSettings`), ban list, votekick tally, the `DrawingBoard` and the `Game`. Owns **all** broadcasting helpers (`broadcast`, `broadcastExcept`, `emitTo`, `chatToGuessedGroup`, `broadcastState`). |
| `Game` | The round/turn state machine, timers, word options, hints and scoring. Talks to sockets only through its `Room`. |
| `Player` | Name, avatar, score, ready/guessed flags, points earned in the current turn. |
| `DrawingBoard` | Authoritative list of strokes for the current turn – used for late joiners, undo and replay. |

## 2. Game state machine

```
lobby ──start_game──▶ choosing ──word_chosen / 15s──▶ drawing ──time up / all guessed / drawer left──▶ turn_end ──5s──┐
  ▲                      ▲                                                                                              │
  │                      └──────────────────────────── next drawer in queue ◀───────────────────────────────────────────┤
  │                                                                                                                      │
  └──return_to_lobby (host)── game_over ◀── last round finished, or fewer than 2 players ◀─────────────────────────────┘
```

- **Round** = every player draws once. At the start of each round `drawerQueue` is filled with the current players in join order. Players who left are skipped; players who join mid-round guess now and draw from the next round.
- **Timers** live on the server (`setTimeout` for the phase end, a 1 s `setInterval` for hint reveals). Clients receive `timeLeftMs` and compute a local deadline, so client clock skew doesn't matter.
- **Disconnects**: drawer leaving ends the turn; host leaving promotes the next player; dropping below 2 players ends the game; an empty room is deleted.

### Personalised state

After every change `Room.broadcastState()` sends each player their own `game_state`. The real `word` is only included for the drawer, players who already guessed it, and during turn end / game over. Everyone else gets a `hint` array such as `["_", "_", "a", "_", "_"]` (or nothing in *Hidden* mode). Word options are only sent to the drawer. This makes it impossible to cheat by inspecting WebSocket traffic.

## 3. Real-time drawing

**Capture (drawer)** – `DrawingCanvas` listens to Pointer Events (mouse, pen and touch). Coordinates are normalised to `0..1` of the canvas size, so screens of any size render the same picture on a fixed 800×600 logical canvas.

1. `pointerdown` → create a stroke `{ id, color, size, tool }`, draw a dot locally, emit `draw_start`.
2. `pointermove` → draw the segment locally immediately (no network latency for the drawer), buffer the point, and flush the buffer **once per animation frame** as `draw_move { strokeId, points[] }`. This keeps traffic to ~60 messages/s max regardless of mouse polling rate.
3. `pointerup` → flush and emit `draw_end`.

**Relay (server)** – `MessageHandler.withDrawer` drops drawing events unless the sender is the current drawer and the phase is `drawing`. Accepted points are clamped, appended to the `DrawingBoard`, and relayed with `broadcastExcept(drawer)` as `draw_data { type: 'start' | 'move' | 'end' }`.

**Render (viewers)** – on `start` the stroke is added and a dot drawn; on `move` each new point is drawn as a segment from the previous point. Strokes are round-capped lines; the eraser is a white stroke.

**Undo / clear / late join** – the server pops the last stroke (or clears) and broadcasts the full authoritative stroke list (`draw_undo { strokes }`, `canvas_clear`). Clients redraw from scratch, so every screen ends up identical, including the drawer's. When `DrawingCanvas` mounts it emits `request_canvas` and receives `canvas_state { strokes }`, so players joining mid-turn see the drawing so far.

**Replay** – `round_end` carries a snapshot of the turn's strokes; the client animates them point by point over ~3 s.

## 4. Guessing and word matching

All chat lines go through `Game.handleGuess` (`utils/wordMatch.ts`):

- Normalisation: lower-case, accents stripped, `-`/`_` → space, punctuation removed, whitespace trimmed and collapsed.
- **Correct** if the normalised guess equals the word, or equals it with spaces removed (`icecream` = `ice cream`).
- **Close** if the Levenshtein distance is ≤ 1 (≤ 2 for words longer than 6 letters). Only the guesser sees "`'aple' is close!`"; it is not broadcast.
- **Partial matches never count** (`app` ≠ `apple`).
- A correct guess is never shown in chat; instead everyone gets `guess_result` and "*X guessed the word!*".
- The drawer and players who already guessed can still chat, but only with each other (`chatToGuessedGroup`), so they can't leak the answer.

## 5. Scoring

- Guesser: `max(50, round(500 × timeLeft / drawTime))` – faster guesses earn more.
- Drawer: +50 for each player who guesses correctly.
- Turn ends early when every guesser has guessed. Leaderboard uses standard competition ranking (ties share a rank).

## 6. WebSocket events

| Event | Direction | Payload |
|---|---|---|
| `create_room` | C→S (ack) | `{ hostName, avatar, clientId, settings }` → `{ ok, roomId }` |
| `join_room` | C→S (ack) | `{ roomId, playerName, avatar, clientId }` |
| `quick_play` / `list_rooms` | C→S (ack) | random public room / public room list |
| `player_joined` / `player_left` | S→C | `{ player, players }` / `{ playerId, players }` |
| `update_settings`, `set_ready`, `start_game` | C→S | host settings / ready toggle / start (host only) |
| `game_state` | S→C | personalised `{ phase, round, drawerId, word, hint, players, timeLeftMs, … }` |
| `round_start` | S→C | `{ round, drawerId, drawTime, wordOptions }` (options only for drawer) |
| `word_chosen` | C→S | `{ word }` |
| `round_end` | S→C | `{ word, reason, scores, nextDrawer, drawing }` |
| `game_over` | S→C | `{ winner, leaderboard }` |
| `draw_start` / `draw_move` / `draw_end` | C→S | `{ strokeId, x, y, color, size, tool }` / `{ strokeId, points }` / `{ strokeId }` |
| `draw_data` | S→C | `{ type, stroke \| strokeId+points }` |
| `canvas_clear` / `draw_undo` | C→S, S→C | – / `{ strokes }` |
| `request_canvas` → `canvas_state` | C→S → S→C | `{ strokes }` |
| `guess` / `chat` | C→S | `{ text }` |
| `guess_result` | S→C | `{ correct, close?, playerId, playerName, points }` |
| `chat_message` | S→C | `{ playerId, playerName, text }` or `{ system, tone, text }` |
| `kick_player` / `vote_kick` / `kicked` | C→S / S→C | `{ playerId, ban? }` / `{ reason }` |
| `return_to_lobby` | C→S | host, after game over |

## 7. Deployment notes

- One Node process serves the REST endpoints, the Socket.IO server and the static React build, so a single Render/Railway web service is enough and the client connects to the same origin (no CORS).
- Vercel/Netlify serverless functions can't hold long-lived WebSocket connections; if the frontend is hosted there, the Socket.IO backend must run on Render/Railway (`VITE_SERVER_URL` + `CORS_ORIGIN`).
- Game state is in memory, which is fine for a single instance. Scaling to several instances would need sticky sessions plus the Socket.IO Redis adapter and a shared store for rooms.
