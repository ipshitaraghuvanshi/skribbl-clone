import { useEffect, useState } from 'react';
import { emitAck, getClientId, socket } from '../socket';
import { PublicRoom } from '../types';

export const AVATARS = ['😀', '😎', '🤠', '👻', '🐱', '🐶', '🦊', '🐼', '🐸', '🐵', '🦄', '🐙', '🤖', '👽', '🎃', '🐧'];

const load = (key: string, fallback: string) => {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
};
const save = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable */
  }
};

interface Props {
  connected: boolean;
  notice: string | null;
  clearNotice: () => void;
}

export default function Home({ connected, notice, clearNotice }: Props) {
  const inviteCode = new URLSearchParams(window.location.search).get('room')?.toUpperCase() ?? '';
  const [name, setName] = useState(() => load('playerName', ''));
  const [avatarIdx, setAvatarIdx] = useState(() => Number(load('avatarIdx', '0')) % AVATARS.length || 0);
  const [code, setCode] = useState(inviteCode);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [publicRooms, setPublicRooms] = useState<PublicRoom[]>([]);

  useEffect(() => save('playerName', name), [name]);
  useEffect(() => save('avatarIdx', String(avatarIdx)), [avatarIdx]);

  // refresh the public room list every few seconds
  useEffect(() => {
    if (!connected) return;
    const refresh = () =>
      socket.emit('list_rooms', {}, (res: { rooms: PublicRoom[] }) => setPublicRooms(res?.rooms ?? []));
    refresh();
    const t = setInterval(refresh, 4000);
    return () => clearInterval(t);
  }, [connected]);

  const identity = () => ({
    playerName: name.trim(),
    hostName: name.trim(),
    avatar: AVATARS[avatarIdx],
    clientId: getClientId(),
  });

  const run = async (event: string, extra: Record<string, unknown> = {}) => {
    if (!name.trim()) {
      setError('Please enter your name first.');
      return;
    }
    setBusy(true);
    setError(null);
    clearNotice();
    const res = await emitAck(event, { ...identity(), ...extra });
    setBusy(false);
    if (!res.ok) setError(res.error ?? 'Something went wrong.');
  };

  const cycleAvatar = (dir: number) => setAvatarIdx((i) => (i + dir + AVATARS.length) % AVATARS.length);

  return (
    <div className="home">
      <h1 className="logo">
        <span style={{ color: '#ef4444' }}>s</span>
        <span style={{ color: '#f97316' }}>c</span>
        <span style={{ color: '#facc15' }}>r</span>
        <span style={{ color: '#22c55e' }}>i</span>
        <span style={{ color: '#06b6d4' }}>b</span>
        <span style={{ color: '#3b82f6' }}>b</span>
        <span style={{ color: '#a855f7' }}>l</span>
        <span style={{ color: '#ec4899' }}>e</span>
        <span className="logo-dot">.io</span>
      </h1>
      <p className="tagline">Draw, guess & win - multiplayer pictionary in your browser</p>

      <div className="card home-card">
        {!connected && <div className="banner warning">Connecting to server...</div>}
        {notice && <div className="banner danger">{notice}</div>}
        {error && <div className="banner danger">{error}</div>}

        <div className="avatar-picker">
          <button className="icon-btn" onClick={() => cycleAvatar(-1)} aria-label="Previous avatar">
            ◀
          </button>
          <div className="avatar-big">{AVATARS[avatarIdx]}</div>
          <button className="icon-btn" onClick={() => cycleAvatar(1)} aria-label="Next avatar">
            ▶
          </button>
        </div>

        <input
          className="input"
          placeholder="Enter your name"
          value={name}
          maxLength={20}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && (inviteCode ? run('join_room', { roomId: inviteCode }) : run('quick_play'))}
          autoFocus
        />

        {inviteCode ? (
          <button className="btn btn-green btn-big" disabled={busy || !connected} onClick={() => run('join_room', { roomId: inviteCode })}>
            Join room {inviteCode}
          </button>
        ) : (
          <button className="btn btn-green btn-big" disabled={busy || !connected} onClick={() => run('quick_play')}>
            Play!
          </button>
        )}

        <div className="row">
          <button className="btn btn-blue" disabled={busy || !connected} onClick={() => run('create_room', { settings: { isPrivate: true } })}>
            Create private room
          </button>
          <button className="btn btn-blue" disabled={busy || !connected} onClick={() => run('create_room', { settings: { isPrivate: false } })}>
            Create public room
          </button>
        </div>

        <div className="row join-row">
          <input
            className="input"
            placeholder="Room code"
            value={code}
            maxLength={6}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            onKeyDown={(e) => e.key === 'Enter' && code && run('join_room', { roomId: code })}
          />
          <button className="btn btn-orange" disabled={busy || !connected || !code} onClick={() => run('join_room', { roomId: code })}>
            Join
          </button>
        </div>
      </div>

      <div className="card home-card">
        <h3>Public rooms</h3>
        {publicRooms.length === 0 ? (
          <p className="muted">No open public rooms right now. Create one or hit Play!</p>
        ) : (
          <ul className="room-list">
            {publicRooms.map((r) => (
              <li key={r.roomId}>
                <div>
                  <b>{r.hostName}'s room</b>
                  <span className="muted">
                    {' '}
                    · {r.players}/{r.maxPlayers} players · {r.phase === 'lobby' ? 'in lobby' : `round ${r.round}/${r.rounds}`}
                  </span>
                </div>
                <button className="btn btn-small btn-green" disabled={busy} onClick={() => run('join_room', { roomId: r.roomId })}>
                  Join
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="card home-card how-to">
        <h3>How to play</h3>
        <ol>
          <li>Create a room and share the invite link with friends.</li>
          <li>When it's your turn, pick a word and draw it.</li>
          <li>Everyone else types guesses in the chat - faster guesses earn more points.</li>
          <li>After all rounds, the player with the most points wins!</li>
        </ol>
      </div>
    </div>
  );
}
