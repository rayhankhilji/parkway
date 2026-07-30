import type { DeckId, SquareId } from '../board/types';
import type { RngState } from '../rng/mulberry32';

/**
 * The game document.
 *
 * This is the whole of what the engine knows. It is stored as one JSONB column
 * (→ D6) and must therefore survive a JSON round trip unchanged: no Dates, no
 * Maps, no Sets, no undefined-valued fields, no class instances.
 *
 * Two fields are secret. `rng` lets a holder predict every future roll, and
 * `decks` gives away the order of both decks. Neither may reach a client, which
 * is why toPublicState exists and why it is the only exported serialiser.
 */

/** Matches players.id in the database. The engine never learns player names. */
export type PlayerId = string;

/** Two dice as rolled, in order. Totals and doubles are derived, never stored. */
export type DiceRoll = readonly [number, number];

export type GameConfig = {
  readonly startingCash: number;
  readonly salary: number;
  readonly freeParkingPot: boolean;
  readonly incomeTaxMode: 'flat' | 'percentage';
  readonly auctionOnDecline: boolean;
  readonly auctionSeconds: number;
};

export type PlayerState = {
  readonly id: PlayerId;
  readonly cash: number;
  readonly position: SquareId;
  readonly inJail: boolean;
  /** Completed attempts to leave the gaol on this sentence, 0 to pack.jail.maxTurns. */
  readonly jailAttempts: number;
  /** Which decks the player's held release cards came from, so each returns home. */
  readonly heldJailCards: readonly DeckId[];
  readonly bankrupt: boolean;
};

export type DeedState = {
  readonly ownerId: PlayerId | null;
  readonly mortgaged: boolean;
  /** 0 to 4. Always 0 when hotels is 1. */
  readonly houses: number;
  /** 0 or 1. Mirrors the bank's supply so accounting stays symmetrical. */
  readonly hotels: number;
};

/** A rotating queue of card ids. Drawing takes the head and returns it to the tail. */
export type DeckState = { readonly order: readonly string[] };

export type TradeSide = {
  readonly cash: number;
  readonly deedIds: readonly SquareId[];
  readonly jailCards: number;
};

export type TradeOffer = {
  readonly id: string;
  readonly fromId: PlayerId;
  readonly toId: PlayerId;
  /** What the proposer hands over. */
  readonly offered: TradeSide;
  /** What the proposer asks for in return. */
  readonly requested: TradeSide;
};

/**
 * Turn flow, as a discriminated union rather than a set of booleans, so that
 * impossible combinations cannot be represented (→ D10).
 *
 * Building, mortgaging and trading are deliberately absent: the real rules allow
 * them at almost any time, including on another player's turn, so they are
 * actions gated by predicates rather than phases.
 *
 * There is also no `lobby` phase. A game has no state document until it starts —
 * the database column is null until then — so a lobby variant would be
 * unreachable (→ D17).
 */
export type TurnPhase =
  | { readonly kind: 'awaiting_roll' }
  | { readonly kind: 'awaiting_jail_decision' }
  | { readonly kind: 'awaiting_purchase'; readonly squareId: SquareId }
  | {
      readonly kind: 'auction';
      readonly squareId: SquareId;
      readonly highBid: number;
      readonly highBidderId: PlayerId | null;
      /** Players who have not yet passed. Passing is final for the auction. */
      readonly activeBidderIds: readonly PlayerId[];
      /** Epoch milliseconds. Compared against a server-stamped now, never a clock. */
      readonly deadlineAt: number;
      /**
       * Set when the auction is one of a bankrupt player's estate being sold off
       * in board order, so the sequence resumes with the next lot (→ PRD F14).
       */
      readonly estateRemainingIds: readonly SquareId[];
    }
  | { readonly kind: 'awaiting_end_turn' };

export type Phase =
  | TurnPhase
  | {
      readonly kind: 'awaiting_debt';
      readonly debtorId: PlayerId;
      /** null when the debt is owed to the bank. */
      readonly creditorId: PlayerId | null;
      readonly amount: number;
      /** The phase to restore once the debt is settled or the debtor is out. */
      readonly interrupted: TurnPhase;
      /**
       * Obligations still outstanding once this debt clears, in the order they
       * were created.
       *
       * One card can create several payments at once — "pay every other player
       * £50" makes four, and "collect £10 from every other player" makes four with
       * a *different debtor* each. If the second of four cannot be covered, the
       * remaining two have to survive the debt, or settling would quietly cancel
       * money owed by or to players who had nothing to do with the shortfall.
       *
       * The debtor is named per obligation for exactly that reason.
       */
      readonly remaining: readonly {
        readonly debtorId: PlayerId;
        readonly creditorId: PlayerId | null;
        readonly amount: number;
      }[];
    }
  | { readonly kind: 'game_over'; readonly winnerId: PlayerId };

export type GameState = {
  readonly version: 1;
  readonly boardPackId: string;
  readonly config: GameConfig;

  readonly phase: Phase;
  readonly players: Readonly<Record<PlayerId, PlayerState>>;
  /** Shuffled at start. This is turn order; seats are a separate UI concept. */
  readonly turnOrder: readonly PlayerId[];
  readonly activeIndex: number;

  /** Keyed by square id. Only ownable squares appear. */
  readonly deeds: Readonly<Record<SquareId, DeedState>>;
  readonly bank: { readonly houses: number; readonly hotels: number };
  /** The free-parking pot. Always 0 unless config.freeParkingPot is on. */
  readonly pot: number;

  /** At most one offer is open per game at a time (→ PRD F13). */
  readonly openTrade: TradeOffer | null;

  readonly turn: {
    readonly doublesCount: number;
    readonly hasRolled: boolean;
    /** The roll that produced the current position. Utility rent reads it. */
    readonly lastRoll: DiceRoll | null;
  };

  /** SECRET. Card order for both decks. */
  readonly decks: { readonly chance: DeckState; readonly chest: DeckState };
  /** SECRET. Holding this predicts every future roll. */
  readonly rng: RngState;
};

/**
 * What a client is allowed to see: the same document with the RNG removed and
 * each deck reduced to a count of cards remaining in its cycle.
 */
export type PublicGameState = Omit<GameState, 'decks' | 'rng'> & {
  readonly decks: { readonly chance: number; readonly chest: number };
};
