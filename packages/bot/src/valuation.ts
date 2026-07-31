import {
  getBoardPack,
  getSquare,
  isOwnable,
  type BoardPack,
  type OwnableSquare,
  type PlayerId,
  type PublicGameState,
  type SquareId,
} from '@parkway/engine';
import { landingOddsFor } from './landing';

/**
 * What things are worth.
 *
 * Everything here is expressed as expected income per opponent turn, which is the
 * only currency that lets a station, a lot and a hotel be compared to each other.
 * Price is deliberately not used as a proxy for value: the whole point of the
 * landing analysis is that the board's prices are a poor guide to its returns.
 *
 * The bot sees only what a human sees. Every function takes PublicGameState, so a
 * bot can never consult the deck order or the generator, and a bot that appears to
 * read the dice is a bug rather than a difficulty setting.
 */

export type Difficulty = 'gentle' | 'steady' | 'sharp' | 'ruthless';

export type Profile = {
  /** Turns of income a purchase must repay within to look worth making. */
  readonly horizon: number;
  /** Cash kept back against the next rent bill rather than spent. */
  readonly reserve: number;
  /** How much extra a lot is worth for completing or denying a group. */
  readonly groupWeight: number;
  /** The fraction of a lot's value the bot will bid up to at auction. */
  readonly bidCeiling: number;
  /** Whether to sit in the gaol once the board has become dangerous. */
  readonly usesJailStrategy: boolean;
  /** How often it deliberately takes a worse option, 0 to 1. */
  readonly noise: number;
};

/**
 * The difficulty tiers.
 *
 * They differ in judgement rather than in information — none of them cheats. A
 * gentle bot values a group barely above its parts, keeps almost nothing back for
 * rent, and blunders roughly one decision in four. A ruthless one values groups
 * properly, holds a reserve, bids close to true value and never blunders.
 */
export const profiles: Readonly<Record<Difficulty, Profile>> = {
  gentle: {
    horizon: 12,
    reserve: 0,
    groupWeight: 1.05,
    bidCeiling: 0.6,
    usesJailStrategy: false,
    noise: 0.25,
  },
  steady: {
    horizon: 22,
    reserve: 100,
    groupWeight: 1.4,
    bidCeiling: 0.85,
    usesJailStrategy: false,
    noise: 0.1,
  },
  sharp: {
    horizon: 32,
    reserve: 200,
    groupWeight: 1.9,
    bidCeiling: 1.0,
    usesJailStrategy: true,
    noise: 0.03,
  },
  ruthless: {
    horizon: 45,
    reserve: 300,
    groupWeight: 2.4,
    bidCeiling: 1.15,
    usesJailStrategy: true,
    noise: 0,
  },
};

export function boardOf(state: PublicGameState): BoardPack {
  return getBoardPack(state.boardPackId);
}

export function ownableAt(state: PublicGameState, squareId: SquareId): OwnableSquare | null {
  const square = getSquare(boardOf(state), squareId);
  return isOwnable(square) ? square : null;
}

/** Every square a player holds, whatever its state. */
export function holdings(state: PublicGameState, playerId: PlayerId): readonly OwnableSquare[] {
  return boardOf(state)
    .squares.filter(isOwnable)
    .filter((square) => state.deeds[square.id]?.ownerId === playerId);
}

function countOfKind(
  state: PublicGameState,
  playerId: PlayerId,
  kind: 'transit' | 'utility',
): number {
  return holdings(state, playerId).filter((square) => square.kind === kind).length;
}

function ladderAt(ladder: readonly number[], count: number): number {
  return ladder[Math.min(Math.max(count, 1), ladder.length) - 1] ?? 0;
}

/**
 * The rent a square would charge, if this player owned it in this state.
 *
 * Hypothetical on purpose: the interesting question is almost always "what would
 * this be worth to me", not "what is it worth to whoever has it".
 */
export function rentIfOwnedBy(
  state: PublicGameState,
  squareId: SquareId,
  playerId: PlayerId,
): number {
  const pack = boardOf(state);
  const square = ownableAt(state, squareId);
  if (square === null) return 0;

  const deed = state.deeds[squareId];
  if (deed?.mortgaged === true) return 0;

  switch (square.kind) {
    case 'property': {
      if ((deed?.hotels ?? 0) > 0) return square.rent[5];
      const houses = deed?.houses ?? 0;
      if (houses > 0) return square.rent[houses] ?? square.rent[0];

      const group = pack.groups.find((candidate) => candidate.id === square.group);
      const complete =
        group !== undefined && group.memberIds.every((id) => state.deeds[id]?.ownerId === playerId);
      return complete ? square.rent[0] * 2 : square.rent[0];
    }

    case 'transit': {
      // Counting this square as though it were already held, since that is the
      // question being asked.
      const held = countOfKind(state, playerId, 'transit');
      const withThis = state.deeds[squareId]?.ownerId === playerId ? held : held + 1;
      return ladderAt(pack.transit.rentByCount, withThis);
    }

    case 'utility': {
      const held = countOfKind(state, playerId, 'utility');
      const withThis = state.deeds[squareId]?.ownerId === playerId ? held : held + 1;
      // Averaged over the dice, since the multiplier applies to whatever is rolled.
      const averageRoll = pack.dice.count * ((pack.dice.faces + 1) / 2);
      return ladderAt(pack.utility.multiplierByCount, withThis) * averageRoll;
    }
  }
}

