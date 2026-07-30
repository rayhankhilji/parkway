import { getSquare } from '../board/lookup';
import type { GroupId, SquareId } from '../board/types';
import { violation, type RuleViolation } from '../errors';
import type { GameEvent } from '../events/types';
import { err, ok, type Result } from '../result';
import type { DeedState, GameState, PlayerId } from '../state/types';
import { boardOf, getDeed, getPlayer, groupIsUnmortgaged, ownsFullGroup } from '../state/selectors';
import { managementBlockedBy } from './management';
import { credit, payOrEnterDebt } from './payment';

/**
 * Houses and hotels.
 *
 * Three rules interact here and each is easy to implement in a way that looks
 * right and is not:
 *
 * - **Even build.** No lot may run more than one house ahead of another in its
 *   group. Expressed as "you may only build on a lot that is currently at the
 *   group's minimum", which is the same rule stated so that it cannot be got
 *   wrong by one.
 * - **Finite supply.** Houses and hotels are objects, not numbers that go up. When
 *   the bank has none, building is refused — and a hotel purchase *returns* four
 *   houses, so it can make building possible for somebody else on the same action.
 * - **Selling in reverse.** Selling is even-build backwards: only from a lot at the
 *   group's maximum. Selling from a hotel puts four houses back on the lot, which
 *   the bank has to be able to supply.
 */

/** 0–4 houses, or 5 for a hotel. Comparing levels is what makes even-build simple. */
export function developmentLevel(deed: DeedState): number {
  return deed.hotels > 0 ? 5 : deed.houses;
}

function groupLevels(state: GameState, group: GroupId): readonly number[] {
  const pack = boardOf(state);
  const definition = pack.groups.find((candidate) => candidate.id === group);
  if (definition === undefined) {
    throw new Error(`Group ${group} is not in board pack ${pack.id}`);
  }
  return definition.memberIds.map((id) => developmentLevel(getDeed(state, id)));
}

/** Why this player cannot build here, or null if they can. */
export function buildBlockedBy(
  state: GameState,
  playerId: PlayerId,
  squareId: SquareId,
): RuleViolation | null {
  const blocked = managementBlockedBy(state, playerId);
  if (blocked !== null) return blocked;

  const square = getSquare(boardOf(state), squareId);
  if (square.kind !== 'property') {
    return violation('SQUARE_NOT_OWNABLE', 'You can only build on a colour group.');
  }

  const deed = getDeed(state, squareId);
  if (deed.ownerId !== playerId) {
    return violation('NOT_THE_OWNER', 'You do not own that.');
  }

  if (!ownsFullGroup(state, playerId, square.group)) {
    return violation('INCOMPLETE_GROUP', 'You need every lot in the group before you can build.');
  }

  if (!groupIsUnmortgaged(state, square.group)) {
    return violation('GROUP_HAS_MORTGAGE', 'Clear the mortgages in that group first.');
  }

  const level = developmentLevel(deed);
  if (level >= 5) {
    return violation('MAX_DEVELOPMENT', 'That already has a hotel.');
  }

  const levels = groupLevels(state, square.group);
  if (level > Math.min(...levels)) {
    return violation('UNEVEN_BUILD', 'Build evenly — the other lots in the group are behind.');
  }

  // The fifth house is a hotel, and the two come out of different stocks.
  const buyingHotel = level === 4;
  if (buyingHotel && state.bank.hotels < 1) {
    return violation('BANK_OUT_OF_HOTELS', 'The bank has no hotels left.');
  }
  if (!buyingHotel && state.bank.houses < 1) {
    return violation('BANK_OUT_OF_HOUSES', 'The bank has no houses left.');
  }

  if (getPlayer(state, playerId).cash < square.buildCost) {
    return violation('INSUFFICIENT_FUNDS', 'You cannot afford that.');
  }

  return null;
}

export type BuildResult = {
  readonly state: GameState;
  readonly events: readonly GameEvent[];
};

