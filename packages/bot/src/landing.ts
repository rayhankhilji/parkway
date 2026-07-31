import { findNextSquareOfKind, getSquare, type BoardPack, type SquareId } from '@parkway/engine';

/**
 * How often a token comes to rest on each square, in the long run.
 *
 * This is the number every other judgement in the bot is built on, and it is the
 * reason a good player prizes the orange and red groups: they sit six to nine
 * squares past the gaol, which is the single most-visited square on the board, so
 * a token leaving it lands there more often than anywhere else. Nothing else in
 * Monopoly strategy matters as much, and none of it is obvious from the prices.
 *
 * The board is a Markov chain: from any square, two dice give a distribution over
 * the next, and a handful of squares divert the token somewhere else entirely —
 * go-to-gaol, and the movement cards. Iterating that to a steady state gives the
 * long-run frequency of each square.
 *
 * Read from the board pack rather than hardcoded, so a different board gets its
 * own analysis rather than the classic board's numbers applied to the wrong
 * squares.
 */

/** Probability of each total from two six-sided dice, indexed by total. */
function diceDistribution(pack: BoardPack): ReadonlyMap<number, number> {
  const faces = pack.dice.faces;
  const counts = new Map<number, number>();

  for (let first = 1; first <= faces; first += 1) {
    for (let second = 1; second <= faces; second += 1) {
      const total = first + second;
      counts.set(total, (counts.get(total) ?? 0) + 1);
    }
  }

  const outcomes = faces * faces;
  return new Map([...counts].map(([total, count]) => [total, count / outcomes]));
}

/**
 * Where a token actually ends up after arriving at a square.
 *
 * Most squares keep it. The go-to-gaol square sends it away, and a card square
 * sends it away for whichever fraction of the deck moves it — which is read from
 * the pack's own card effects rather than assumed.
 *
 * Card chains are followed one step only. On the classic board the one case that
 * chains is "go back three" from the last Fortune square, which lands on a Civic
 * Fund square; following it further would need the deck order, which is secret,
 * and the correction is small.
 */
function settle(pack: BoardPack, arrivedAt: SquareId, depth = 0): ReadonlyMap<SquareId, number> {
  const square = getSquare(pack, arrivedAt);
  const spread = new Map<SquareId, number>();

  const add = (id: SquareId, weight: number): void => {
    spread.set(id, (spread.get(id) ?? 0) + weight);
  };

  if (square.kind === 'go_to_jail') {
    add(pack.jail.squareId, 1);
    return spread;
  }

  if (square.kind !== 'card' || depth > 1) {
    add(arrivedAt, 1);
    return spread;
  }

  const deck = pack.decks[square.deck];
  const share = 1 / deck.length;
  let stays = 0;

  for (const card of deck) {
    const effect = card.effect;
    let destination: SquareId | null = null;

    switch (effect.kind) {
      case 'move_to':
        destination = effect.squareId;
        break;
      case 'move_relative':
        destination =
          (((arrivedAt + effect.offset) % pack.squares.length) + pack.squares.length) %
          pack.squares.length;
        break;
      case 'move_to_nearest':
        destination = findNextSquareOfKind(pack, arrivedAt, effect.target);
        break;
      case 'go_to_jail':
        destination = pack.jail.squareId;
        break;
      default:
        destination = null;
    }

    if (destination === null) {
      stays += share;
      continue;
    }

    // Landing somewhere by card can divert again — going back three squares can
    // land on another card square.
    for (const [id, weight] of settle(pack, destination, depth + 1)) {
      add(id, share * weight);
    }
  }

  if (stays > 0) add(arrivedAt, stays);
  return spread;
}

export type LandingOdds = {
  /** Long-run share of landings, indexed by square id. Sums to one. */
  readonly bySquare: readonly number[];
};

/**
 * Iterates the chain to its steady state.
 *
 * Two hundred rounds is far more than needed — the chain mixes in about twenty —
 * but it is cheap, runs once per board, and removes any question about whether the
 * numbers have settled.
 *
 * The gaol is modelled as an ordinary square. A player who is actually locked up
 * skips turns, which this does not represent; the effect is to understate the gaol
 * slightly and everything downstream of it proportionally, which does not change
 * the ranking of anything.
 */
export function landingOdds(pack: BoardPack): LandingOdds {
  const size = pack.squares.length;
  const dice = diceDistribution(pack);

  // transition[from][to]
  const transition: number[][] = Array.from({ length: size }, () =>
    new Array<number>(size).fill(0),
  );

  for (let from = 0; from < size; from += 1) {
    const row = transition[from];
    if (row === undefined) continue;

    for (const [total, probability] of dice) {
      const arrivedAt = (from + total) % size;
      for (const [id, weight] of settle(pack, arrivedAt)) {
        row[id] = (row[id] ?? 0) + probability * weight;
      }
    }

    // Three doubles sends a player to the gaol without moving. One turn in two
    // hundred and sixteen, which is small but pulls in the same direction as
    // everything else that feeds the gaol.
    const tripleDouble = 1 / (pack.dice.faces * pack.dice.faces) ** 3;
    row[pack.jail.squareId] = (row[pack.jail.squareId] ?? 0) + tripleDouble;
    const total = row.reduce((sum, value) => sum + value, 0);
    for (let to = 0; to < size; to += 1) {
      row[to] = (row[to] ?? 0) / total;
    }
  }

  let distribution = new Array<number>(size).fill(1 / size);

  for (let round = 0; round < 200; round += 1) {
    const next = new Array<number>(size).fill(0);
    for (let from = 0; from < size; from += 1) {
      const mass = distribution[from] ?? 0;
      if (mass === 0) continue;
      const row = transition[from];
      if (row === undefined) continue;
      for (let to = 0; to < size; to += 1) {
        next[to] = (next[to] ?? 0) + mass * (row[to] ?? 0);
      }
    }
    distribution = next;
  }

  return { bySquare: distribution };
}

/** Cached per board pack: the chain is identical every time for a given board. */
const cache = new Map<string, LandingOdds>();

export function landingOddsFor(pack: BoardPack): LandingOdds {
  const cached = cache.get(pack.id);
  if (cached !== undefined) return cached;
  const computed = landingOdds(pack);
  cache.set(pack.id, computed);
  return computed;
}
