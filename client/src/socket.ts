import { io } from 'socket.io-client';

/**
 * Same-origin by default (server serves the built client).
 * Set VITE_SERVER_URL when the frontend is hosted separately (e.g. Vercel + Render).
 */
const SERVER_URL = import.meta.env.VITE_SERVER_URL as string | undefined;

export const socket = io(SERVER_URL || undefined, {
  transports: ['websocket', 'polling'],
  autoConnect: true,
});

export function emitAck<T = { ok: boolean; error?: string; [k: string]: unknown }>(
  event: string,
  data: unknown = {},
): Promise<T> {
  return new Promise((resolve) => {
    socket.timeout(8000).emit(event, data, (err: Error | null, res: T) => {
      if (err) resolve({ ok: false, error: 'Server did not respond. Try again.' } as T);
      else resolve(res);
    });
  });
}

/** Stable per-browser id, used by the server for bans. */
export function getClientId(): string {
  try {
    let id = localStorage.getItem('clientId');
    if (!id) {
      id = `c-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
      localStorage.setItem('clientId', id);
    }
    return id;
  } catch {
    return `c-${Math.random().toString(36).slice(2)}`;
  }
}
