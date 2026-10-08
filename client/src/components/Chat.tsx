import { useEffect, useRef, useState } from 'react';
import { socket } from '../socket';
import { ChatMessage } from '../types';

interface Props {
  messages: ChatMessage[];
  placeholder: string;
  disabled?: boolean;
  /** "guess" while a turn is in progress, "chat" otherwise (server treats both the same way). */
  event: 'guess' | 'chat';
}

export default function Chat({ messages, placeholder, disabled, event }: Props) {
  const [text, setText] = useState('');
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const send = (e: React.FormEvent) => {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    socket.emit(event, { text: t });
    setText('');
  };

  return (
    <div className="chat">
      <div className="chat-messages" ref={listRef}>
        {messages.map((m) =>
          m.system ? (
            <div key={m.id} className={`msg system ${m.tone ?? 'info'}`}>
              {m.text}
            </div>
          ) : (
            <div key={m.id} className={`msg ${m.guessedGroup ? 'guessed-group' : ''}`}>
              <b>{m.playerName}:</b> {m.text}
            </div>
          ),
        )}
      </div>
      <form className="chat-input" onSubmit={send}>
        <input
          className="input"
          value={text}
          maxLength={100}
          disabled={disabled}
          placeholder={placeholder}
          onChange={(e) => setText(e.target.value)}
        />
      </form>
    </div>
  );
}
