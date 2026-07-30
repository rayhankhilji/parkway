import type { SquareId } from '../board/types';
import type { GameEvent } from '../events/types';
import type { GameState, PlayerId } from '../state/types';
import { boardOf, getDeed, getPlayer, ownedSquares, solventPlayerIds } from '../state/selectors';
import { returnCardToBottom } from '../cards/deck';

/**
 * Going out.
 *
 * A bankrupt player's estate goes somewhere — to the creditor who broke them, or
 * back to the bank to be auctioned off. Either way the buildings come down first,
 * because buildings cannot change hands: they are sold to the bank at half price
 * and the proceeds go with everything else (→ PRD F14).
 *
 * The player stays in `turnOrder` rather than being removed. Turn order is fixed
 * at the start and everybody has learned it; dropping someone out of the middle
 * would shuffle whose turn comes next for everyone behind them.
 */

export type Estate = {
  readonly state: GameState;
  readonly events: readonly GameEvent[];
  /** The lots that have to be auctioned, in board order, when the bank takes them. */
  readonly toAuction: readonly SquareId[];
};

/**
 * Sells every building a player holds back to the bank at half price.
 *
 * Done before anything moves, for both kinds of bankruptcy: a creditor receives
 * cash and bare deeds, never houses.
 */
export function sellAllBuildings(
  state: GameState,
  playerId: PlayerId,
): { state: GameState; events: readonly GameEvent[]; proceeds: number } {
  const pack = boardOf(state);
  const events: GameEvent[] = [];
  let next = state;
  let proceeds = 0;

  for (const square of ownedSquares(state, playerId)) {
    if (square.kind !== 'property') continue;

    const deed = getDeed(next, square.id);
    const standing = deed.houses + deed.hotels * (pack.housesPerHotel + 1);
    if (standing === 0) continue;

    const refund = (standing * square.buildCost) / 2;
    proceeds += refund;

    next = {
      ...next,
      bank: {
        houses: next.bank.houses + deed.houses + deed.hotels * pack.housesPerHotel,
        hotels: next.bank.hotels + deed.hotels,
      },
      deeds: { ...next.deeds, [square.id]: { ...deed, houses: 0, hotels: 0 } },
    };

    events.push({
      type: 'BUILDING_SOLD',
      playerId,
      squareId: square.id,
      refund,
      houses: deed.houses,
      hotels: deed.hotels,
    });
  }

  return { state: next, events, proceeds };
}

/**
 * Everything the player holds goes to one creditor.
 *
 * Mortgaged lots arrive still mortgaged — the creditor inherits the debt along
 * with the deed, and may clear it later in the ordinary way.
 */
export function bankruptToPlayer(
  state: GameState,
  debtorId: PlayerId,
  creditorId: PlayerId,
): Estate {
  const sold = sellAllBuildings(state, debtorId);
  const debtor = getPlayer(sold.state, debtorId);
  const creditor = getPlayer(sold.state, creditorId);

  const deeds = { ...sold.state.deeds };
  for (const square of ownedSquares(sold.state, debtorId)) {
    deeds[square.id] = { ...getDeed(sold.state, square.id), ownerId: creditorId };
  }

  const cash = debtor.cash + sold.proceeds;

  return {
    state: {
      ...sold.state,
      players: {
        ...sold.state.players,
        [debtorId]: {
          ...debtor,
          cash: 0,
          bankrupt: true,
          heldJailCards: [],
          inJail: false,
          jailAttempts: 0,
        },
        [creditorId]: {
          ...creditor,
          cash: creditor.cash + cash,
          heldJailCards: [...creditor.heldJailCards, ...debtor.heldJailCards],
        },
      },
      deeds,
    },
    events: [...sold.events, { type: 'BANKRUPTED', playerId: debtorId, creditorId }],
    toAuction: [],
  };
}

/**
 * Everything returns to the bank, and every lot is auctioned in board order.
 *
 * Held release cards go back to the bottom of the decks they came from rather
 * than out of the game, so the deck a later player draws from is complete.
 */
export function bankruptToBank(state: GameState, debtorId: PlayerId): Estate {
  const sold = sellAllBuildings(state, debtorId);
  const debtor = getPlayer(sold.state, debtorId);
  const pack = boardOf(sold.state);

  const held = ownedSquares(sold.state, debtorId).map((square) => square.id);
  const deeds = { ...sold.state.deeds };
  for (const squareId of held) {
    // Returned unowned *and* unmortgaged: the bank does not hold mortgages, and
    // the next owner buys the lot clean at auction.
    deeds[squareId] = { ownerId: null, mortgaged: false, houses: 0, hotels: 0 };
  }

  let next: GameState = {
    ...sold.state,
    players: {
      ...sold.state.players,
      [debtorId]: {
        ...debtor,
        cash: 0,
        bankrupt: true,
        heldJailCards: [],
        inJail: false,
        jailAttempts: 0,
      },
    },
    deeds,
    // Cash paid to the bank feeds the pot when that variant is on.
    pot: sold.state.config.freeParkingPot
      ? sold.state.pot + debtor.cash + sold.proceeds
      : sold.state.pot,
  };

  for (const deck of debtor.heldJailCards) {
    const cardId = pack.decks[deck].find((card) => card.effect.kind === 'get_out_of_jail')?.id;
    if (cardId === undefined) {
      throw new Error(`Board pack ${pack.id} has no release card in the ${deck} deck`);
    }
    next = returnCardToBottom(next, deck, cardId);
  }

  return {
    state: next,
    events: [...sold.events, { type: 'BANKRUPTED', playerId: debtorId, creditorId: null }],
    toAuction: held,
  };
}

/**
 * The winner, if there is one.
 *
 * Returns null while two or more players are still in. A game with one solvent
 * player left is over whatever else was about to happen (→ PRD F14).
 */
export function winnerOf(state: GameState): PlayerId | null {
  const standing = solventPlayerIds(state);
  return standing.length === 1 ? (standing[0] ?? null) : null;
}
