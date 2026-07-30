import type { GameEvent, SquareId } from '@parkway/engine';

/**
 * Turning engine output into English.
 *
 * The engine emits structured events and never prose — it has no idea what a
 * player is called, because names live in the players table and the engine only
 * ever sees ids. This module is where "RENT_PAID" becomes "Ada paid Bo £24 rent",
 * and it is the only place in the app that writes a sentence about a game event.
 *
 * Keeping copy out of the engine is what makes the feed translatable later and
 * what lets the engine's tests assert on effects rather than on strings.
 */

export type NameLookup = (playerId: string | null) => string;
export type SquareLookup = (squareId: SquareId) => string;

export type FormatContext = {
  readonly currency: string;
  readonly nameOf: NameLookup;
  readonly squareOf: SquareLookup;
};

/**
 * Money, always as whole units with thousands separators.
 *
 * There are no fractional amounts anywhere in the system, so this never needs to
 * decide how to round — which is the point of money being an integer everywhere.
 */
export function formatMoney(amount: number, currency: string): string {
  return `${currency}${amount.toLocaleString('en-GB')}`;
}

/** A dice roll as players say it: "5 and 3 (8)". */
export function formatRoll(dice: readonly [number, number]): string {
  return `${dice[0]} and ${dice[1]} (${dice[0] + dice[1]})`;
}

/**
 * One event, one line.
 *
 * Returns null for events that carry no news on their own — a token moving is
 * already implied by the roll that caused it, and a feed that narrates every
 * intermediate step buries the thing that actually happened.
 */
export function describeEvent(event: GameEvent, context: FormatContext): string | null {
  const { currency, nameOf, squareOf } = context;
  const money = (amount: number) => formatMoney(amount, currency);

  switch (event.type) {
    case 'GAME_STARTED':
      return `The game begins. Turn order: ${event.turnOrder.map(nameOf).join(', ')}.`;

    case 'DICE_ROLLED':
      return `${nameOf(event.playerId)} rolled ${formatRoll(event.dice)}${
        event.isDouble ? ' — a double' : ''
      }.`;

    case 'TOKEN_MOVED':
      // Implied by the roll or the card that caused it.
      return null;

    case 'SALARY_PAID':
      return `${nameOf(event.playerId)} collected ${money(event.amount)} for passing the start.`;

    case 'PROPERTY_PURCHASED':
      return `${nameOf(event.playerId)} bought ${squareOf(event.squareId)} for ${money(event.price)}.`;

    case 'PURCHASE_DECLINED':
      return `${nameOf(event.playerId)} declined ${squareOf(event.squareId)}.`;

    case 'RENT_PAID':
      return `${nameOf(event.from)} paid ${nameOf(event.to)} ${money(event.amount)} rent for ${squareOf(event.squareId)}.`;

    case 'TAX_PAID':
      return `${nameOf(event.playerId)} paid ${money(event.amount)} at ${squareOf(event.squareId)}.`;

    case 'CARD_DRAWN':
      return `${nameOf(event.playerId)} drew a ${event.deck === 'chance' ? 'Fortune' : 'Civic Fund'} card.`;

    case 'CARD_KEPT':
      return `${nameOf(event.playerId)} kept a release card.`;

    case 'SENT_TO_JAIL':
      return {
        square: `${nameOf(event.playerId)} was sent to the gaol.`,
        card: `${nameOf(event.playerId)} was sent to the gaol by a card.`,
        three_doubles: `${nameOf(event.playerId)} rolled a third double and went to the gaol.`,
      }[event.reason];

    case 'LEFT_JAIL':
      return {
        fine: `${nameOf(event.playerId)} paid the fine and left the gaol.`,
        card: `${nameOf(event.playerId)} used a release card and left the gaol.`,
        doubles: `${nameOf(event.playerId)} rolled a double and left the gaol.`,
        forced_fine: `${nameOf(event.playerId)} ran out of attempts, paid the fine and left the gaol.`,
      }[event.method];

    case 'JAIL_ATTEMPT_FAILED':
      return `${nameOf(event.playerId)} failed to roll a double — attempt ${event.attempt} of 3.`;

    case 'AUCTION_OPENED':
      return `${squareOf(event.squareId)} goes to auction.`;

    case 'BID_PLACED':
      return `${nameOf(event.playerId)} bid ${money(event.amount)}.`;

    case 'BID_PASSED':
      return `${nameOf(event.playerId)} passed.`;

    case 'AUCTION_WON':
      return `${nameOf(event.playerId)} won ${squareOf(event.squareId)} for ${money(event.amount)}.`;

    case 'AUCTION_UNSOLD':
      return `Nobody bid on ${squareOf(event.squareId)}.`;

    case 'HOUSE_BUILT':
      return `${nameOf(event.playerId)} built a house on ${squareOf(event.squareId)} for ${money(event.cost)} — now ${event.houses}.`;

    case 'HOTEL_BUILT':
      return `${nameOf(event.playerId)} built a hotel on ${squareOf(event.squareId)} for ${money(event.cost)}.`;

    case 'BUILDING_SOLD':
      return `${nameOf(event.playerId)} sold buildings on ${squareOf(event.squareId)} for ${money(event.refund)}.`;

    case 'MORTGAGED':
      return `${nameOf(event.playerId)} mortgaged ${squareOf(event.squareId)} for ${money(event.amount)}.`;

    case 'UNMORTGAGED':
      return `${nameOf(event.playerId)} cleared the mortgage on ${squareOf(event.squareId)} for ${money(event.amount)}.`;

    case 'MORTGAGE_INTEREST_PAID':
      return `${nameOf(event.playerId)} paid ${money(event.amount)} interest on ${squareOf(event.squareId)}.`;

    case 'TRADE_OFFERED':
      return `${nameOf(event.fromId)} offered ${nameOf(event.toId)} a trade.`;

    case 'TRADE_ACCEPTED':
      return 'The trade was accepted.';

    case 'TRADE_DECLINED':
      return 'The trade was declined.';

    case 'TRADE_WITHDRAWN':
      return 'The trade was withdrawn.';

    case 'DEBT_INCURRED':
      return `${nameOf(event.debtorId)} owes ${money(event.amount)} to ${
        event.creditorId === null ? 'the bank' : nameOf(event.creditorId)
      } and cannot cover it.`;

    case 'DEBT_SETTLED':
      return `${nameOf(event.debtorId)} settled ${money(event.amount)}.`;

    case 'BANKRUPTED':
      return event.creditorId === null
        ? `${nameOf(event.playerId)} is bankrupt and out of the game.`
        : `${nameOf(event.playerId)} is bankrupt — everything goes to ${nameOf(event.creditorId)}.`;

    case 'POT_CONTRIBUTED':
      return null;

    case 'POT_COLLECTED':
      return `${nameOf(event.playerId)} collected ${money(event.amount)} from the pot.`;

    case 'TURN_ENDED':
      return null;

    case 'GAME_OVER':
      return `${nameOf(event.winnerId)} wins.`;
  }
}

/** The lines for one action, in order, with the silent events dropped. */
export function describeEvents(
  events: readonly GameEvent[],
  context: FormatContext,
): readonly string[] {
  return events.flatMap((event) => {
    const line = describeEvent(event, context);
    return line === null ? [] : [line];
  });
}
