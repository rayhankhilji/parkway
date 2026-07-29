import { getBoardPack } from '../board/registry';
import { isOwnable } from '../board/lookup';
import type { SquareId } from '../board/types';
import { violation, type RuleViolation } from '../errors';
import { createRng, shuffle } from '../rng/mulberry32';
import { err, ok, type Result } from '../result';
import type { DeedState, GameConfig, GameState, PlayerId, PlayerState } from './types';

/**
 * Turns a lobby roster into the opening position.
 *
 * This is the only function that creates a game document, and the only one the
 * server calls with a seed. Everything downstream is a transformation of what
 * comes out of here, which is why replaying an action log from `initial_state`
 * has to land exactly on the stored final state.
 *
 * Determinism has one requirement that is easy to break by accident: the order
 * in which randomness is consumed. Turn order is drawn first, then the fortune
 * deck, then the civic deck. Reordering those three lines changes every game
 * that has ever been recorded, so do not.
 */

export const minPlayers = 2;
export const maxPlayers = 6;

export type CreateGameInput = {
  readonly playerIds: readonly PlayerId[];
  readonly config: GameConfig;
  readonly boardPackId: string;
  /** Drawn once by the server from a real entropy source, then never touched again. */
  readonly seed: number;
};

export function createGame(input: CreateGameInput): Result<GameState, RuleViolation> {
  const { playerIds, config, boardPackId, seed } = input;

  if (playerIds.length < minPlayers) {
    return err(
      violation('NOT_ENOUGH_PLAYERS', `A game needs at least ${minPlayers} players to start.`),
    );
  }

  if (playerIds.length > maxPlayers) {
    return err(violation('TOO_MANY_PLAYERS', `A game holds at most ${maxPlayers} players.`));
  }

  // A duplicate id is not a player doing something disallowed — it is the caller
  // handing over a roster that cannot exist, given the unique constraints on the
  // players table. Broken invariants throw; rule violations are returned.
  if (new Set(playerIds).size !== playerIds.length) {
    throw new Error('createGame received duplicate player ids');
  }

  const pack = getBoardPack(boardPackId);

  const [turnOrder, afterTurnOrder] = shuffle(playerIds, createRng(seed));
  const [chanceOrder, afterChance] = shuffle(
    pack.decks.chance.map((card) => card.id),
    afterTurnOrder,
  );
  const [chestOrder, afterChest] = shuffle(
    pack.decks.chest.map((card) => card.id),
    afterChance,
  );

  const players: Record<PlayerId, PlayerState> = {};
  // Inserted in sorted id order rather than roster order so that the serialised
  // document does not depend on the order the database happened to return rows
  // in. Turn order lives in its own array and is unaffected.
  for (const id of [...playerIds].sort()) {
    players[id] = {
      id,
      cash: config.startingCash,
      position: pack.startSquareId,
      inJail: false,
      jailAttempts: 0,
      heldJailCards: [],
      bankrupt: false,
    };
  }

  const deeds: Record<SquareId, DeedState> = {};
  for (const square of pack.squares) {
    if (isOwnable(square)) {
      deeds[square.id] = { ownerId: null, mortgaged: false, houses: 0, hotels: 0 };
    }
  }

  return ok({
    version: 1,
    boardPackId: pack.id,
    config,
    phase: { kind: 'awaiting_roll' },
    players,
    turnOrder,
    activeIndex: 0,
    deeds,
    bank: { houses: pack.bank.houses, hotels: pack.bank.hotels },
    pot: 0,
    openTrade: null,
    turn: { doublesCount: 0, hasRolled: false, lastRoll: null },
    decks: { chance: { order: chanceOrder }, chest: { order: chestOrder } },
    rng: afterChest,
  });
}
