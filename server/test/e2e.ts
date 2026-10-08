/**
 * End-to-end smoke test: boots the real server and drives a full turn with 3 socket clients.
 * Run: npm test (from /server)
 */
import { spawn } from 'child_process';
import path from 'path';
import { io, Socket } from 'socket.io-client';
import { checkGuess } from '../src/utils/wordMatch';

const PORT = 3999;
const URL = `http://localhost:${PORT}`;

let failures = 0;
function assert(cond: unknown, msg: string) {
  if (cond) console.log(`  ✓ ${msg}`);
  else {
    failures++;
    console.error(`  ✗ ${msg}`);
  }
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
function once<T = any>(s: Socket, event: string, pred: (d: T) => boolean = () => true, timeout = 5000): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout waiting for ${event}`)), timeout);
    const fn = (d: T) => {
      if (!pred(d)) return;
      clearTimeout(t);
      s.off(event, fn);
      resolve(d);
    };
    s.on(event, fn);
  });
}
const emitAck = (s: Socket, event: string, data: unknown = {}) =>
  new Promise<any>((resolve) => s.emit(event, data, resolve));

function connect(): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const s = io(URL, { transports: ['websocket'], forceNew: true });
    s.on('connect', () => resolve(s));
    s.on('connect_error', reject);
  });
}

async function waitForServer() {
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch(`${URL}/health`);
      if (r.ok) return;
    } catch {
      /* not up yet */
    }
    await wait(200);
  }
  throw new Error('server did not start');
}

async function main() {
  console.log('Word matching');
  assert(checkGuess('  APPLE ', 'apple') === 'correct', 'case + trim insensitive');
  assert(checkGuess('icecream', 'ice cream') === 'correct', 'space-insensitive');
  assert(checkGuess('aple', 'apple') === 'close', 'one typo = close');
  assert(checkGuess('app', 'apple') === 'wrong', 'partial match is not accepted');
  assert(checkGuess('banana', 'apple') === 'wrong', 'different word = wrong');

  const server = spawn(process.execPath, [require.resolve('tsx/cli'), path.join(__dirname, '../src/index.ts')], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: 'inherit',
  });
  try {
    await waitForServer();
    const [a, b, c] = await Promise.all([connect(), connect(), connect()]);
    const latest = new Map<Socket, any>();
    [a, b, c].forEach((s) => s.on('game_state', (st) => latest.set(s, st)));

    console.log('Room & lobby');
    const created = await emitAck(a, 'create_room', {
      hostName: 'Alice',
      clientId: 'client-alice',
      settings: { rounds: 2, drawTime: 30, wordCount: 3, hints: 2, maxPlayers: 3 },
    });
    assert(created.ok && /^[A-Z0-9]{6}$/.test(created.roomId), `room created (${created.roomId})`);
    const roomId = created.roomId;

    const bad = await emitAck(b, 'join_room', { roomId: 'NOPE00', playerName: 'Bob' });
    assert(!bad.ok, 'joining unknown room fails');

    assert((await emitAck(b, 'join_room', { roomId, playerName: 'Bob', clientId: 'client-bob' })).ok, 'Bob joined');
    assert((await emitAck(c, 'join_room', { roomId: roomId.toLowerCase(), playerName: 'Carol', clientId: 'client-carol' })).ok, 'Carol joined via lowercase code');

    const d = await connect();
    const full = await emitAck(d, 'join_room', { roomId, playerName: 'Dave' });
    assert(!full.ok && /full/i.test(full.error), 'max players enforced');
    d.close();

    const notReady = await emitAck(a, 'start_game');
    assert(!notReady.ok, 'cannot start before everyone is ready');
    const notHost = await emitAck(b, 'start_game');
    assert(!notHost.ok && /host/i.test(notHost.error), 'only host can start');

    b.emit('set_ready', { ready: true });
    c.emit('set_ready', { ready: true });
    await wait(150);

    console.log('Game flow');
    const roundStartA = once(a, 'round_start');
    const roundStartB = once(b, 'round_start');
    const roundStartC = once(c, 'round_start');
    assert((await emitAck(a, 'start_game')).ok, 'host started the game');
    const starts = await Promise.all([roundStartA, roundStartB, roundStartC]);
    const drawerId = starts[0].drawerId;
    const sockets = [a, b, c];
    const drawer = sockets.find((s) => s.id === drawerId)!;
    const guessers = sockets.filter((s) => s !== drawer);
    const drawerStart = starts[sockets.indexOf(drawer)];
    assert(drawerStart.wordOptions.length === 3, 'drawer received 3 word options');
    assert(starts[sockets.indexOf(guessers[0])].wordOptions.length === 0, 'guessers do not receive word options');

    const word = drawerStart.wordOptions[1];
    drawer.emit('word_chosen', { word });
    await wait(200);
    assert(latest.get(drawer)?.word === word, 'drawer sees the word');
    assert(latest.get(guessers[0])?.word === null, 'guesser does not see the word');
    assert(latest.get(guessers[0])?.hint?.length === word.length, 'guesser sees blanks hint');

    console.log('Drawing sync');
    const drawData = once(guessers[0], 'draw_data', (d: any) => d.type === 'move');
    drawer.emit('draw_start', { strokeId: 's1', x: 0.1, y: 0.1, color: '#ff0000', size: 6, tool: 'brush' });
    drawer.emit('draw_move', { strokeId: 's1', points: [{ x: 0.2, y: 0.2 }, { x: 0.3, y: 0.3 }] });
    const moved = await drawData;
    assert(moved.points.length === 2, 'guesser received stroke points');
    drawer.emit('draw_end', { strokeId: 's1' });

    const undo = once(guessers[1], 'draw_undo');
    drawer.emit('draw_undo');
    assert((await undo).strokes.length === 0, 'undo broadcast with authoritative stroke list');

    // non-drawer can't draw
    let leaked = false;
    drawer.once('draw_data', () => (leaked = true));
    guessers[0].emit('draw_start', { strokeId: 'x', x: 0, y: 0, color: '#000000', size: 2 });
    await wait(150);
    assert(!leaked, 'non-drawer strokes are rejected');

    console.log('Guessing & scoring');
    const close = once(guessers[0], 'chat_message', (m: any) => m.system && /close/.test(m.text));
    guessers[0].emit('guess', { text: word.slice(0, -1) + (word.endsWith('z') ? 'y' : 'z') });
    if (word.length >= 3) assert(!!(await close.catch(() => null)), 'close guess reported privately');

    await wait(300);
    const result = once(drawer, 'guess_result', (r: any) => r.correct);
    guessers[0].emit('guess', { text: `  ${word.toUpperCase()} ` });
    const r = await result;
    assert(r.correct && r.points > 0, `correct guess scored ${r.points} points`);

    const turnEnd = once(drawer, 'round_end');
    await wait(300);
    guessers[1].emit('guess', { text: word });
    const end = await turnEnd;
    assert(end.reason === 'all_guessed' && end.word === word, 'turn ends when everyone guessed');
    await wait(100);
    const st = latest.get(drawer);
    const drawerScore = st.players.find((p: any) => p.id === drawerId).score;
    assert(drawerScore > 0, `drawer earned points (${drawerScore})`);

    console.log('Moderation');
    const kicked = once(guessers[1], 'kicked');
    const host = a;
    const target = guessers[1] === a ? guessers[0] : guessers[1];
    const targetKicked = target === guessers[1] ? kicked : once(target, 'kicked');
    assert((await emitAck(host, 'kick_player', { playerId: target.id, ban: true })).ok, 'host kicked a player');
    await targetKicked;
    const rejoin = await emitAck(target, 'join_room', { roomId, playerName: 'Again', clientId: target === b ? 'client-bob' : 'client-carol' });
    assert(!rejoin.ok && /banned/i.test(rejoin.error), 'banned player cannot rejoin');

    console.log('Leaving');
    const over = once(host, 'game_over', () => true, 8000);
    sockets.filter((s) => s !== host && s !== target).forEach((s) => s.close());
    const go = await over;
    assert(go.winner && go.leaderboard.length === 1, 'game ends with winner when players drop below 2');

    sockets.forEach((s) => s.close());
  } finally {
    server.kill();
  }

  console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed');
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
