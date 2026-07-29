import { getOwnableSquare, getSquare, isOwnable } from '../board/lookup';
import { getBoardPack } from '../board/registry';
import type { BoardPack, GroupId, OwnableSquare, SquareId } from '../board/types';
import type { DeedState, DiceRoll, GameState, PlayerId, PlayerState } from './types';

/**
 * Questions about a game in progress, answered without changing anything.
 *
 * Rules are built from these rather than reaching into the state document
 * directly, so that "does this player hold the complete group" has exactly one
 * implementation to get right and one place to fix when it is wrong.
 */

export function boardOf(state: GameState): BoardPack {
  return getBoardPack(state.boardPackId);
}

export function getPlayer(state: GameState, id: PlayerId): PlayerState {
  const player = state.players[id];
  if (player === undefined) {
    throw new Error(`Player ${id} is not in this game`);
  }
  return player;
}

export function findPlayer(state: GameState, id: PlayerId): PlayerState | undefined {
  return state.players[id];
}

export function getDeed(state: GameState, squareId: SquareId): DeedState {
  const deed = state.deeds[squareId];
  if (deed === undefined) {
    throw new Error(`Square ${squareId} is not ownable on this board`);
  }
  return deed;
}

export function activePlayerId(state: GameState): PlayerId {
  const id = state.turnOrder[state.activeIndex];
  if (id === undefined) {
    throw new Error(`activeIndex ${state.activeIndex} is outside the turn order`);
  }
  return id;
}

export function isActivePlayer(state: GameState, id: PlayerId): boolean {
  return activePlayerId(state) === id;
}

/** Players still in the game, in turn order. */
export function solventPlayerIds(state: GameState): readonly PlayerId[] {
  return state.turnOrder.filter((id) => !getPlayer(state, id).bankrupt);
}

export function diceTotal(roll: DiceRoll): number {
  return roll[0] + roll[1];
}

export function isDouble(roll: DiceRoll): boolean {
  return roll[0] === roll[1];
}

/** Every ownable square held by a player, in board order. */
export function ownedSquares(state: GameState, playerId: PlayerId): readonly OwnableSquare[] {
  const pack = boardOf(state);
  return pack.squares.filter(
    (square): square is OwnableSquare =>
      isOwnable(square) && getDeed(state, square.id).ownerId === playerId,
  );
}

export function countOwnedOfKind(
  state: GameState,
  playerId: PlayerId,
  kind: 'transit' | 'utility',
): number {
  return ownedSquares(state, playerId).filter((square) => square.kind === kind).length;
}

/**
 * Whether the player holds every lot in the group.
 *
 * Says nothing about mortgages or buildings — callers that care ask separately,
 * because "owns the group" and "may build on the group" are different questions
 * with different answers, and conflating them is how rent doubling ends up wrong.
 */
export function ownsFullGroup(state: GameState, playerId: PlayerId, group: GroupId): boolean {
  const pack = boardOf(state);
  const definition = pack.groups.find((candidate) => candidate.id === group);
  if (definition === undefined) {
    throw new Error(`Group ${group} is not in board pack ${pack.id}`);
  }
  return definition.memberIds.every((id) => getDeed(state, id).ownerId === playerId);
}

export function groupIsUnmortgaged(state: GameState, group: GroupId): boolean {
  const pack = boardOf(state);
  const definition = pack.groups.find((candidate) => candidate.id === group);
  if (definition === undefined) {
    throw new Error(`Group ${group} is not in board pack ${pack.id}`);
  }
  return definition.memberIds.every((id) => !getDeed(state, id).mortgaged);
}

export function buildingsOn(state: GameState, squareId: SquareId): number {
  const deed = getDeed(state, squareId);
  return deed.houses + deed.hotels;
}

/** What a player's buildings originally cost, used for net worth. */
export function buildingCostOf(state: GameState, playerId: PlayerId): number {
  const pack = boardOf(state);
  let total = 0;
  for (const square of ownedSquares(state, playerId)) {
    if (square.kind !== 'property') continue;
    const deed = getDeed(state, square.id);
    const hotelHouses = deed.hotels * (pack.housesPerHotel + 1);
    total += (deed.houses + hotelHouses) * square.buildCost;
  }
  return total;
}

/**
 * Total worth: cash, the printed price of every property held whether mortgaged
 * or not, and buildings at cost. This is the figure a percentage income tax is
 * assessed against (→ PRD F15).
 */
export function netWorth(state: GameState, playerId: PlayerId): number {
  const player = getPlayer(state, playerId);
  const propertyValue = ownedSquares(state, playerId).reduce(
    (total, square) => total + square.price,
    0,
  );
  return player.cash + propertyValue + buildingCostOf(state, playerId);
}

/**
 * The most cash a player could raise without trading: what they hold, plus what
 * the bank would pay for their buildings at half price, plus mortgage value on
 * everything not already mortgaged.
 *
 * A debtor who cannot reach the amount owed even at this figure has no way out
 * but bankruptcy, which is what makes this the test for it (→ PRD F12, F14).
 */
export function liquidatableValue(state: GameState, playerId: PlayerId): number {
  const pack = boardOf(state);
  const player = getPlayer(state, playerId);
  let total = player.cash;

  for (const square of ownedSquares(state, playerId)) {
    const deed = getDeed(state, square.id);
    if (!deed.mortgaged) {
      total += square.mortgageValue;
    }
    if (square.kind === 'property') {
      const hotelHouses = deed.hotels * (pack.housesPerHotel + 1);
      total += ((deed.houses + hotelHouses) * square.buildCost) / 2;
    }
  }

  return total;
}

export function isSolvent(state: GameState, playerId: PlayerId, amount: number): boolean {
  return liquidatableValue(state, playerId) >= amount;
}

export function canPayInCash(state: GameState, playerId: PlayerId, amount: number): boolean {
  return getPlayer(state, playerId).cash >= amount;
}

/** The price the bank charges for the square, used by purchase and auction. */
export function priceOf(state: GameState, squareId: SquareId): number {
  return getOwnableSquare(boardOf(state), squareId).price;
}

export function squareNameOf(state: GameState, squareId: SquareId): string {
  return getSquare(boardOf(state), squareId).name;
}