/** Expected income from a square, per turn taken by one opponent. */
export function incomePerOpponentTurn(
  state: PublicGameState,
  squareId: SquareId,
  playerId: PlayerId,
): number {
  const odds = landingOddsFor(boardOf(state)).bySquare[squareId] ?? 0;
  return odds * rentIfOwnedBy(state, squareId, playerId);
}

function opponentCount(state: PublicGameState, playerId: PlayerId): number {
  return state.turnOrder.filter((id) => id !== playerId && state.players[id]?.bankrupt === false)
    .length;
}

/**
 * What acquiring a square is worth, in cash.
 *
 * The income stream over the profile's horizon, multiplied up for how many
 * opponents can pay it, and weighted for what the square does to a group — both
 * completing one of the bot's own and denying somebody else theirs.
 */
export function acquisitionValue(
  state: PublicGameState,
  squareId: SquareId,
  playerId: PlayerId,
  profile: Profile,
): number {
  const square = ownableAt(state, squareId);
  if (square === null) return 0;

  const stream =
    incomePerOpponentTurn(state, squareId, playerId) *
    profile.horizon *
    Math.max(opponentCount(state, playerId), 1);

  return stream * groupMultiplier(state, square, playerId, profile);
}

/**
 * How much a square's group position is worth beyond its own rent.
 *
 * Completing a group is what unlocks building, which is what wins games — so the
 * last lot of a group is worth far more than the first. Taking the last lot
 * somebody else needs is worth nearly as much, because it stops them building at
 * all.
 */
function groupMultiplier(
  state: PublicGameState,
  square: OwnableSquare,
  playerId: PlayerId,
  profile: Profile,
): number {
  if (square.kind !== 'property') {
    // Stations are worth holding as a set too, just far less dramatically.
    const held = countOfKind(state, playerId, square.kind);
    return 1 + held * 0.15;
  }

  const pack = boardOf(state);
  const group = pack.groups.find((candidate) => candidate.id === square.group);
  if (group === undefined) return 1;

  const others = group.memberIds.filter((id) => id !== square.id);
  const mine = others.filter((id) => state.deeds[id]?.ownerId === playerId).length;
  const theirs = others.filter((id) => {
    const owner = state.deeds[id]?.ownerId;
    return owner !== null && owner !== undefined && owner !== playerId;
  }).length;

  // This square completes the group.
  if (mine === others.length) return profile.groupWeight;

  // Somebody else is one square away from completing it, and this is that square.
  if (theirs === others.length) return 1 + (profile.groupWeight - 1) * 0.8;

  // Partway there: worth something, but not yet the prize.
  return 1 + (profile.groupWeight - 1) * (mine / Math.max(others.length, 1)) * 0.5;
}

/**
 * The return on the next house, as income per turn per pound spent.
 *
 * This is the number that decides where to build. Ranking by it rather than by
 * rent is what stops a bot pouring money into the dark blues, whose rents are
 * enormous and whose squares are rarely landed on.
 */
export function buildReturn(
  state: PublicGameState,
  squareId: SquareId,
  playerId: PlayerId,
): number {
  const square = ownableAt(state, squareId);
  if (square === null || square.kind !== 'property') return 0;

  const deed = state.deeds[squareId];
  const level = (deed?.hotels ?? 0) > 0 ? 5 : (deed?.houses ?? 0);
  if (level >= 5) return 0;

  const current =
    level === 0 ? rentIfOwnedBy(state, squareId, playerId) : (square.rent[level] ?? 0);
  const next = square.rent[level + 1] ?? current;
  const odds = landingOddsFor(boardOf(state)).bySquare[squareId] ?? 0;

  return ((next - current) * odds * Math.max(opponentCount(state, playerId), 1)) / square.buildCost;
}

/** Everything a player could raise without trading, for judging danger. */
export function liquidity(state: PublicGameState, playerId: PlayerId): number {
  const pack = boardOf(state);
  const player = state.players[playerId];
  if (player === undefined) return 0;

  let total = player.cash;
  for (const square of holdings(state, playerId)) {
    const deed = state.deeds[square.id];
    if (deed === undefined) continue;
    if (!deed.mortgaged) total += square.mortgageValue;
    if (square.kind === 'property') {
      const standing = deed.houses + deed.hotels * (pack.housesPerHotel + 1);
      total += (standing * square.buildCost) / 2;
    }
  }
  return total;
}

/**
 * The worst rent bill on the board right now, from this player's point of view.
 *
 * Used to decide whether the gaol is a shelter or a cage: when the board is
 * developed enough that one bad roll ruins you, not moving is the better move.
 */
export function worstExposure(state: PublicGameState, playerId: PlayerId): number {
  let worst = 0;
  for (const square of boardOf(state).squares) {
    if (!isOwnable(square)) continue;
    const deed = state.deeds[square.id];
    const owner = deed?.ownerId;
    if (owner === null || owner === undefined || owner === playerId) continue;
    worst = Math.max(worst, rentIfOwnedBy(state, square.id, owner));
  }
  return worst;
}
