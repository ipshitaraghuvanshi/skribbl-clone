# Scribble – a skribbl.io clone

A real-time multiplayer drawing & guessing game. One player draws a word, everyone else races to guess it in the chat. Built with **React + TypeScript + Vite** on the frontend and **Node.js + Express + Socket.IO** on the backend.

**Live demo:** https://YOUR-APP-NAME.onrender.com  ← _replace after deploying (see [Deployment](#deployment))_

---

## Features

**Must have**
- Create a room with configurable settings; join via invite link (`/?room=CODE`) or 6-letter room code
- Lobby with player list, ready-up, host-only start
- Turn-based rounds – every player draws once per round, everyone else guesses
- Real-time drawing sync over WebSockets (strokes, undo, clear)
- Drawer picks 1 of N words (1–5)
- Points for correct guesses (faster = more), drawer earns points per correct guess
- Live leaderboard, winner podium at game end, "Play again"
- Drawing tools: brush, 18 colours, 5 sizes, eraser, undo (Ctrl+Z), clear

**Should have**
- Hints: letters revealed at evenly spaced intervals (0–5 hints)
- Chat + guessing in one box; "close" guesses told privately; players who guessed / the drawer chat in a private group
- Server-authoritative countdown timer
- Private (invite-only) and public rooms, public room browser and **Play!** quick-match

**Nice to have / bonus**
- Word categories (animals, food, objects, actions, places, nature, vehicles, sports)
- Custom word list (optionally "custom words only")
- Word modes: Normal, Hidden (no hint at all), Combination (two words)
- Moderation: host kick / ban, votekick (majority)
- Emoji avatars
- Replay of the last turn's drawing
- OOP server: `Room`, `Game`, `Player`, `DrawingBoard`, `RoomManager`, `MessageHandler`
- Responsive layout (works on phones, touch drawing supported)

### Room settings

| Setting | Range |
|---|---|
| Max players | 2–20 |
| Rounds | 2–10 |
| Draw time | 15–240 s |
| Word count | 1–5 |
| Hints | disabled, 1–5 |
| Word mode | Normal / Hidden / Combination |
| Category | All or a single category |
| Visibility | Private / Public |
| Custom words | comma separated list |

---

## Running locally

Requirements: **Node.js 18+** (nothing needs to be installed globally).

```bash
# 1. install dependencies for server and client (local node_modules only)
npm run install:all

# 2. start the backend (http://localhost:3001) – terminal 1
npm run dev:server

# 3. start the frontend (http://localhost:5173) – terminal 2
npm run dev:client
```

Open http://localhost:5173 in two different browser windows (or one normal + one incognito) to play against yourself.

### Production build locally

```bash
npm run build   # installs deps, builds client (client/dist) and server (server/dist)
npm start       # serves the API, WebSockets and the built client on http://localhost:3001
```

### Tests

```bash
npm test
```

Boots a real server and drives a whole turn with three Socket.IO clients: room creation, join by code, max players, ready-up, host-only start, word options only for the drawer, hidden word for guessers, stroke sync, undo, rejecting strokes from non-drawers, close/correct guesses, scoring, turn end, kick/ban, and game over.

---

## Deployment

The server serves the built React app itself, so the whole game is **one web service** – no CORS or separate WebSocket host needed.

### Render (recommended – supports WebSockets on the free plan)

1. Push this repo to GitHub.
2. On [render.com](https://render.com) → **New → Blueprint** → pick the repo (it reads `render.yaml`).
   Or **New → Web Service** with:
   - Build command: `npm run build`
   - Start command: `npm start`
   - Health check path: `/health`
3. Open the generated `https://<name>.onrender.com` URL and paste it at the top of this README.

> Render's free plan sleeps after ~15 minutes of inactivity; the first request after that takes ~30–50 s to wake up.

### Railway

New project → Deploy from GitHub repo. Railway detects Node; set build command `npm run build` and start command `npm start`. `PORT` is injected automatically.

### Vercel / Netlify (frontend only)

These platforms don't keep long-lived WebSocket connections in serverless functions, so the Socket.IO server must run elsewhere (Render/Railway):

1. Deploy the backend to Render as above and set env var `CORS_ORIGIN=https://your-frontend.vercel.app`.
2. Deploy `client/` to Vercel/Netlify with build command `npm run build`, output `dist`, and env var `VITE_SERVER_URL=https://your-backend.onrender.com`.

### Environment variables

| Variable | Where | Default | Purpose |
|---|---|---|---|
| `PORT` | server | `3001` | HTTP port (set automatically by Render/Railway) |
| `CORS_ORIGIN` | server | `*` | Comma separated allowed origins when the client is hosted elsewhere |
| `VITE_SERVER_URL` | client (build time) | same origin | Backend URL when the client is hosted elsewhere |

---

## Project structure

```
├── package.json            root scripts (install/build/start/test)
├── render.yaml             Render blueprint
├── ARCHITECTURE.md         how WebSockets, canvas and game logic fit together
├── server/
│   ├── src/
│   │   ├── index.ts                  Express + Socket.IO bootstrap, serves client/dist
│   │   ├── RoomManager.ts            registry of rooms, room codes, public matchmaking
│   │   ├── handlers/MessageHandler.ts  socket event → domain method, input validation
│   │   ├── models/Room.ts            players, settings, moderation, broadcasting, per-player state
│   │   ├── models/Player.ts          player data + scoring helpers
│   │   ├── game/Game.ts              round/turn state machine, timers, hints, scoring
│   │   ├── game/DrawingBoard.ts      authoritative stroke list (late join, undo, replay)
│   │   ├── game/words.ts             categorised word list
│   │   └── utils/wordMatch.ts        guess normalisation + "close" detection
│   └── test/e2e.ts                   end-to-end socket test
└── client/
    └── src/
        ├── App.tsx                   screen routing (home / lobby / game)
        ├── useGame.ts                socket subscriptions → React state
        ├── socket.ts                 Socket.IO client + ack helper
        └── components/
            ├── Home.tsx              name, avatar, play / create / join, public rooms
            ├── Lobby.tsx             players, settings, invite link, ready / start
            ├── SettingsForm.tsx      host-configurable room settings
            ├── GameView.tsx          top bar, timer, hints, overlays (choose / turn end / podium)
            ├── DrawingCanvas.tsx     canvas capture, rendering, toolbar, replay
            ├── PlayerList.tsx        scores, badges, kick / ban / votekick
            └── Chat.tsx              chat + guess input
```

See **[ARCHITECTURE.md](ARCHITECTURE.md)** for the design walkthrough.
