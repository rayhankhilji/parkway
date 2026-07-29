import 'server-only';
import { randomInt } from 'node:crypto';
import {
  createGame,
  getLegalActions,
  reduce,
  toPublicState,
  type Action,
  type GameConfig,
  type GameEvent,
  type GameState,
  type LegalAction,
  type PublicGameState,
  type RuleViolation,
} from '@parkway/engine';
import { hashToken, issueToken } from './auth';
import { broadcastState } from './broadcast';
import { db, failed } from './db';
import { generateRoomCode, maxCodeAttempts } from './roomCode';

/**
 * Everything between an HTTP request and a persisted, broadcast state change.
 *
 * This layer owns persistence, authorisation and concurrency. It owns no rules.
 * If a function here ever computes a rent, decides whose turn it is, or works
 * out whether a build is legal, the design has failed — that belongs in the
 * engine, and a second copy of it is the failure this whole architecture is
 * arranged to prevent.
 */

export const maxSeats = 6;

export type PlayerSummary = {
  readonly id: string;
  readonly name: string;
  readonly seat: number;
  readonly colour: string;
  readonly isConnected: boolean;
};

export type GamePayload = {
  readonly gameId: string;
  readonly roomCode: string;
  readonly status: 'lobby' | 'active' | 'finished' | 'abandoned';
  readonly seq: number;
  readonly players: readonly PlayerSummary[];
  readonly publicState: PublicGameState | null;
  readonly legalActions: readonly LegalAction[];
  readonly you: { readonly playerId: string; readonly isHost: boolean };
};

type GameRow = {
  id: string;
  room_code: string;
  status: GamePayload['status'];
  config: GameConfig;
  board_pack_id: string;
  state: GameState | null;
  seq: number;
  host_player_id: string | null;
};

const gameColumns = 'id, room_code, status, config, board_pack_id, state, seq, host_player_id';

async function loadGameRow(gameId: string): Promise<GameRow | null> {
  const { data, error } = await db().from('games').select(gameColumns).eq('id', gameId).limit(1);
  if (error !== null) failed('Loading a game', error);
  return (data?.[0] as GameRow | undefined) ?? null;
}

async function loadPlayers(gameId: string): Promise<readonly PlayerSummary[]> {
  const { data, error } = await db()
    .from('players')
    .select('id, name, seat, colour, is_connected')
    .eq('game_id', gameId)
    .order('seat');

  if (error !== null) failed('Loading the roster', error);

  return (data ?? []).map((row) => ({
    id: row.id as string,
    name: row.name as string,
    seat: row.seat as number,
    colour: row.colour as string,
    isConnected: row.is_connected as boolean,
  }));
}

function payloadFor(
  row: GameRow,
  players: readonly PlayerSummary[],
  viewerId: string,
): GamePayload {
  return {
    gameId: row.id,
    roomCode: row.room_code,
    status: row.status,
    seq: row.seq,
    players,
    // The single place a state document becomes something a client may see.
    publicState: row.state === null ? null : toPublicState(row.state),
    legalActions: legalActionsFor(row, viewerId),
    you: { playerId: viewerId, isHost: row.host_player_id === viewerId },
  };
}

/**
 * What this player may do next.
 *
 * Always answered by the engine, with one exception that is not a rule: before a
 * game starts there is no state to ask about, so the host is offered the start
 * (→ D17). Whether the roster is big enough is still the engine's call, made
 * when createGame runs.
 */
function legalActionsFor(row: GameRow, viewerId: string): readonly LegalAction[] {
  if (row.state === null) {
    return row.status === 'lobby' && row.host_player_id === viewerId
      ? [{ type: 'START_GAME' }]
      : [];
  }
  return getLegalActions(row.state, viewerId);
}

export async function loadGame(gameId: string, viewerId: string): Promise<GamePayload | null> {
  const row = await loadGameRow(gameId);
  if (row === null) return null;
  return payloadFor(row, await loadPlayers(gameId), viewerId);
}

// ---------------------------------------------------------------------------
// Creating and joining
// ---------------------------------------------------------------------------

export type CreateResult = {
  readonly gameId: string;
  readonly roomCode: string;
  readonly playerId: string;
  readonly playerToken: string;
  readonly game: GamePayload;
};

