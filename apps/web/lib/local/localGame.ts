import {
  createGame,
  defaultBoardPackId,
  getLegalActions,
  reduce,
  toPublicState,
  type Action,
  type GameConfig,
  type GameEvent,
  type GameState,
  type PlayerId,
} from '@parkway/engine';
import type { Difficulty } from '@parkway/bot';
import type { GamePayload, PlayerSummary } from '@/lib/apiClient';

/**
 * A whole game, in this browser.
 *
 * Solo play needs no server: the engine is a pure reducer, so the browser can
 * hold the full state — secret RNG and deck order included — and run it
 * directly. The only player who can see anything is the one at the keyboard,
 * and they are playing against bots that are handed exactly the public view a
 * human would get, so nothing leaks that matters.
 *
 * What comes out of here is the same `GamePayload` the server returns, so every
 * component that renders an online game renders a solo one without knowing the
 * difference.
 */

export const localGameId = 'solo';

export type LocalSeat = {
  readonly id: PlayerId;
  readonly name: string;
  readonly colour: string;
  /** null for the human. */
  readonly bot: Difficulty | null;
};

export type LocalFeedLine = { readonly seq: number; readonly events: readonly GameEvent[] };

export type LocalSave = {
  readonly version: 1;
  readonly state: GameState;
  readonly seats: readonly LocalSeat[];
  readonly humanId: PlayerId;
  readonly seq: number;
  readonly feed: readonly LocalFeedLine[];
  readonly seed: number;
};

export const playerColours = ['rose', 'amber', 'emerald', 'sky', 'violet', 'slate'] as const;
export type PlayerColour = (typeof playerColours)[number];

const botNames = ['Mabel', 'Otto', 'Juniper', 'Felix', 'Hazel', 'Rupert', 'Clementine', 'Ezra'];

export type LocalSetup = {
  readonly name: string;
  readonly colour: PlayerColour;
  readonly opponents: number;
  readonly difficulty: Difficulty;
  readonly config: GameConfig;
};

function randomSeed(): number {
  if (typeof crypto !== 'undefined' && 'getRandomValues' in crypto) {
    return crypto.getRandomValues(new Uint32Array(1))[0] ?? 1;
  }
  return Math.floor(Math.random() * 2 ** 32);
}

function shuffled<T>(items: readonly T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const a = copy[i];
    const b = copy[j];
    if (a !== undefined && b !== undefined) {
      copy[i] = b;
      copy[j] = a;
    }
  }
  return copy;
}

export function createLocalGame(setup: LocalSetup): LocalSave {
  const seed = randomSeed();
  const humanId = 'p-you';
  const names = shuffled(botNames);
  const colours = playerColours.filter((colour) => colour !== setup.colour);

  const seats: LocalSeat[] = [
    { id: humanId, name: setup.name, colour: setup.colour, bot: null },
    ...Array.from({ length: setup.opponents }, (_, index) => ({
      id: `p-bot-${index + 1}`,
      name: names[index] ?? `Bot ${index + 1}`,
      colour: colours[index] ?? 'slate',
      bot: setup.difficulty,
    })),
  ];

  const created = createGame({
    playerIds: seats.map((seat) => seat.id),
    config: setup.config,
    boardPackId: defaultBoardPackId,
    seed,
  });
  if (!created.ok) throw new Error(created.error.message);

  return {
    version: 1,
    state: created.value,
    seats,
    humanId,
    seq: 1,
    feed: [{ seq: 1, events: [{ type: 'GAME_STARTED', turnOrder: created.value.turnOrder }] }],
    seed,
  };
}

export function payloadFor(save: LocalSave): GamePayload {
  const players: PlayerSummary[] = save.seats.map((seat, index) => ({
    id: seat.id,
    name: seat.name,
    seat: index,
    colour: seat.colour,
    isConnected: true,
    isBot: seat.bot !== null,
  }));

  return {
    gameId: localGameId,
    roomCode: 'SOLO',
    status: save.state.phase.kind === 'game_over' ? 'finished' : 'active',
    seq: save.seq,
    players,
    publicState: toPublicState(save.state),
    legalActions: getLegalActions(save.state, save.humanId),
    you: { playerId: save.humanId, isHost: true },
  };
}

export type LocalApply =
  | { readonly ok: true; readonly save: LocalSave; readonly events: readonly GameEvent[] }
  | { readonly ok: false; readonly message: string };

export function applyLocal(
  save: LocalSave,
  playerId: PlayerId,
  action: Action,
  now: number,
): LocalApply {
  const result = reduce(save.state, action, { playerId, now });
  if (!result.ok) return { ok: false, message: result.error.message };

  const seq = save.seq + 1;
  return {
    ok: true,
    events: result.value.events,
    save: {
      ...save,
      state: result.value.state,
      seq,
      feed: [...save.feed, { seq, events: result.value.events }].slice(-400),
    },
  };
}

/* ---- Persistence --------------------------------------------------------- */

const saveKey = 'parkway:solo';

export function persistLocal(save: LocalSave): void {
  try {
    window.localStorage.setItem(saveKey, JSON.stringify(save));
  } catch {
    // Storage full or blocked: the game carries on, it just will not resume.
  }
}

export function loadLocal(): LocalSave | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(saveKey);
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as Partial<LocalSave>;
    if (parsed.version !== 1 || parsed.state === undefined || !Array.isArray(parsed.seats)) {
      return null;
    }
    return parsed as LocalSave;
  } catch {
    return null;
  }
}

export function clearLocal(): void {
  try {
    window.localStorage.removeItem(saveKey);
  } catch {
    // Nothing to do.
  }
}

/** A saved solo game that is still being played, for the "continue" button. */
export function resumableLocal(): LocalSave | null {
  const save = loadLocal();
  if (save === null || save.state.phase.kind === 'game_over') return null;
  return save;
}
