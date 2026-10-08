import express from 'express';
import fs from 'fs';
import http from 'http';
import path from 'path';
import { Server } from 'socket.io';
import { MessageHandler } from './handlers/MessageHandler';
import { RoomManager } from './RoomManager';
import { CATEGORY_KEYS } from './game/words';

const PORT = Number(process.env.PORT) || 3001;
// Comma separated list of allowed origins when the frontend is hosted elsewhere (e.g. Vercel).
const CORS_ORIGIN = process.env.CORS_ORIGIN?.split(',').map((s) => s.trim()) ?? '*';

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: CORS_ORIGIN },
  maxHttpBufferSize: 1e6,
});

const rooms = new RoomManager(io);
const handler = new MessageHandler(io, rooms);

io.on('connection', (socket) => handler.attach(socket));

// ------------------------------------------------------------------ REST
app.get('/health', (_req, res) => {
  res.json({ ok: true, rooms: rooms.size, connections: io.engine.clientsCount });
});
app.get('/api/rooms', (_req, res) => res.json(rooms.listPublic()));
app.get('/api/categories', (_req, res) => res.json(CATEGORY_KEYS));

// ------------------------------------------------------------------ static client (production)
const clientDist = path.resolve(__dirname, '../../client/dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  // SPA fallback (invite links like /?room=ABC123 or /room/ABC123)
  app.get('*', (_req, res) => res.sendFile(path.join(clientDist, 'index.html')));
}

server.listen(PORT, () => {
  console.log(`Skribbl clone server listening on http://localhost:${PORT}`);
});
