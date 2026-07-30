import { getOwnableSquare } from '../board/lookup';
import type { SquareId } from '../board/types';
import { violation, type RuleViolation } from '../errors';
import type { GameEvent } from '../events/types';
import { err, ok, type Result } from '../result';
import type { GameState, PlayerId } from '../state/types';
import { boardOf, getDeed, getPlayer } from '../state/selectors';
import { developmentLevel } from './building';
import { managementBlockedBy } from './management';
import { credit, payOrEnterDebt } from './payment';

/**
 * Mortgaging.
 *
 * A mortgage is the game's only way to turn a deed into cash without giving it up.
 * The owner keeps the property and loses the rent — which is already handled in
 * rules/rent.ts, where a mortgaged square charges nothing.
 *
 * Clearing one costs the mortgage value plus interest, so a round trip is a real
 * loss. That is the point: it is a way out of trouble, not a free line of credit.
 */

export type MortgageResult = {
  readonly state: GameState;
  readonly events: readonly GameEvent[];
};

/**
 * What it costs to clear a mortgage: the money back, plus interest on it.
 *
 * Interest is rounded rather than floored because most mortgage values are round
 * numbers and one is not — Cathedral Close mortgages at 175, and ten percent of
 * that is 17.5. Rounding keeps money an integer without quietly making one
 * property cheaper to redeem than its neighbours.
 */
export function unmortgageCost(state: GameState, squareId: SquareId): number {
  const pack = boardOf(state);
  const square = getOwnableSquare(pack, squareId);
  return square.mortgageValue + Math.round(square.mortgageValue * pack.mortgageInterestRate);
}

/** Interest alone, for a mortgaged deed changing hands in a trade (→ PRD F13). */
export function transferInterest(state: GameState, squareId: SquareId): number {
  const pack = boardOf(state);
  return Math.round(getOwnableSquare(pack, squareId).mortgageValue * pack.mortgageInterestRate);
}

export function mortgageBlockedBy(
  state: GameState,
  playerId: PlayerId,
  squareId: SquareId,
): RuleViolation | null {
  const blocked = managementBlockedBy(state, playerId);
  if (blocked !== null) return blocked;

  const deed = state.deeds[squareId];
  if (deed === undefined) {
    return violation('SQUARE_NOT_OWNABLE', 'That square cannot be mortgaged.');
  }
  if (deed.ownerId !== playerId) {
    return violation('NOT_THE_OWNER', 'You do not own that.');
  }
  if (deed.mortgaged) {
    return violation('PROPERTY_MORTGAGED', 'That is already mortgaged.');
  }

  /** PRD F11 — a property carrying buildings cannot be mortgaged. */
  if (developmentLevel(deed) > 0) {
    return violation('PROPERTY_HAS_BUILDINGS', 'Sell the buildings on it first.');
  }

  return null;
}

export function mortgage(
  state: GameState,
  playerId: PlayerId,
  squareId: SquareId,
): Result<MortgageResult, RuleViolation> {
  const blocked = mortgageBlockedBy(state, playerId, squareId);
  if (blocked !== null) return err(blocked);

  const amount = getOwnableSquare(boardOf(state), squareId).mortgageValue;
  const deed = getDeed(state, squareId);

  return ok({
    state: {
      ...credit(state, playerId, amount),
      deeds: { ...state.deeds, [squareId]: { ...deed, mortgaged: true } },
    },
    events: [{ type: 'MORTGAGED', playerId, squareId, amount }],
  });
}

export function unmortgageBlockedBy(
  state: GameState,
  playerId: PlayerId,
  squareId: SquareId,
): RuleViolation | null {
  const blocked = managementBlockedBy(state, playerId);
  if (blocked !== null) return blocked;

  const deed = state.deeds[squareId];
  if (deed === undefined) {
    return violation('SQUARE_NOT_OWNABLE', 'That square has no mortgage.');
  }
  if (deed.ownerId !== playerId) {
    return violation('NOT_THE_OWNER', 'You do not own that.');
  }
  if (!deed.mortgaged) {
    return violation('PROPERTY_NOT_MORTGAGED', 'That is not mortgaged.');
  }

  if (getPlayer(state, playerId).cash < unmortgageCost(state, squareId)) {
    return violation('INSUFFICIENT_FUNDS', 'You cannot afford to clear that mortgage.');
  }

  return null;
}

export function unmortgage(
  state: GameState,
  playerId: PlayerId,
  squareId: SquareId,
): Result<MortgageResult, RuleViolation> {
  const blocked = unmortgageBlockedBy(state, playerId, squareId);
  if (blocked !== null) return err(blocked);

  const amount = unmortgageCost(state, squareId);
  const deed = getDeed(state, squareId);

  const payment = payOrEnterDebt(state, playerId, null, amount, { kind: 'awaiting_end_turn' });
  if (payment.enteredDebt) {
    throw new Error('Clearing a mortgage passed the affordability check but entered debt');
  }

  return ok({
    state: {
      ...payment.state,
      deeds: { ...payment.state.deeds, [squareId]: { ...deed, mortgaged: false } },
    },
    events: [{ type: 'UNMORTGAGED', playerId, squareId, amount }],
  });
}

export function mortgageableSquares(state: GameState, playerId: PlayerId): readonly SquareId[] {
  return Object.keys(state.deeds)
    .map(Number)
    .filter((squareId) => mortgageBlockedBy(state, playerId, squareId) === null);
}

export function unmortgageableSquares(state: GameState, playerId: PlayerId): readonly SquareId[] {
  return Object.keys(state.deeds)
    .map(Number)
    .filter((squareId) => unmortgageBlockedBy(state, playerId, squareId) === null);
}
