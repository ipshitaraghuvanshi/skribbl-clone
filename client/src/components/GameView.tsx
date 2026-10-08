import { useEffect, useRef, useState } from 'react';
import { socket } from '../socket';
import { ChatMessage, GameState, Stroke } from '../types';
import Chat from './Chat';
import DrawingCanvas, { CanvasHandle } from './DrawingCanvas';
import PlayerList from './PlayerList';

interface Props {
  state: GameState;
  messages: ChatMessage[];
  deadline: number;
  lastDrawing: Stroke[] | null;
  onLeave: () => void;
}

function useCountdown(deadline: number) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);
  return deadline ? Math.max(0, Math.ceil((deadline - now) / 1000)) : 0;
}

export default function GameView({ state, messages, deadline, lastDrawing, onLeave }: Props) {
  const canvasRef = useRef<CanvasHandle>(null);
  const seconds = useCountdown(deadline);
  const me = state.players.find((p) => p.id === socket.id);
  const isDrawer = state.drawerId === socket.id;
  const drawer = state.players.find((p) => p.id === state.drawerId);
  const canDraw = isDrawer && state.phase === 'drawing';

  const chatPlaceholder = isDrawer
    ? 'You are drawing - chat is only visible to players who guessed'
    : me?.hasGuessed
      ? 'You guessed it! Chat with others who guessed'
      : 'Type your guess here...';

  return (
    <div className="page">
      <header className="topbar game-topbar">
        <div className="timer-wrap">
          <div className={`timer ${state.phase === 'drawing' && seconds <= 10 ? 'urgent' : ''}`}>⏱ {seconds}</div>
          <div className="round">
            Round {Math.min(state.round, state.totalRounds)} of {state.totalRounds}
          </div>
        </div>
        <WordDisplay state={state} isDrawer={isDrawer} />
        <button className="btn btn-small btn-gray" onClick={onLeave}>
          Leave
        </button>
      </header>

      <div className="game">
        <aside className="card game-players">
          <PlayerList players={state.players} hostId={state.hostId} votesNeeded={state.votesNeeded} showScores />
        </aside>

        <main className="game-board">
          <div className="board-inner">
            <DrawingCanvas ref={canvasRef} isDrawer={canDraw} />
            <Overlay state={state} isDrawer={isDrawer} drawerName={drawer?.name ?? 'Someone'} seconds={seconds} />
          </div>
          {lastDrawing && lastDrawing.length > 0 && state.phase !== 'drawing' && (
            <button className="btn btn-small btn-blue replay-btn" onClick={() => canvasRef.current?.replay(lastDrawing)}>
              ▶ Replay last drawing
            </button>
          )}
        </main>

        <aside className="card game-chat">
          <Chat messages={messages} placeholder={chatPlaceholder} event={state.phase === 'drawing' ? 'guess' : 'chat'} />
        </aside>
      </div>
    </div>
  );
}

function WordDisplay({ state, isDrawer }: { state: GameState; isDrawer: boolean }) {
  if (state.phase === 'choosing') return <div className="word-display muted">Choosing a word...</div>;
  if (state.phase !== 'drawing') return <div className="word-display" />;

  if (state.word) {
    return (
      <div className="word-display">
        <div className="word-label">{isDrawer ? 'DRAW THIS' : 'YOU GUESSED'}</div>
        <div className="word-full">{state.word}</div>
      </div>
    );
  }
  if (!state.hint) {
    return (
      <div className="word-display">
        <div className="word-label">HIDDEN WORD</div>
        <div className="word-full">???</div>
      </div>
    );
  }
  return (
    <div className="word-display">
      <div className="word-label">GUESS THIS ({state.wordLength} letters)</div>
      <div className="hint">
        {state.hint.map((c, i) => (c === ' ' ? <span key={i} className="hint-gap" /> : <span key={i} className="hint-char">{c === '_' ? '' : c}</span>))}
      </div>
    </div>
  );
}

function Overlay({ state, isDrawer, drawerName, seconds }: { state: GameState; isDrawer: boolean; drawerName: string; seconds: number }) {
  if (state.phase === 'choosing') {
    return (
      <div className="overlay">
        {isDrawer ? (
          <>
            <h2>Choose a word</h2>
            <div className="word-options">
              {state.wordOptions.map((w) => (
                <button key={w} className="btn btn-big btn-blue" onClick={() => socket.emit('word_chosen', { word: w })}>
                  {w}
                </button>
              ))}
            </div>
            <div className="muted-light">Auto-picks in {seconds}s</div>
          </>
        ) : (
          <h2>{drawerName} is choosing a word...</h2>
        )}
      </div>
    );
  }

  if (state.phase === 'turn_end' && state.lastTurn) {
    const t = state.lastTurn;
    const reason = t.reason === 'all_guessed' ? 'Everyone guessed the word!' : t.reason === 'drawer_left' ? 'The drawer left.' : "Time's up!";
    return (
      <div className="overlay">
        <div className="muted-light">{reason}</div>
        {t.word && (
          <h2>
            The word was <span className="reveal">{t.word}</span>
          </h2>
        )}
        <ul className="turn-scores">
          {t.scores.map((s) => (
            <li key={s.id}>
              <span>{s.name}</span>
              <span className={s.points > 0 ? 'plus' : 'zero'}>{s.points > 0 ? `+${s.points}` : '0'}</span>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  if (state.phase === 'game_over') {
    const [first, second, third] = state.leaderboard;
    const isHost = socket.id === state.hostId;
    return (
      <div className="overlay">
        <h2>🏆 {first ? `${first.name} wins!` : 'Game over'}</h2>
        <div className="podium">
          {[second, first, third].map((p, i) =>
            p ? (
              <div key={p.id} className={`podium-spot place-${p.rank}`} style={{ order: i }}>
                <div className="avatar-big">{p.avatar}</div>
                <div className="podium-name">{p.name}</div>
                <div className="podium-block">
                  #{p.rank}
                  <small>{p.score} pts</small>
                </div>
              </div>
            ) : null,
          )}
        </div>
        <ol className="leaderboard">
          {state.leaderboard.map((p) => (
            <li key={p.id}>
              <span>
                #{p.rank} {p.avatar} {p.name}
              </span>
              <b>{p.score}</b>
            </li>
          ))}
        </ol>
        {isHost ? (
          <button className="btn btn-green btn-big" onClick={() => socket.emit('return_to_lobby')}>
            Play again
          </button>
        ) : (
          <div className="muted-light">Waiting for the host to start a new game...</div>
        )}
      </div>
    );
  }

  return null;
}
