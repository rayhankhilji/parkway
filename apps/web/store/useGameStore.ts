'use client';

import { create } from 'zustand';
import {
  getLegalActions,
  toPublicState,
  type Action,
  type GameEvent,
  type LegalAction,
} from '@parkway/engine';
import { createBot, type Bot } from '@parkway/bot';
import {
  fetchGame,
  fetchLog,
  postAction,
  type ApiFailure,
  type GamePayload,
} from '@/lib/apiClient';
import {
  applyLocal,
  clearLocal,
  createLocalGame,
  loadLocal,
  payloadFor,
  persistLocal,
  type LocalSave,
  type LocalSetup,
} from '@/lib/local/localGame';
import { subscribeToGame, type ConnectionStatus, type Subscription } from '@/lib/realtime';
import { useStage, type FeedLine } from './useStage';

/**
 * The game, as this client knows it, and the one way to act on it.
 *
 * Two sources sit behind the same interface. Online, the server is the only
 * authority: the client posts an action, waits, and applies what comes back —
 * there is deliberately no optimistic application (→ D8). Solo, the engine runs
 * right here in the browser against bots, and the result has exactly the same
 * shape, so nothing downstream can tell the two apart.
 *
 * Either way, the newest truth is handed to the stage, which plays it out. The
 * UI renders from the stage, never from here directly.
 */

export type { FeedLine };

export type GameMode = 'online' | 'local';

type State = {
  readonly mode: GameMode | null;
  readonly game: GamePayload | null;
  readonly token: string | null;
  readonly connection: ConnectionStatus;
  /** The action type currently in flight, so controls can disable themselves. */
  readonly pending: Action['type'] | null;
  /** A refused action, shown next to the control that caused it. */
  readonly refusal: ApiFailure | null;
  readonly loadError: ApiFailure | null;
  readonly loading: boolean;
};

type Actions = {
  connect: (gameId: string, token: string) => Promise<void>;
  startLocal: (setup: LocalSetup) => void;
  resumeLocal: () => boolean;
  disconnect: () => void;
  send: (action: Action) => Promise<void>;
  dismissRefusal: () => void;
};

let subscription: Subscription | null = null;

/* ---- Solo driver state, outside React --------------------------------- */

let localSave: LocalSave | null = null;
let bots = new Map<string, Bot>();
let botTimer: ReturnType<typeof setTimeout> | null = null;
let auctionTimer: ReturnType<typeof setTimeout> | null = null;
let refusedAt = new Map<string, number>();
let unsubscribeStage: (() => void) | null = null;
let onlineChain: Promise<void> = Promise.resolve();

function clearTimers(): void {
  if (botTimer !== null) clearTimeout(botTimer);
  if (auctionTimer !== null) clearTimeout(auctionTimer);
  botTimer = null;
  auctionTimer = null;
}

/** How long a bot "thinks" before each kind of move. Pacing is most of the feel. */
function thinkingTime(action: Action): number {
  const jitter = Math.random() * 300;
  switch (action.type) {
    case 'ROLL_DICE':
    case 'ROLL_FOR_JAIL':
      return 650 + jitter;
    case 'END_TURN':
      return 550 + jitter;
    case 'BUY_PROPERTY':
    case 'DECLINE_PURCHASE':
      return 900 + jitter * 2;
    case 'PLACE_BID':
      return 700 + jitter * 3;
    case 'PASS_BID':
      return 650 + jitter * 2;
    case 'ACCEPT_TRADE':
    case 'DECLINE_TRADE':
      return 1300 + jitter;
    case 'OFFER_TRADE':
      return 900 + jitter;
    case 'BUILD_HOUSE':
    case 'SELL_HOUSE':
    case 'MORTGAGE':
    case 'UNMORTGAGE':
      return 380 + jitter / 2;
    default:
      return 600 + jitter;
  }
}

