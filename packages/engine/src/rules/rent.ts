import { getOwnableSquare } from '../board/lookup';
import type { DiceRoll, GameState, PlayerId } from '../state/types';
import {
  boardOf,
  countOwnedOfKind,
  diceTotal,
  getDeed,
  groupIsUnmortgaged,
  ownsFullGroup,
} from '../state/selectors';
import type { SquareId } from '../board/types';

/**
 * What is owed for landing on someone else's square.
 *
 * This is the rule with the most ways to be quietly wrong, so each one is spelled
 * out rather than folded together:
 *
 * - A mortgaged square charges nothing at all. The owner traded rent for cash.
 * - An unimproved lot doubles only when the owner holds every lot in the group
 *   and none of them is mortgaged. Built lots use the rent table instead — the
 *   doubling is not applied on top, which is the mistake that makes a single
 *   house look like a downgrade.
 * - Stations charge by how many the owner holds, not by which one you landed on.
 * - Utilities multiply the roll that brought you here. Which roll matters: it is
 *   the one that caused the landing, not a fresh one, so the same landing always
 *   costs the same when a game is replayed.
 * - A card that sends you to a station or utility charges the board pack's
 *   penalty instead of the standard rate (→ PRD F10).
 */

export type RentBasis = 'landed' | 'card';

/**
 * Rent owed by `payerId` for `squareId`, or 0 if nothing is owed.
 *
 * Returns 0 rather than throwing for an unowned or self-owned square, because
 * "you owe nothing" is the correct answer to the question in both cases and the
 * caller should not have to ask three questions to find that out.
 */
export function rentFor(
  state: GameState,
  squareId: SquareId,
  payerId: PlayerId,
  causingRoll: DiceRoll | null,
  basis: RentBasis = 'landed',
): number {
  const pack = boardOf(state);
  const square = getOwnableSquare(pack, squareId);
  const deed = getDeed(state, squareId);

  if (deed.ownerId === null || deed.ownerId === payerId) return 0;
  if (deed.mortgaged) return 0;

  const ownerId = deed.ownerId;

  switch (square.kind) {
    case 'property': {
      if (deed.hotels > 0) {
        return rentAt(square.rent, 5);
      }
      if (deed.houses > 0) {
        return rentAt(square.rent, deed.houses);
      }
      const base = rentAt(square.rent, 0);
      const doubled =
        ownsFullGroup(state, ownerId, square.group) && groupIsUnmortgaged(state, square.group);
      return doubled ? base * 2 : base;
    }

    case 'transit': {
      const held = countOwnedOfKind(state, ownerId, 'transit');
      const standard = ladderAt(pack.transit.rentByCount, held);
      return basis === 'card' ? standard * pack.transit.cardPenaltyMultiplier : standard;
    }

    case 'utility': {
      if (causingRoll === null) {
        throw new Error('Utility rent needs the roll that caused the landing');
      }
      const held = countOwnedOfKind(state, ownerId, 'utility');
      const multiplier =
        basis === 'card'
          ? pack.utility.cardPenaltyMultiplier
          : ladderAt(pack.utility.multiplierByCount, held);
      return multiplier * diceTotal(causingRoll);
    }
  }
}

/** Development level 0–5, where 5 is a hotel. */
function rentAt(table: readonly number[], level: number): number {
  const value = table[level];
  if (value === undefined) {
    throw new Error(`Rent table has no entry for development level ${level}`);
  }
  return value;
}

/**
 * A rung of a count-based ladder, where holding `count` of something reads the
 * entry at `count - 1`. Holding none should never reach here — the caller only
 * asks about a square that has an owner, and an owner holds at least that one.
 */
function ladderAt(ladder: readonly number[], count: number): number {
  const value = ladder[count - 1];
  if (value === undefined) {
    throw new Error(`Rent ladder has no entry for a holding of ${count}`);
  }
  return value;
}