export function buildHouse(
  state: GameState,
  playerId: PlayerId,
  squareId: SquareId,
): Result<BuildResult, RuleViolation> {
  const blocked = buildBlockedBy(state, playerId, squareId);
  if (blocked !== null) return err(blocked);

  const pack = boardOf(state);
  const square = getSquare(pack, squareId);
  if (square.kind !== 'property') {
    throw new Error(`Square ${squareId} is not a lot`);
  }

  const deed = getDeed(state, squareId);
  const payment = payOrEnterDebt(state, playerId, null, square.buildCost, {
    kind: 'awaiting_end_turn',
  });

  if (payment.enteredDebt) {
    throw new Error('A build that passed the affordability check still entered debt');
  }

  const buyingHotel = developmentLevel(deed) === 4;

  if (buyingHotel) {
    // The four houses go back into the bank's stock and become available to
    // everybody, possibly unblocking a build somebody else was waiting on.
    return ok({
      state: {
        ...payment.state,
        deeds: { ...payment.state.deeds, [squareId]: { ...deed, houses: 0, hotels: 1 } },
        bank: {
          houses: payment.state.bank.houses + pack.housesPerHotel,
          hotels: payment.state.bank.hotels - 1,
        },
      },
      events: [{ type: 'HOTEL_BUILT', playerId, squareId, cost: square.buildCost }],
    });
  }

  return ok({
    state: {
      ...payment.state,
      deeds: { ...payment.state.deeds, [squareId]: { ...deed, houses: deed.houses + 1 } },
      bank: { ...payment.state.bank, houses: payment.state.bank.houses - 1 },
    },
    events: [
      {
        type: 'HOUSE_BUILT',
        playerId,
        squareId,
        cost: square.buildCost,
        houses: deed.houses + 1,
      },
    ],
  });
}

/** Why this player cannot sell a building here, or null if they can. */
export function sellBlockedBy(
  state: GameState,
  playerId: PlayerId,
  squareId: SquareId,
): RuleViolation | null {
  const blocked = managementBlockedBy(state, playerId);
  if (blocked !== null) return blocked;

  const square = getSquare(boardOf(state), squareId);
  if (square.kind !== 'property') {
    return violation('SQUARE_NOT_OWNABLE', 'There is nothing built there.');
  }

  const deed = getDeed(state, squareId);
  if (deed.ownerId !== playerId) {
    return violation('NOT_THE_OWNER', 'You do not own that.');
  }

  const level = developmentLevel(deed);
  if (level === 0) {
    return violation('NO_BUILDINGS_TO_SELL', 'There is nothing built there.');
  }

  const levels = groupLevels(state, square.group);
  if (level < Math.max(...levels)) {
    return violation('UNEVEN_SELL', 'Sell evenly — take the tallest lots down first.');
  }

  // Breaking a hotel means putting four houses back on the lot, and the bank has
  // to have four to give.
  if (deed.hotels > 0 && state.bank.houses < boardOf(state).housesPerHotel) {
    return violation('BANK_OUT_OF_HOUSES', 'The bank has too few houses to break that hotel into.');
  }

  return null;
}

/**
 * Sells one step of development back to the bank, at half what it cost.
 *
 * A hotel comes down to four houses rather than to nothing, which is why the bank
 * needs four houses spare — the hotel was five houses' worth of building, and only
 * the fifth is being sold.
 */
export function sellBuilding(
  state: GameState,
  playerId: PlayerId,
  squareId: SquareId,
): Result<BuildResult, RuleViolation> {
  const blocked = sellBlockedBy(state, playerId, squareId);
  if (blocked !== null) return err(blocked);

  const pack = boardOf(state);
  const square = getSquare(pack, squareId);
  if (square.kind !== 'property') {
    throw new Error(`Square ${squareId} is not a lot`);
  }

  const deed = getDeed(state, squareId);
  const refund = square.buildCost / 2;

  if (deed.hotels > 0) {
    const next: DeedState = { ...deed, houses: pack.housesPerHotel, hotels: 0 };
    return ok({
      state: {
        ...credit(state, playerId, refund),
        deeds: { ...state.deeds, [squareId]: next },
        bank: {
          houses: state.bank.houses - pack.housesPerHotel,
          hotels: state.bank.hotels + 1,
        },
      },
      events: [
        {
          type: 'BUILDING_SOLD',
          playerId,
          squareId,
          refund,
          houses: next.houses,
          hotels: 0,
        },
      ],
    });
  }

  const next: DeedState = { ...deed, houses: deed.houses - 1 };
  return ok({
    state: {
      ...credit(state, playerId, refund),
      deeds: { ...state.deeds, [squareId]: next },
      bank: { ...state.bank, houses: state.bank.houses + 1 },
    },
    events: [{ type: 'BUILDING_SOLD', playerId, squareId, refund, houses: next.houses, hotels: 0 }],
  });
}

/** Every lot this player could build on right now. Drives the UI's build dialog. */
export function buildableSquares(state: GameState, playerId: PlayerId): readonly SquareId[] {
  return boardOf(state)
    .squares.filter((square) => buildBlockedBy(state, playerId, square.id) === null)
    .map((square) => square.id);
}

/** Every lot this player could sell a building from right now. */
export function sellableSquares(state: GameState, playerId: PlayerId): readonly SquareId[] {
  return boardOf(state)
    .squares.filter((square) => sellBlockedBy(state, playerId, square.id) === null)
    .map((square) => square.id);
}
