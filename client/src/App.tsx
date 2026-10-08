import { useEffect } from 'react';
import Home from './components/Home';
import Lobby from './components/Lobby';
import GameView from './components/GameView';
import { useGame } from './useGame';

function setRoomInUrl(roomId: string | null) {
  const url = new URL(window.location.href);
  if (roomId) url.searchParams.set('room', roomId);
  else url.searchParams.delete('room');
  window.history.replaceState(null, '', url.toString());
}

export default function App() {
  const game = useGame();
  const { state } = game;

  useEffect(() => {
    if (state?.roomId) setRoomInUrl(state.roomId);
  }, [state?.roomId]);

  const leave = () => {
    game.leave();
    setRoomInUrl(null);
  };

  if (!state) {
    return <Home connected={game.connected} notice={game.kicked} clearNotice={() => game.setKicked(null)} />;
  }
  if (state.phase === 'lobby') {
    return <Lobby state={state} messages={game.messages} onLeave={leave} />;
  }
  return (
    <GameView
      state={state}
      messages={game.messages}
      deadline={game.deadline}
      lastDrawing={game.lastDrawing}
      onLeave={leave}
    />
  );
}
