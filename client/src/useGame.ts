import { useEffect, useRef, useState } from 'react';
import { socket } from './socket';
import { ChatMessage, GameState, LeaderboardEntry, Stroke } from './types';

const MAX_MESSAGES = 150;

/** Subscribes to room-level socket events and exposes the latest game state + chat log. */
export function useGame() {
  const [state, setState] = useState<GameState | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [connected, setConnected] = useState(socket.connected);
  const [kicked, setKicked] = useState<string | null>(null);
  const [lastDrawing, setLastDrawing] = useState<Stroke[] | null>(null);
  const [winner, setWinner] = useState<LeaderboardEntry | null>(null);
  /** Local timestamp when the current phase ends (avoids client/server clock skew). */
  const [deadline, setDeadline] = useState(0);
  const msgId = useRef(0);

  useEffect(() => {
    const push = (m: Omit<ChatMessage, 'id'>) =>
      setMessages((prev) => [...prev.slice(-MAX_MESSAGES + 1), { ...m, id: ++msgId.current }]);

    const onState = (s: GameState) => {
      setState(s);
      setDeadline(s.timeLeftMs > 0 ? Date.now() + s.timeLeftMs : 0);
    };
    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);
    const onKicked = (d: { reason: string }) => {
      setKicked(d.reason === 'banned' ? 'You were banned from the room.' : 'You were kicked from the room.');
      setState(null);
      setMessages([]);
    };
    const onRoundEnd = (d: { drawing: Stroke[] }) => setLastDrawing(d.drawing);
    const onGameOver = (d: { winner: LeaderboardEntry | null }) => setWinner(d.winner);

    socket.on('game_state', onState);
    socket.on('chat_message', push);
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('kicked', onKicked);
    socket.on('round_end', onRoundEnd);
    socket.on('game_over', onGameOver);
    return () => {
      socket.off('game_state', onState);
      socket.off('chat_message', push);
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('kicked', onKicked);
      socket.off('round_end', onRoundEnd);
      socket.off('game_over', onGameOver);
    };
  }, []);

  // A dropped connection means the server already removed us from the room.
  useEffect(() => {
    if (!connected && state) {
      setState(null);
      setMessages([]);
      setKicked('Connection lost. Please join the room again.');
    }
  }, [connected, state]);

  const leave = () => {
    socket.emit('leave_room');
    setState(null);
    setMessages([]);
    setLastDrawing(null);
  };

  return { state, messages, connected, kicked, setKicked, deadline, lastDrawing, winner, leave };
}