export async function createGameRecord(name: string, config: GameConfig): Promise<CreateResult> {
  const token = issueToken();
  const nameKey = name.trim().toLowerCase();

  for (let attempt = 0; attempt < maxCodeAttempts; attempt += 1) {
    const roomCode = generateRoomCode();
    const { data, error } = await db().rpc('create_game_with_host', {
      p_room_code: roomCode,
      p_config: config,
      p_board_pack_id: 'parkway-classic',
      p_name: name.trim(),
      p_name_key: nameKey,
      p_colour: 'rose',
      p_token_hash: hashToken(token),
    });

    if (error !== null) {
      // 23505 is a unique violation, which here means the code collided.
      if (error.code === '23505') continue;
      failed('Creating a game', error);
    }

    const created = (data as { game_id: string; player_id: string }[] | null)?.[0];
    if (created === undefined) failed('Creating a game', { message: 'no row returned' });

    const game = await loadGame(created.game_id, created.player_id);
    if (game === null) failed('Creating a game', { message: 'game vanished after creation' });

    return {
      gameId: created.game_id,
      roomCode,
      playerId: created.player_id,
      playerToken: token,
      game,
    };
  }

  // Never hand back a code that belongs to another game. Six collisions in a
  // space of a billion means something is wrong that a seventh try will not fix.
  throw new Error(`Could not find a free room code in ${maxCodeAttempts} attempts`);
}

export type JoinOutcome =
  | {
      readonly kind: 'joined';
      readonly playerId: string;
      readonly playerToken: string;
      readonly gameId: string;
    }
  | { readonly kind: 'reconnected'; readonly playerId: string; readonly gameId: string }
  | {
      readonly kind: 'refused';
      readonly reason:
        'GAME_NOT_FOUND' | 'GAME_ALREADY_STARTED' | 'GAME_FULL' | 'NAME_TAKEN' | 'GAME_FINISHED';
      readonly gameId: string | null;
    };

export async function joinGame(roomCode: string, name: string): Promise<JoinOutcome> {
  const token = issueToken();
  const { data, error } = await db().rpc('join_game', {
    p_room_code: roomCode,
    p_name: name.trim(),
    p_name_key: name.trim().toLowerCase(),
    p_token_hash: hashToken(token),
    p_max_seats: maxSeats,
  });

  if (error !== null) failed('Joining a game', error);

  const row = (
    data as { result: string; out_game_id: string | null; out_player_id: string | null }[] | null
  )?.[0];
  if (row === undefined) failed('Joining a game', { message: 'no row returned' });

  if (row.result === 'JOINED') {
    if (row.out_game_id === null || row.out_player_id === null) {
      failed('Joining a game', { message: 'joined without ids' });
    }
    return {
      kind: 'joined',
      playerId: row.out_player_id,
      playerToken: token,
      gameId: row.out_game_id,
    };
  }

  return {
    kind: 'refused',
    reason: row.result as Exclude<JoinOutcome, { kind: 'joined' | 'reconnected' }>['reason'],
    gameId: row.out_game_id,
  };
}

export async function gameExists(gameId: string): Promise<boolean> {
  const { data, error } = await db().from('games').select('id').eq('id', gameId).limit(1);
  if (error !== null) failed('Checking a game exists', error);
  return (data?.length ?? 0) > 0;
}

export async function findGameByCode(roomCode: string): Promise<string | null> {
  const { data, error } = await db().from('games').select('id').eq('room_code', roomCode).limit(1);
  if (error !== null) failed('Looking up a room code', error);
  return (data?.[0]?.id as string | undefined) ?? null;
}

// ---------------------------------------------------------------------------
// Applying actions
// ---------------------------------------------------------------------------

export type ApplyOutcome =
  | {
      readonly kind: 'applied';
      readonly seq: number;
      readonly events: readonly GameEvent[];
      readonly game: GamePayload;
    }
  | { readonly kind: 'conflict'; readonly seq: number }
  | { readonly kind: 'violation'; readonly violation: RuleViolation }
  | { readonly kind: 'not_found' };

/**
 * The single mutating path.
 *
 * Load, reduce, write under a sequence guard, broadcast. The guard is what makes
 * two simultaneous actions safe: one commits and the other is told it lost, so
 * it can refetch and let the player decide again against what is actually true.
 * There is no retry — reapplying "buy this property" against a state where
 * someone else already bought it is exactly the bug an authoritative server
 * exists to prevent (→ D4).
 */
