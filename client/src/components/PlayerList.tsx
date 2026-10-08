import { emitAck, socket } from '../socket';
import { Player } from '../types';

interface Props {
  players: Player[];
  hostId: string | null;
  votesNeeded: number;
  showScores: boolean;
  showReady?: boolean;
}

export default function PlayerList({ players, hostId, votesNeeded, showScores, showReady }: Props) {
  const me = socket.id;
  const iAmHost = me === hostId;
  const ranked = showScores ? [...players].sort((a, b) => b.score - a.score) : players;

  const act = async (event: string, playerId: string, extra: Record<string, unknown> = {}) => {
    const res = await emitAck(event, { playerId, ...extra });
    if (!res.ok && res.error) alert(res.error);
  };

  return (
    <ul className="players">
      {ranked.map((p, i) => (
        <li key={p.id} className={`player ${p.hasGuessed ? 'guessed' : ''} ${p.id === me ? 'me' : ''}`}>
          {showScores && <span className="rank">#{i + 1}</span>}
          <span className="avatar">{p.avatar}</span>
          <div className="player-info">
            <div className="player-name">
              {p.name}
              {p.id === me && <span className="you"> (You)</span>}
            </div>
            <div className="player-sub">
              {showScores && <span>{p.score} pts</span>}
              {p.isHost && <span className="tag">host</span>}
              {showReady && !p.isHost && <span className={`tag ${p.isReady ? 'ready' : 'not-ready'}`}>{p.isReady ? 'ready' : 'not ready'}</span>}
              {p.votesToKick > 0 && (
                <span className="tag danger">
                  kick {p.votesToKick}/{votesNeeded}
                </span>
              )}
            </div>
          </div>
          {p.isDrawer && <span className="pencil" title="Drawing">✏️</span>}
          {p.id !== me && (
            <div className="player-actions">
              {iAmHost ? (
                <>
                  <button className="mini" title="Kick" onClick={() => act('kick_player', p.id)}>
                    kick
                  </button>
                  <button className="mini danger" title="Ban" onClick={() => confirm(`Ban ${p.name}?`) && act('kick_player', p.id, { ban: true })}>
                    ban
                  </button>
                </>
              ) : (
                <button className="mini" title="Vote to kick" onClick={() => act('vote_kick', p.id)}>
                  votekick
                </button>
              )}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
