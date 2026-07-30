import { getOwnableSquare } from '../board/lookup';
import { violation, type RuleViolation } from '../errors';
import type { GameEvent } from '../events/types';
import { err, ok, type Result } from '../result';
import type { GameState } from '../state/types';
import { activePlayerId, boardOf, getDeed, getPlayer } from '../state/selectors';
import { payOrEnterDebt } from '../rules/payment';
import type { ActionMeta } from '../actions/types';
import { openAuction } from './auction';
import { concludeObligation, type PhaseResult } from './turnFlow';

/**
 * Buying, or not.
 *
 * The decision blocks the turn: nothing else can happen until it is made, which is
 * why `awaiting_purchase` is a phase and building is not. A player who cannot
 * afford the price is not offered the purchase at all, so the payment here can
 * never fail — but it still goes through the one money path, because a second way
 * to move cash is how the money paths drift apart.
 */
export function handleBuyProperty(state: GameState): Result<PhaseResult, RuleViolation> {
  if (state.phase.kind !== 'awaiting_purchase') {
    return err(violation('WRONG_PHASE', 'There is nothing to buy right now.'));
  }

  const squareId = state.phase.squareId;
  const playerId = activePlayerId(state);
  const square = getOwnableSquare(boardOf(state), squareId);
  const deed = getDeed(state, squareId);

  if (deed.ownerId !== null) {
    return err(violation('SQUARE_ALREADY_OWNED', 'Someone already owns that.'));
  }

  if (getPlayer(state, playerId).cash < square.price) {
    return err(violation('INSUFFICIENT_FUNDS', 'You cannot afford that.'));
  }

  const payment = payOrEnterDebt(state, playerId, null, square.price, {
    kind: 'awaiting_end_turn',
  });

  if (payment.enteredDebt) {
    // Unreachable: affordability was just checked. If it ever happens, the two
    // checks have diverged and silently continuing would sell the deed for free.
    throw new Error('A purchase that passed the affordability check still entered debt');
  }

  const owned: GameState = {
    ...payment.state,
    deeds: { ...payment.state.deeds, [squareId]: { ...deed, ownerId: playerId } },
  };

  const events: GameEvent[] = [
    { type: 'PROPERTY_PURCHASED', playerId, squareId, price: square.price },
  ];

  return ok(concludeObligation(owned, events));
}

/**
 * Declining.
 *
 * With the auction variant on the lot goes under the hammer, and the player who
 * just declined it may bid — F8 is explicit about that, and it is what makes
 * declining a real decision rather than simply passing the property along.
 *
 * With the variant off the square stays unowned and play continues.
 */
export function handleDeclinePurchase(
  state: GameState,
  meta: ActionMeta,
): Result<PhaseResult, RuleViolation> {
  if (state.phase.kind !== 'awaiting_purchase') {
    return err(violation('WRONG_PHASE', 'There is nothing to decline right now.'));
  }

  const playerId = activePlayerId(state);
  const squareId = state.phase.squareId;
  const events: GameEvent[] = [{ type: 'PURCHASE_DECLINED', playerId, squareId }];

  if (!state.config.auctionOnDecline) {
    return ok(concludeObligation(state, events));
  }

  const opened = openAuction(state, squareId, meta.now);
  return ok({ state: opened.state, events: [...events, ...opened.events] });
}