export async function applyAction(
  gameId: string,
  playerId: string,
  expectedSeq: number,
  action: Action,
  now: number,
): Promise<ApplyOutcome> {
  const row = await loadGameRow(gameId);
  if (row === null) return { kind: 'not_found' };

  if (row.seq !== expectedSeq) {
    return { kind: 'conflict', seq: row.seq };
  }

  if (action.type === 'START_GAME') {
    return startGame(row, playerId, action);
  }

  if (row.state === null) {
    return {
      kind: 'violation',
      violation: { code: 'WRONG_PHASE', message: 'This game has not started yet.' },
    };
  }

  const result = reduce(row.state, action, { playerId, now });
  if (!result.ok) {
    return { kind: 'violation', violation: result.error };
  }

  return persist(row, result.value.state, result.value.events, action, playerId, expectedSeq);
}

async function startGame(row: GameRow, playerId: string, action: Action): Promise<ApplyOutcome> {
  if (row.host_player_id !== playerId) {
    // Who may press start is a question about the players table, not about the
    // rules of the game, so it is answered here rather than in the engine.
    return {
      kind: 'violation',
      violation: { code: 'NOT_YOUR_TURN', message: 'Only the host can start the game.' },
    };
  }

  if (row.status !== 'lobby' || row.state !== null) {
    return {
      kind: 'violation',
      violation: { code: 'WRONG_PHASE', message: 'This game has already started.' },
    };
  }

  const players = await loadPlayers(row.id);
  const created = createGame({
    playerIds: players.map((player) => player.id),
    config: row.config,
    boardPackId: row.board_pack_id,
    // The one moment real entropy enters the system. From here the generator
    // lives inside the state document and the engine never asks for more.
    seed: randomInt(0, 0x1_0000_0000),
  });

  if (!created.ok) {
    return { kind: 'violation', violation: created.error };
  }

  const events: readonly GameEvent[] = [
    { type: 'GAME_STARTED', turnOrder: created.value.turnOrder },
  ];

  const { data, error } = await db().rpc('start_game', {
    p_game_id: row.id,
    p_state: created.value,
    p_action: action,
    p_events: events,
    p_player_id: playerId,
  });

  if (error !== null) failed('Starting a game', error);
  if (data === null) return { kind: 'conflict', seq: row.seq };

  return finish(row.id, playerId, data as number, created.value, events);
}

async function persist(
  row: GameRow,
  state: GameState,
  events: readonly GameEvent[],
  action: Action,
  playerId: string,
  expectedSeq: number,
): Promise<ApplyOutcome> {
  const finished = state.phase.kind === 'game_over';

  const { data, error } = await db().rpc('apply_action', {
    p_game_id: row.id,
    p_expected_seq: expectedSeq,
    p_state: state,
    p_action: action,
    p_events: events,
    // Timeouts belong to no player: any client may fire one, and recording the
    // sender would imply they chose the outcome.
    p_player_id: action.type === 'AUCTION_TIMEOUT' ? null : playerId,
    p_status: finished ? 'finished' : 'active',
    p_winner_player_id: state.phase.kind === 'game_over' ? state.phase.winnerId : null,
  });

  if (error !== null) failed('Applying an action', error);

  // Null means the guarded update matched no rows: someone committed first.
  if (data === null) {
    const current = await loadGameRow(row.id);
    return { kind: 'conflict', seq: current?.seq ?? expectedSeq };
  }

  return finish(row.id, playerId, data as number, state, events);
}

async function finish(
  gameId: string,
  viewerId: string,
  seq: number,
  state: GameState,
  events: readonly GameEvent[],
): Promise<ApplyOutcome> {
  const publicState = toPublicState(state);
  await broadcastState(gameId, { seq, publicState, events });

  const game = await loadGame(gameId, viewerId);
  if (game === null) failed('Reloading after an action', { message: 'game vanished' });

  return { kind: 'applied', seq, events, game };
}

// ---------------------------------------------------------------------------
// The action log
// ---------------------------------------------------------------------------

export type LogEntry = {
  readonly seq: number;
  readonly playerId: string | null;
  readonly events: readonly GameEvent[];
  readonly createdAt: string;
};

export const logPageSize = 200;

export async function loadLog(
  gameId: string,
  since: number,
): Promise<{ entries: readonly LogEntry[]; hasMore: boolean }> {
  const { data, error } = await db()
    .from('game_actions')
    .select('seq, player_id, events, created_at')
    .eq('game_id', gameId)
    .gt('seq', since)
    .order('seq')
    .limit(logPageSize + 1);

  if (error !== null) failed('Loading the action log', error);

  const rows = data ?? [];
  const hasMore = rows.length > logPageSize;

  return {
    entries: rows.slice(0, logPageSize).map((row) => ({
      seq: row.seq as number,
      playerId: row.player_id as string | null,
      events: row.events as GameEvent[],
      createdAt: row.created_at as string,
    })),
    hasMore,
  };
}
