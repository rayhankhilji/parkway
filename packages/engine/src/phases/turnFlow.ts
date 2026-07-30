import type { GameEvent } from '../events/types';
import type { GameState, TurnPhase } from '../state/types';

/**
 * Where a turn goes once whatever was blocking it is done.
 *
 * The rule is that doubles grant another roll *after the current turn's
 * obligations are settled* (→ PRD F4). So the extra roll has to survive a purchase
 * decision, a rent payment, or a card — anything that interrupts the turn between
 * the roll and the end of it.
 *
 * Nothing needs to be stored to remember that. `doublesCount` is reset to zero by
 * any roll that is not a double, so a non-zero count means the most recent roll
 * *was* a double and the player is owed another. That invariant is maintained in
 * exactly one place, the roll handler, and this file is the only reader of it.
 */

export type PhaseResult = {
  readonly state: GameState;
  readonly events: readonly GameEvent[];
};

export function phaseAfterObligations(state: GameState): TurnPhase {
  return state.turn.doublesCount > 0 ? { kind: 'awaiting_roll' } : { kind: 'awaiting_end_turn' };
}

/** Finishes an interruption and hands the turn back to its natural next step. */
export function concludeObligation(state: GameState, events: readonly GameEvent[]): PhaseResult {
  return { state: { ...state, phase: phaseAfterObligations(state) }, events };
}
