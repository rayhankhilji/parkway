import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js';
import type { GameEvent, PublicGameState } from '@parkway/engine';

/**
 * The live connection, and the sequence contract that keeps it honest.
 *
 * The browser's Supabase client can do exactly one thing: subscribe to a
 * broadcast channel. Row level security grants the anon key no table access
 * whatsoever, so a `.from()` call in browser code is not a shortcut — it is a
 * bug that will fail (→ DATA_MODEL, D2).
 *
 * Broadcast is best effort, so the client has to assume it will miss messages.
 * The rule is deliberately unforgiving: apply only the message that follows the
 * one you have, discard anything you have already seen, and on a gap throw the
 * message away and refetch the whole state. Never reconcile a gap locally. A
 * board that looks live while being subtly wrong is the worst failure a
 * synchronous game can have.
 */

export type StatePayload = {
  readonly seq: number;
  readonly publicState: PublicGameState;
  readonly events: readonly GameEvent[];
};

export type ConnectionStatus = 'connecting' | 'live' | 'reconnecting';

export type RealtimeHandlers = {
  /** The next state in sequence. Apply it. */
  readonly onState: (payload: StatePayload) => void;
  /** A gap was detected. Fetch full state; the payload has been discarded. */
  readonly onGap: () => void;
  readonly onStatus: (status: ConnectionStatus) => void;
};

let browserClient: SupabaseClient | null = null;

function client(): SupabaseClient {
  if (browserClient === null) {
    const url = process.env['NEXT_PUBLIC_SUPABASE_URL'];
    const anonKey = process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'];
    if (url === undefined || anonKey === undefined) {
      throw new Error('Supabase browser configuration is missing. Check .env.local.');
    }
    browserClient = createClient(url, anonKey, {
      auth: { persistSession: false },
      realtime: { params: { eventsPerSecond: 20 } },
    });
  }
  return browserClient;
}

export type Subscription = {
  /** The sequence the caller believes is current. Kept in step by the caller. */
  setSeq: (seq: number) => void;
  unsubscribe: () => void;
};

export function subscribeToGame(
  gameId: string,
  initialSeq: number,
  handlers: RealtimeHandlers,
): Subscription {
  let localSeq = initialSeq;
  let closed = false;

  handlers.onStatus('connecting');

  const channel: RealtimeChannel = client()
    .channel(`game:${gameId}`, { config: { broadcast: { self: false } } })
    .on('broadcast', { event: 'state' }, (message) => {
      const payload = message['payload'] as StatePayload | undefined;
      if (payload === undefined) return;

      if (payload.seq <= localSeq) {
        // Already applied. The actor's own POST response usually arrives first,
        // so this is the normal case for whoever took the action.
        return;
      }

      if (payload.seq > localSeq + 1) {
        handlers.onGap();
        return;
      }

      localSeq = payload.seq;
      handlers.onState(payload);
    })
    .subscribe((status) => {
      if (closed) return;
      if (status === 'SUBSCRIBED') {
        handlers.onStatus('live');
        // Anything could have happened while the socket was down, so a fresh
        // subscription always refetches rather than assuming it missed nothing.
        handlers.onGap();
        return;
      }
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        handlers.onStatus('reconnecting');
      }
    });

  return {
    setSeq: (seq: number) => {
      // The caller's own POST responses move the sequence forward too, so it
      // tells us about them; otherwise every action we take looks like a gap.
      if (seq > localSeq) localSeq = seq;
    },
    unsubscribe: () => {
      closed = true;
      void client().removeChannel(channel);
    },
  };
}
