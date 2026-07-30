import { getLegalActions } from '../../src/legalActions';
import type { LegalAction } from '../../src/actions/types';
import type { GameState, PlayerId } from '../../src/state/types';

/**
 * The actions that belong to the flow of a turn, with the always-available ones
 * left out.
 *
 * Building, mortgaging, trading and conceding are offered in almost every phase,
 * because the real rules allow them at almost any time (→ D10, PRD F14). That
 * makes an exact assertion on the whole list a test of those predicates rather
 * than of the phase being examined — and one that breaks every time an unrelated
 * rule is added.
 *
 * Tests about turn flow use this. Tests about management and conceding assert on
 * their own entries directly.
 */
const alwaysAvailableTypes = new Set<LegalAction['type']>([
  'CONCEDE',
  'BUILD_HOUSE',
  'SELL_HOUSE',
  'MORTGAGE',
  'UNMORTGAGE',
  'OFFER_TRADE',
  'ACCEPT_TRADE',
  'DECLINE_TRADE',
  'WITHDRAW_TRADE',
]);

export function turnActions(state: GameState, playerId: PlayerId): readonly LegalAction[] {
  return getLegalActions(state, playerId).filter(
    (action) => !alwaysAvailableTypes.has(action.type),
  );
}

export function turnActionTypes(state: GameState, playerId: PlayerId): readonly string[] {
  return turnActions(state, playerId).map((action) => action.type);
}
