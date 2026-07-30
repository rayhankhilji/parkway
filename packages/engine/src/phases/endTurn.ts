import { violation, type RuleViolation } from '../errors';
import { err, ok, type Result } from '../result';
import type { GameEvent } from '../events/types';
import type { GameState, PlayerId, TurnPhase } from '../state/types';
import { activePlayerId, getPlayer } from '../state/selectors';
import type { PhaseResult } from './roll';

/**
 * Handing the turn on.
 *
 * The next player is the next solvent one in turn order, wrapping. Bankrupt
 * players stay in the array so that turn order does not shift underneath
 * everyone when someone goes out — they are stepped over, not removed.
 */
export function nextActiveIndex(state: GameState, from: number): number {
  const size = state.turnOrder.length;
  for (let step = 1; step <= size; step += 1) {
    const candidate = (from + step) % size;
    const id = state.turnOrder[candidate];
    if (id !== undefined && !getPlayer(state, id).bankrupt) {
      return candidate;
    }
  }
  throw new Error('No solvent player remains to take a turn');
}

/** The phase a player's turn opens in, which depends only on where they are. */
export function openingPhaseFor(state: GameState, playerId: PlayerId): TurnPhase {
  return getPlayer(state, playerId).inJail
    ? { kind: 'awaiting_jail_decision' }
    : { kind: 'awaiting_roll' };
}

export function handleEndTurn(state: GameState): Result<PhaseResult, RuleViolation> {
  if (state.phase.kind !== 'awaiting_end_turn') {
    return err(violation('WRONG_PHASE', 'You still have something to settle this turn.'));
  }

  const playerId = activePlayerId(state);
  const activeIndex = nextActiveIndex(state, state.activeIndex);
  const nextPlayerId = state.turnOrder[activeIndex];
  if (nextPlayerId === undefined) {
    throw new Error(`Turn order has no player at index ${activeIndex}`);
  }

  return ok({
    state: {
      ...state,
      activeIndex,
      phase: openingPhaseFor(state, nextPlayerId),
      turn: { doublesCount: 0, hasRolled: false, lastRoll: null },
    },
    events: [{ type: 'TURN_ENDED', playerId, nextPlayerId }],
  });
}

/**
 * Makes sure the turn is not sitting with somebody who has left the game.
 *
 * An estate auction outlives the player whose estate it was: they go bankrupt,
 * their lots are sold off one by one, and when the last one settles the turn would
 * otherwise be handed straight back to them. A bankrupt player has no legal
 * actions, so the game stops dead with nobody able to move.
 *
 * Every path that finishes an obligation runs through here, rather than each one
 * remembering to check.
 */
export function withSolventActivePlayer(
  state: GameState,
  events: readonly GameEvent[],
): PhaseResult {
  const active = state.turnOrder[state.activeIndex];
  if (active === undefined || !getPlayer(state, active).bankrupt) {
    return { state, events };
  }

  const activeIndex = nextActiveIndex(state, state.activeIndex);
  const nextId = state.turnOrder[activeIndex];
  if (nextId === undefined) {
    throw new Error(`Turn order has no player at index ${activeIndex}`);
  }

  return {
    state: {
      ...state,
      activeIndex,
      phase: openingPhaseFor(state, nextId),
      turn: { doublesCount: 0, hasRolled: false, lastRoll: null },
    },
    events: [...events, { type: 'TURN_ENDED', playerId: active, nextPlayerId: nextId }],
  };
}