const fallbackOrder: readonly Action['type'][] = [
  'SETTLE_DEBT',
  'DECLINE_TRADE',
  'PASS_BID',
  'DECLINE_PURCHASE',
  'ROLL_FOR_JAIL',
  'ROLL_DICE',
  'END_TURN',
  'DECLARE_BANKRUPTCY',
];

function fallbackFor(legal: readonly LegalAction[]): Action | null {
  for (const type of fallbackOrder) {
    if (legal.some((candidate) => candidate.type === type)) {
      return { type } as Action;
    }
  }
  return null;
}

export const useGameStore = create<State & Actions>((set, get) => {
  /** Hand a new truth to the stage and remember it. */
  const publish = (game: GamePayload, events: readonly GameEvent[], seq: number | null): void => {
    set({ game });
    useStage.getState().push({ game, events, seq });
  };

  /* ---- Solo ------------------------------------------------------------- */

  const applyAs = (playerId: string, action: Action): boolean => {
    if (localSave === null) return false;
    const result = applyLocal(localSave, playerId, action, Date.now());
    if (!result.ok) {
      if (playerId === localSave.humanId) {
        set({ refusal: { status: 422, code: 'REFUSED', message: result.message } });
      } else {
        refusedAt.set(playerId, localSave.seq);
      }
      return false;
    }
    localSave = result.save;
    persistLocal(localSave);
    publish(payloadFor(localSave), result.events, localSave.seq);
    return true;
  };

  /**
   * Move the game along when it is a bot's move.
   *
   * Runs whenever the stage goes idle, so bots never act on a board the player
   * has not finished watching. Every bot is asked, in turn order, because during
   * an auction or a trade the player who can act is not the one whose turn it is.
   */
  const pump = (): void => {
    if (get().mode !== 'local' || localSave === null) return;
    if (useStage.getState().busy || botTimer !== null) return;

    const state = localSave.state;
    if (state.phase.kind === 'game_over') return;

    // Nobody "owns" the auction clock in a solo game, so the driver fires it.
    if (auctionTimer !== null) clearTimeout(auctionTimer);
    auctionTimer = null;
    if (state.phase.kind === 'auction') {
      const deadline = state.phase.deadlineAt;
      auctionTimer = setTimeout(
        () => {
          auctionTimer = null;
          if (localSave === null || localSave.state.phase.kind !== 'auction') return;
          const someone = localSave.state.turnOrder.find(
            (id) => localSave?.state.players[id]?.bankrupt === false,
          );
          if (someone !== undefined) applyAs(someone, { type: 'AUCTION_TIMEOUT' });
        },
        Math.max(0, deadline - Date.now()) + 60,
      );
    }

    const view = toPublicState(state);
    for (const id of state.turnOrder) {
      const bot = bots.get(id);
      if (bot === undefined) continue;
      const legalActions = getLegalActions(state, id);
      if (legalActions.length === 0) continue;

      // A bot whose choice the engine refused falls back to the plainest legal
      // move, so a strategy bug can never stall a solo game.
      const action =
        refusedAt.get(id) === localSave.seq
          ? fallbackFor(legalActions)
          : bot.decide({ state: view, playerId: id, legalActions, now: Date.now() });
      if (action === null) continue;

      const seqAtDecision = localSave.seq;
      botTimer = setTimeout(() => {
        botTimer = null;
        // Somebody moved first (the player bid, say). Think again.
        if (localSave === null || localSave.seq !== seqAtDecision) {
          pump();
          return;
        }
        if (!applyAs(id, action)) pump();
      }, thinkingTime(action));
      return;
    }
  };

  const bootLocal = (save: LocalSave): void => {
    get().disconnect();
    localSave = save;
    refusedAt = new Map();
    bots = new Map(
      save.seats.flatMap((seat, index) =>
        seat.bot === null
          ? []
          : [[seat.id, createBot(seat.id, seat.bot, (save.seed ^ (index * 2654435761)) >>> 0)]],
      ),
    );

    const game = payloadFor(save);
    set({
      mode: 'local',
      game,
      loading: false,
      loadError: null,
      refusal: null,
      pending: null,
      connection: 'live',
    });
    useStage.getState().reset(
      game,
      save.feed.map(({ seq, events }) => ({ seq, events })),
    );

    unsubscribeStage = useStage.subscribe((now, before) => {
      if (now.idleTick !== before.idleTick) pump();
    });
    pump();
  };

  return {
    mode: null,
    game: null,
    token: null,
    connection: 'connecting',
    pending: null,
    refusal: null,
    loadError: null,
    loading: true,

    startLocal: (setup) => {
      clearLocal();
      const save = createLocalGame(setup);
      persistLocal(save);
      bootLocal(save);
    },

    resumeLocal: () => {
      const save = loadLocal();
      if (save === null) return false;
      bootLocal(save);
      return true;
    },

    /* ---- Online --------------------------------------------------------- */

    connect: async (gameId, token) => {
      get().disconnect();
      set({ mode: 'online', token, loading: true, loadError: null });

      let first = true;
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
        set({ game: state.value, loading: false, loadError: null });

        // The feed is rebuilt from the log rather than patched, so a reconnect
        // shows the whole game rather than starting from when you came back.
        const feed: FeedLine[] | undefined = log.ok
          ? log.value.entries.map(({ seq, events }) => ({ seq, events }))
          : undefined;

        if (first) {
          first = false;
          useStage.getState().reset(state.value, feed ?? []);
        } else {
          useStage.getState().push({ game: state.value, events: [], seq: null, replaceFeed: feed });
        }
      };

      // Fetch before subscribing: HTTP is the authoritative path, so the board
      // has to render even if Realtime never connects at all.
      await resync();

      subscription?.unsubscribe();
      try {
        subscription = subscribeToGame(gameId, get().game?.seq ?? -1, {
          onState: ({ seq, publicState, events }) => {
            // A broadcast carries public state but not this viewer's legal
            // actions, so fetch those before handing the move to the stage.
            // Chained, so two quick broadcasts cannot land out of order.
            onlineChain = onlineChain.then(async () => {
              const game = get().game;
              const current = get().token;
              if (game === null || current === null) return;
              const fresh = await fetchGame(gameId, current);
              const next =
                fresh.ok && fresh.value.seq === seq ? fresh.value : { ...game, seq, publicState };
              publish(next, events, seq);
              if (!fresh.ok || fresh.value.seq !== seq) void resync();
            });
          },
          onGap: () => {
            void resync();
          },
          onStatus: (connection) => set({ connection }),
        });
      } catch (error) {
        console.error('Realtime subscription failed', error);
        set({ connection: 'reconnecting' });
      }
    },

    disconnect: () => {
      subscription?.unsubscribe();
      subscription = null;
      clearTimers();
      unsubscribeStage?.();
      unsubscribeStage = null;
      localSave = null;
      bots = new Map();
      set({ mode: null, game: null, token: null, pending: null, refusal: null, loading: true });
      useStage.getState().reset(null, []);
    },

    send: async (action) => {
      const { game, token, pending, mode } = get();
      if (game === null || pending !== null) return;

      if (mode === 'local') {
        set({ refusal: null });
        if (localSave === null) return;
        // The player acted, so any bot move decided against the old position
        // is stale. Drop it; the pump will ask again once the stage settles.
        if (botTimer !== null) {
          clearTimeout(botTimer);
          botTimer = null;
        }
        applyAs(localSave.humanId, action);
        return;
      }

      if (token === null) return;
      set({ pending: action.type, refusal: null });
      const result = await postAction(game.gameId, token, game.seq, action);

      if (result.ok) {
        subscription?.setSeq(result.value.seq);
        set({ pending: null });
        publish(result.value.game, result.value.events, result.value.seq);
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
          set({ refusal: null });
          publish(refreshed.value, [], null);
        }
        return;
      }

      set({ refusal: result.failure });
    },

    dismissRefusal: () => set({ refusal: null }),
  };
});
