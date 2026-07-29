import type { BoardPack, GroupDefinition, OwnableSquare, Square, SquareId } from './types';

/**
 * Questions you can ask a board without knowing anything about a game in
 * progress. Anything that needs to know who owns what belongs in selectors.ts.
 */

export function getSquare(pack: BoardPack, id: SquareId): Square {
  const square = pack.squares[id];
  if (square === undefined) {
    throw new Error(`Square ${id} is not on board pack ${pack.id}`);
  }
  return square;
}

export function isOwnable(square: Square): square is OwnableSquare {
  return square.kind === 'property' || square.kind === 'transit' || square.kind === 'utility';
}

export function getOwnableSquare(pack: BoardPack, id: SquareId): OwnableSquare {
  const square = getSquare(pack, id);
  if (!isOwnable(square)) {
    throw new Error(`Square ${id} (${square.kind}) cannot be owned`);
  }
  return square;
}

export function listOwnableSquares(pack: BoardPack): readonly OwnableSquare[] {
  return pack.squares.filter(isOwnable);
}

export function getGroup(pack: BoardPack, id: string): GroupDefinition {
  const group = pack.groups.find((candidate) => candidate.id === id);
  if (group === undefined) {
    throw new Error(`Group ${id} is not in board pack ${pack.id}`);
  }
  return group;
}

export function countSquaresOfKind(pack: BoardPack, kind: Square['kind']): number {
  return pack.squares.filter((square) => square.kind === kind).length;
}

/**
 * The first square of the given kind at or ahead of `from`, travelling forward
 * and wrapping. Used by the card effects that send a player to the nearest
 * station or utility (→ PRD F10).
 *
 * Search starts one square ahead, not at `from` itself: a card drawn while
 * standing on a station sends the player to the *next* one.
 */
export function findNextSquareOfKind(
  pack: BoardPack,
  from: SquareId,
  kind: Square['kind'],
): SquareId {
  const size = pack.squares.length;
  for (let step = 1; step <= size; step += 1) {
    const candidate = (from + step) % size;
    if (getSquare(pack, candidate).kind === kind) {
      return candidate;
    }
  }
  throw new Error(`Board pack ${pack.id} contains no square of kind ${kind}`);
}
