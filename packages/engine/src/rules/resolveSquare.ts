import { getSquare, isOwnable } from '../board/lookup';
import { applyCardEffect } from '../cards/effects';
import { drawCard } from '../cards/deck';
import type { GameEvent } from '../events/types';
import type { GameState, PlayerId } from '../state/types';
import { boardOf, getDeed, getPlayer, netWorth } from '../state/selectors';
import { maxCardDepth, type Landing, type LandingContext } from './landing';
import { sendToJail } from './movement';
import { credit, payOrEnterDebt } from './payment';
import { rentFor } from './rent';

/**
 * What happens when a token comes to rest.
 *
 * Every square kind is handled here and nowhere else, which is why this file is
 * one exhaustive switch rather than a set of predicates: a new square kind should
 * break the build, not fall through to doing nothing.
 *
 * A square either finishes cleanly, in which case the caller decides whether the
 * turn continues, or it halts the game waiting on somebody — a purchase decision,
 * a debt, or a trip to the gaol. Halting is reported rather than inferred from the
 * phase, so the caller never has to guess whether it is allowed to move on.
 */
export function resolveSquare(
  state: GameState,
  playerId: PlayerId,
  context: LandingContext,
): Landing {
  if (context.depth > maxCardDepth) {
    // Cards can legitimately chain — a card sends you back three squares onto
    // another card square — but a pack could describe a loop, and an error naming
    // the pack is a better way to find that out than a stack overflow.
    throw new Error(
      `Card resolution went ${context.depth} deep on board pack ${state.boardPackId}, which suggests a loop`,
    );
  }

  const pack = boardOf(state);
  const square = getSquare(pack, getPlayer(state, playerId).position);

  switch (square.kind) {
    case 'start':
    case 'jail':
      // Landing on the start square is already paid by the move that got here.
      // The gaol square is just visiting unless you were sent.
      return { state, events: [], halted: false };

    case 'free_parking': {
      if (!state.config.freeParkingPot || state.pot === 0) {
        return { state, events: [], halted: false };
      }
      const amount = state.pot;
      return {
        state: { ...credit(state, playerId, amount), pot: 0 },
        events: [{ type: 'POT_COLLECTED', playerId, amount }],
        halted: false,
      };
    }

    case 'go_to_jail': {
      const jailed = sendToJail(state, playerId, 'square');
      return {
        state: { ...jailed.state, phase: { kind: 'awaiting_end_turn' } },
        events: jailed.events,
        halted: true,
      };
    }

    case 'tax': {
      const amount = taxDue(state, playerId, square.flatAmount, square.percentageRate);
      const payment = payOrEnterDebt(state, playerId, null, amount, { kind: 'awaiting_end_turn' });
      return {
        state: payment.state,
        events: [{ type: 'TAX_PAID', playerId, squareId: square.id, amount }, ...payment.events],
        halted: payment.enteredDebt,
      };
    }

    case 'card': {
      const draw = drawCard(state, square.deck);
      const drawn: GameEvent = {
        type: 'CARD_DRAWN',
        playerId,
        deck: square.deck,
        cardId: draw.card.id,
      };
      const applied = applyCardEffect(draw.state, playerId, draw.card, context, resolveSquare);
      return { ...applied, events: [drawn, ...applied.events] };
    }

    case 'property':
    case 'transit':
    case 'utility':
      return resolveOwnable(state, playerId, square.id, context);
  }
}

/**
 * A square someone could own: buy it, pay for it, or nothing.
 *
 * Nothing happens when you own it yourself or when it is mortgaged — the owner
 * traded rent for cash, and the deed says so.
 */
function resolveOwnable(
  state: GameState,
  playerId: PlayerId,
  squareId: number,
  context: LandingContext,
): Landing {
  const square = getSquare(boardOf(state), squareId);
  if (!isOwnable(square)) {
    throw new Error(`Square ${squareId} is not ownable`);
  }

  const deed = getDeed(state, squareId);

  if (deed.ownerId === null) {
    return {
      state: { ...state, phase: { kind: 'awaiting_purchase', squareId } },
      events: [],
      halted: true,
    };
  }

  if (deed.ownerId === playerId || deed.mortgaged) {
    return { state, events: [], halted: false };
  }

  const amount = rentFor(
    state,
    squareId,
    playerId,
    context.causingRoll,
    context.viaCard ? 'card' : 'landed',
  );

  const payment = payOrEnterDebt(state, playerId, deed.ownerId, amount, {
    kind: 'awaiting_end_turn',
  });

  return {
    state: payment.state,
    events: [
      { type: 'RENT_PAID', from: playerId, to: deed.ownerId, amount, squareId },
      ...payment.events,
    ],
    halted: payment.enteredDebt,
  };
}

/**
 * Flat or a percentage of total worth, depending on the game's configuration
 * (→ PRD F15). A square with no percentage rate declared is always flat.
 *
 * The percentage is floored. Money is an integer everywhere in this system, and
 * rounding a tax bill down is the kinder direction to be imprecise in.
 */
export function taxDue(
  state: GameState,
  playerId: PlayerId,
  flatAmount: number,
  percentageRate: number | null,
): number {
  if (percentageRate === null || state.config.incomeTaxMode === 'flat') {
    return flatAmount;
  }
  return Math.floor(netWorth(state, playerId) * percentageRate);
}
