import { useState } from 'react';
import { emitAck, socket } from '../socket';
import { ChatMessage, GameState } from '../types';
import Chat from './Chat';
import PlayerList from './PlayerList';
import SettingsForm from './SettingsForm';

interface Props {
  state: GameState;
  messages: ChatMessage[];
  onLeave: () => void;
}

export default function Lobby({ state, messages, onLeave }: Props) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const me = state.players.find((p) => p.id === socket.id);
  const isHost = socket.id === state.hostId;
  const inviteLink = `${window.location.origin}/?room=${state.roomId}`;
  const others = state.players.filter((p) => !p.isHost);
  const allReady = others.every((p) => p.isReady);
  const canStart = state.players.length >= 2 && allReady;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(inviteLink);
    } catch {
      window.prompt('Copy this invite link:', inviteLink);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const start = async () => {
    const res = await emitAck('start_game');
    setError(res.ok ? null : res.error ?? 'Could not start the game.');
  };

  return (
    <div className="page">
      <header className="topbar">
        <button className="btn btn-small btn-gray" onClick={onLeave}>
          ← Leave
        </button>
        <div className="topbar-title">
          Room <b>{state.roomId}</b> · {state.settings.isPrivate ? 'Private' : 'Public'}
        </div>
        <div />
      </header>

      <div className="lobby">
        <section className="card lobby-players">
          <h3>
            Players ({state.players.length}/{state.settings.maxPlayers})
          </h3>
          <PlayerList players={state.players} hostId={state.hostId} votesNeeded={state.votesNeeded} showScores={false} showReady />
        </section>

        <section className="card lobby-main">
          <h3>Settings {!isHost && <span className="muted">(only the host can change these)</span>}</h3>
          <SettingsForm settings={state.settings} editable={isHost} playerCount={state.players.length} />

          <div className="invite">
            <div className="muted">Invite your friends:</div>
            <div className="invite-row">
              <input className="input" readOnly value={inviteLink} onFocus={(e) => e.target.select()} />
              <button className="btn btn-blue" onClick={copy}>
                {copied ? 'Copied!' : 'Copy'}
              </button>
            </div>
          </div>

          {error && <div className="banner danger">{error}</div>}

          <div className="lobby-actions">
            {isHost ? (
              <>
                <button className="btn btn-green btn-big" disabled={!canStart} onClick={start}>
                  Start game
                </button>
                {!canStart && (
                  <div className="muted">
                    {state.players.length < 2 ? 'Waiting for at least one more player...' : 'Waiting for everyone to get ready...'}
                  </div>
                )}
              </>
            ) : (
              <>
                <button
                  className={`btn btn-big ${me?.isReady ? 'btn-gray' : 'btn-green'}`}
                  onClick={() => socket.emit('set_ready', { ready: !me?.isReady })}
                >
                  {me?.isReady ? 'Not ready' : "I'm ready!"}
                </button>
                <div className="muted">Waiting for the host to start the game.</div>
              </>
            )}
          </div>
        </section>

        <section className="card lobby-chat">
          <h3>Chat</h3>
          <Chat messages={messages} placeholder="Say hi..." event="chat" />
        </section>
      </div>
    </div>
  );
}
