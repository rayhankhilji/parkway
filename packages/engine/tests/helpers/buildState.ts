import { isOwnable } from '../../src/board/lookup';
import { getBoardPack } from '../../src/board/registry';
import type { DeckId, SquareId } from '../../src/board/types';
import { createRng } from '../../src/rng/mulberry32';
import type {
  DeedState,
  GameConfig,
  GameState,
  Phase,
  PlayerId,
  PlayerState,
} from '../../src/state/types';

/**
 * Building arbitrary positions for tests.
 *
 * The rules worth testing are the ones that only appear in awkward positions —
 * a player one house short of a hotel while the bank holds four, a mortgaged
 * station reached by card, a creditor who is themselves in debt. Reaching those
 * by playing forwards from the opening would take hundreds of scripted actions
 * and would break every time an unrelated rule changed.
 *
 * So tests declare the position they care about and leave everything else at a
 * sensible default. Every field is overridable, nothing is hidden, and the
 * result is a genuine GameState — not a partial one cast into shape, which would
 * let a test pass against a state the engine could never produce.
 */

export const testConfig: GameConfig = {
  startingCash: 1500,
  salary: 200,
  freeParkingPot: false,
  incomeTaxMode: 'flat',
  auctionOnDecline: true,
  auctionSeconds: 30,
};

export type PlayerOverrides = Partial<Omit<PlayerState, 'id'>>;

export type DeedOverrides = Partial<DeedState>;

export type BuildStateOptions = {
  /** Turn order, and the ids used everywhere else. Defaults to Ada and Bo. */
  readonly playerIds?: readonly PlayerId[];
  readonly players?: Readonly<Record<PlayerId, PlayerOverrides>>;
  /** Ownership and development, keyed by square id. Everything else stays unowned. */
  readonly deeds?: Readonly<Record<SquareId, DeedOverrides>>;
  readonly phase?: Phase;
  readonly activeIndex?: number;
  readonly config?: Partial<GameConfig>;
  readonly bank?: Partial<GameState['bank']>;
  readonly pot?: number;
  readonly turn?: Partial<GameState['turn']>;
  readonly openTrade?: GameState['openTrade'];
  readonly boardPackId?: string;
  readonly seed?: number;
  /** Deck order, top card first. Defaults to the pack's declared order. */
  readonly decks?: { readonly chance?: readonly string[]; readonly chest?: readonly string[] };
};

export function buildState(options: BuildStateOptions = {}): GameState {
  const boardPackId = options.boardPackId ?? 'parkway-classic';
  const pack = getBoardPack(boardPackId);
  const config: GameConfig = { ...testConfig, ...options.config };
  const turnOrder = options.playerIds ?? ['ada', 'bo'];

  if (new Set(turnOrder).size !== turnOrder.length) {
    throw new Error('buildState received duplicate player ids');
  }

  const players: Record<PlayerId, PlayerState> = {};
  for (const id of [...turnOrder].sort()) {
    players[id] = {
      id,
      cash: config.startingCash,
      position: pack.startSquareId,
      inJail: false,
      jailAttempts: 0,
      heldJailCards: [],
      bankrupt: false,
      ...options.players?.[id],
    };
  }

  for (const id of Object.keys(options.players ?? {})) {
    if (players[id] === undefined) {
      throw new Error(`buildState was given overrides for ${id}, who is not in playerIds`);
    }
  }

  const deeds: Record<SquareId, DeedState> = {};
  for (const square of pack.squares) {
    if (isOwnable(square)) {
      deeds[square.id] = {
        ownerId: null,
        mortgaged: false,
        houses: 0,
        hotels: 0,
        ...options.deeds?.[square.id],
      };
    }
  }

  for (const key of Object.keys(options.deeds ?? {})) {
    if (deeds[Number(key)] === undefined) {
      throw new Error(
        `buildState was given deed overrides for square ${key}, which is not ownable`,
      );
    }
  }

  const activeIndex = options.activeIndex ?? 0;
  if (activeIndex < 0 || activeIndex >= turnOrder.length) {
    throw new Error(`buildState activeIndex ${activeIndex} is outside the turn order`);
  }

  /**
   * A held release card is out of its deck's cycle, so giving a player one has to
   * take it out of the deck too.
   *
   * Without this a test can build a state the engine could never produce — the same
   * card in two places at once — and then fail on an error that has nothing to do
   * with what it was testing.
   */
  function deckOrder(deck: DeckId): readonly string[] {
    const declared = options.decks?.[deck] ?? pack.decks[deck].map((card) => card.id);
    const heldFromThisDeck = Object.values(players).reduce(
      (count, player) => count + player.heldJailCards.filter((held) => held === deck).length,
      0,
    );

    if (heldFromThisDeck === 0) return declared;

    const releaseId = pack.decks[deck].find((card) => card.effect.kind === 'get_out_of_jail')?.id;
    if (releaseId === undefined) {
      throw new Error(`Board pack ${pack.id} has no release card in the ${deck} deck`);
    }
    if (heldFromThisDeck > 1) {
      throw new Error(
        `buildState was asked for ${heldFromThisDeck} held ${deck} release cards, but there is only one`,
      );
    }

    return declared.filter((id) => id !== releaseId);
  }

  return {
    version: 1,
    boardPackId,
    config,
    phase: options.phase ?? { kind: 'awaiting_roll' },
    players,
    turnOrder,
    activeIndex,
    deeds,
    bank: { houses: pack.bank.houses, hotels: pack.bank.hotels, ...options.bank },
    pot: options.pot ?? 0,
    openTrade: options.openTrade ?? null,
    turn: { doublesCount: 0, hasRolled: false, lastRoll: null, ...options.turn },
    decks: {
      chance: { order: deckOrder('chance') },
      chest: { order: deckOrder('chest') },
    },
    rng: createRng(options.seed ?? 1),
  };
}

/**
 * Every square on the board that a given group occupies. Saves tests from
 * hardcoding square ids, which would tie them to one board pack.
 */
export function groupSquareIds(
  groupId: string,
  boardPackId = 'parkway-classic',
): readonly number[] {
  const pack = getBoardPack(boardPackId);
  const group = pack.groups.find((candidate) => candidate.id === groupId);
  if (group === undefined) {
    throw new Error(`Group ${groupId} is not in board pack ${boardPackId}`);
  }
  return group.memberIds;
}

/** Assigns a whole group to one owner, at the given development level. */
export function ownGroup(
  groupId: string,
  ownerId: PlayerId,
  overrides: DeedOverrides = {},
): Record<SquareId, DeedOverrides> {
  const deeds: Record<SquareId, DeedOverrides> = {};
  for (const id of groupSquareIds(groupId)) {
    deeds[id] = { ownerId, ...overrides };
  }
  return deeds;
}
