/**
 * The board as data.
 *
 * The engine holds no knowledge of any particular board. It reads a BoardPack,
 * and every price, rent, name and card in play comes from there. Two things fall
 * out of that. Rules become testable on tiny synthetic boards — twelve squares
 * with two groups is enough to exercise even-build in isolation — and the shipped
 * board can carry original names and original card text without any rule knowing
 * or caring (→ D7, D16).
 */

/** A square's index on the board, 0-based, in travel order. */
export type SquareId = number;

/** Identifies a colour group. The value is also the design token suffix. */
export type GroupId = string;

export type DeckId = 'chance' | 'chest';

/**
 * Rent for a lot, indexed by development level:
 * [unimproved, 1 house, 2 houses, 3 houses, 4 houses, hotel].
 *
 * The unimproved figure is the base rate. Doubling it when the owner holds the
 * complete unmortgaged group is a rule, so it lives in rules/rent.ts, not here.
 */
export type RentTable = readonly [number, number, number, number, number, number];

export type CardEffect =
  | { readonly kind: 'pay'; readonly amount: number }
  | { readonly kind: 'collect'; readonly amount: number }
  | { readonly kind: 'move_to'; readonly squareId: SquareId }
  | { readonly kind: 'move_relative'; readonly offset: number }
  | { readonly kind: 'move_to_nearest'; readonly target: 'transit' | 'utility' }
  | { readonly kind: 'go_to_jail' }
  | { readonly kind: 'get_out_of_jail' }
  | { readonly kind: 'repairs'; readonly perHouse: number; readonly perHotel: number }
  | { readonly kind: 'pay_each_player'; readonly amount: number }
  | { readonly kind: 'collect_from_each_player'; readonly amount: number };

export type Card = {
  readonly id: string;
  readonly deck: DeckId;
  readonly text: string;
  readonly effect: CardEffect;
};

export type Square =
  | { readonly kind: 'start'; readonly id: SquareId; readonly name: string }
  | {
      readonly kind: 'property';
      readonly id: SquareId;
      readonly name: string;
      readonly group: GroupId;
      readonly price: number;
      readonly mortgageValue: number;
      readonly buildCost: number;
      readonly rent: RentTable;
    }
  | {
      readonly kind: 'transit';
      readonly id: SquareId;
      readonly name: string;
      readonly price: number;
      readonly mortgageValue: number;
    }
  | {
      readonly kind: 'utility';
      readonly id: SquareId;
      readonly name: string;
      readonly price: number;
      readonly mortgageValue: number;
    }
  | {
      readonly kind: 'tax';
      readonly id: SquareId;
      readonly name: string;
      readonly flatAmount: number;
      /**
       * The percentage alternative, as a rate of net worth, or null where the
       * square has no percentage option. Only squares offering both are affected
       * by the incomeTaxMode config (→ PRD F15).
       */
      readonly percentageRate: number | null;
    }
  | {
      readonly kind: 'card';
      readonly id: SquareId;
      readonly name: string;
      readonly deck: DeckId;
    }
  | { readonly kind: 'jail'; readonly id: SquareId; readonly name: string }
  | { readonly kind: 'free_parking'; readonly id: SquareId; readonly name: string }
  | { readonly kind: 'go_to_jail'; readonly id: SquareId; readonly name: string };

/** A square a player can own. The three ownable kinds, narrowed. */
export type OwnableSquare = Extract<Square, { kind: 'property' | 'transit' | 'utility' }>;

export type GroupDefinition = {
  readonly id: GroupId;
  readonly name: string;
  /** Design token suffix, e.g. 'group-1' resolves to --color-group-1. */
  readonly colourToken: string;
  readonly memberIds: readonly SquareId[];
};

export type BoardPack = {
  readonly id: string;
  readonly name: string;
  readonly currencySymbol: string;
  readonly squares: readonly Square[];
  readonly groups: readonly GroupDefinition[];

  readonly transit: {
    /** Rent by number of transit squares the owner holds, from one upward. */
    readonly rentByCount: readonly number[];
    /** Multiplier applied when a card sends a player here (→ PRD F10). */
    readonly cardPenaltyMultiplier: number;
  };

  readonly utility: {
    /** Dice multiplier by number of utilities the owner holds, from one upward. */
    readonly multiplierByCount: readonly number[];
    /** Dice multiplier applied when a card sends a player here (→ PRD F10). */
    readonly cardPenaltyMultiplier: number;
  };

  /** Finite supply. When it runs out, building is refused (→ PRD F11). */
  readonly bank: { readonly houses: number; readonly hotels: number };

  readonly auction: {
    /**
     * The smallest amount a new bid must beat the standing one by.
     *
     * Board data rather than a game setting: it belongs with the prices it is
     * measured against, and PRD F15's list of configurable variants is fixed.
     */
    readonly minimumIncrement: number;
  };

  readonly jail: {
    readonly squareId: SquareId;
    readonly fine: number;
    /** Attempts allowed before the fine becomes compulsory. */
    readonly maxTurns: number;
  };

  readonly startSquareId: SquareId;
  readonly goToJailSquareId: SquareId;

  /** Charged on top of the mortgage value when clearing a mortgage. */
  readonly mortgageInterestRate: number;

  /** Houses returned to the bank when a fifth becomes a hotel. */
  readonly housesPerHotel: number;

  readonly dice: { readonly count: number; readonly faces: number };

  readonly decks: { readonly chance: readonly Card[]; readonly chest: readonly Card[] };
};
