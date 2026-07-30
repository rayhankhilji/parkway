'use client';

import { create } from 'zustand';
import type { Action, GameEvent } from '@parkway/engine';
import {
  fetchGame,
  fetchLog,
  postAction,
  type ApiFailure,
  type GamePayload,
} from '@/lib/apiClient';
import { subscribeToGame, type ConnectionStatus, type Subscription } from '@/lib/realtime';

/**
 * Local view state — and nothing else.
 *
 * This store holds the sequence number, the connection status, which action is in
 * flight, and the feed. It does not hold a second copy of the game: `game` is
 * whatever the server last said, stored verbatim, never edited in place.
 *
 * There is deliberately no optimistic application. The client posts an action,
 * disables the control, and waits. Running the reducer locally to predict the
 * outcome would mean the rules existed in two places and something would have to
 * reconcile the divergence — a whole class of desync bugs bought for perhaps
 * 150ms on a game where it is not your turn most of the time (→ D8).
 */

export type FeedLine = {
  readonly seq: number;
  readonly events: readonly GameEvent[];
};

type State = {
  readonly game: GamePayload | null;
  readonly token: string | null;
  readonly connection: ConnectionStatus;
  readonly feed: readonly FeedLine[];
  /** The action type currently in flight, so the bar can disable itself. */
  readonly pending: Action['type'] | null;
  /** A refused action, shown next to the control that caused it (→ DESIGN). */
  readonly refusal: ApiFailure | null;
  readonly loadError: ApiFailure | null;
  readonly loading: boolean;
};

type Actions = {
  connect: (gameId: string, token: string) => Promise<void>;
  disconnect: () => void;
  send: (action: Action) => Promise<void>;
  dismissRefusal: () => void;
};

let subscription: Subscription | null = null;

export const useGameStore = create<State & Actions>((set, get) => ({
  game: null,
  token: null,
  connection: 'connecting',
  feed: [],
  pending: null,
  refusal: null,
  loadError: null,
  loading: true,

  connect: async (gameId, token) => {
    set({ token, loading: true, loadError: null });

    const resync = async (): Promise<void> => {
      const current = get().token;
      if (current === null) return;

      const [state, log] = await Promise.all([
        fetchGame(gameId, current),
        fetchLog(gameId, current, 0),
      ]);

      if (!state.ok) {
        set({ loadError: state.failure, loading: false });
        return;
      }

      subscription?.setSeq(state.value.seq);
      set({
        game: state.value,
        loading: false,
        loadError: null,
        // The feed is rebuilt from the log rather than patched, so a reconnect
        // shows the whole game rather than starting from when you came back.
        feed: log.ok ? log.value.entries.map(({ seq, events }) => ({ seq, events })) : get().feed,
      });
    };

    // Fetch before subscribing. HTTP is the authoritative path — a player's own
    // POST response is what confirms their action — so the board has to render
    // even if Realtime never connects at all. Subscribing first meant a broadcast
    // outage took the whole game down while the path that actually matters was
    // healthy.
    await resync();

    subscription?.unsubscribe();
    try {
      subscription = subscribeToGame(gameId, get().game?.seq ?? -1, {
        onState: ({ seq, publicState, events }) => {
          const game = get().game;
          if (game === null) return;
          set({
            game: { ...game, seq, publicState },
            feed: [...get().feed, { seq, events }],
          });
        },
        onGap: () => {
          void resync();
        },
        onStatus: (connection) => set({ connection }),
      });
    } catch (error) {
      // The board is already on screen and correct as of the fetch above. What is
      // missing is live updates, which is exactly what this state announces
      // (→ ARCHITECTURE, failure behaviour).
      console.error('Realtime subscription failed', error);
      set({ connection: 'reconnecting' });
    }
  },

  disconnect: () => {
    subscription?.unsubscribe();
    subscription = null;
    set({ game: null, token: null, feed: [], pending: null, refusal: null, loading: true });
  },

  send: async (action) => {
    const { game, token, pending } = get();
    if (game === null || token === null || pending !== null) return;

    set({ pending: action.type, refusal: null });
    const result = await postAction(game.gameId, token, game.seq, action);

    if (result.ok) {
      subscription?.setSeq(result.value.seq);
      set({
        game: result.value.game,
        feed: [...get().feed, { seq: result.value.seq, events: result.value.events }],
        pending: null,
      });
      return;
    }

    set({ pending: null });

    // A 409 means the world moved on. Refetch and let the player decide again
    // against what is actually true — never resend (→ D4).
    if (result.failure.status === 409) {
      set({ refusal: result.failure });
      const refreshed = await fetchGame(game.gameId, token);
      if (refreshed.ok) {
        subscription?.setSeq(refreshed.value.seq);
        set({ game: refreshed.value, refusal: null });
      }
      return;
    }

    set({ refusal: result.failure });
  },

  dismissRefusal: () => set({ refusal: null }),
}));
