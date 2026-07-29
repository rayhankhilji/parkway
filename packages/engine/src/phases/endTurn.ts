import { violation, type RuleViolation } from '../errors.js';
import { err, ok, type Result } from '../result.js';
import type { GameState, PlayerId, TurnPhase } from '../state/types.js';
import { activePlayerId, getPlayer } from '../state/selectors.js';
import type { PhaseResult } from './roll.js';

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
