import type { Action, ActionMeta } from './actions/types';
import { violation, type RuleViolation } from './errors';
import type { GameEvent } from './events/types';
import { findPlayer, isActivePlayer } from './state/selectors';
import { handleEndTurn } from './phases/endTurn';
import { handleRollForJail } from './phases/jail';
import { handleBuyProperty, handleDeclinePurchase } from './phases/purchase';
import { handleRollDice } from './phases/roll';
import { err, type Result } from './result';
import type { GameState } from './state/types';

/**
 * The root reducer: the only way a game state changes.
 *
 * Three things are checked centrally, because every handler would otherwise
 * repeat them: the actor is in the game, they are not already out, and the game is
 * still running. Acting out of turn is checked here too, for the actions that
 * belong to the active player.
 *
 * Everything else is the handler's own business. A handler knows why it is
 * refusing — that a purchase is unaffordable, that a bid is below the minimum —
 * and a general gate in front of it could only answer "wrong phase", which is
 * vaguer and often untrue.
 *
 * What keeps the UI and the server in step is a one-directional property, not a
 * shared gate: everything getLegalActions offers, reduce accepts. That is asserted
 * by a test. The converse was never needed, and insisting on it is what cost the
 * precise refusal message.
 *
 * Errors are returned, never thrown. A rule violation is the expected result of
 * an untrusted client asking for something disallowed, and the API turns it into
 * a 422 with the code intact.
 */

export type ReduceResult = {
  readonly state: GameState;
  readonly events: readonly GameEvent[];
};

export function reduce(
  state: GameState,
  action: Action,
  meta: ActionMeta,
): Result<ReduceResult, RuleViolation> {
  const actor = findPlayer(state, meta.playerId);
  if (actor === undefined) {
    return err(violation('PLAYER_NOT_IN_GAME', 'You are not a player in this game.'));
  }
  if (actor.bankrupt) {
    return err(violation('PLAYER_BANKRUPT', 'You are out of the game.'));
  }
  if (state.phase.kind === 'game_over') {
    return err(violation('GAME_OVER', 'This game has finished.'));
  }

  if (action.type === 'START_GAME') {
    // Creating the opening position is createGame's job — there is no state to
    // reduce before a game starts, so this action never reaches here (→ D17).
    return err(violation('WRONG_PHASE', 'This game has already started.'));
  }

  // Acting out of turn is checked here rather than in each handler, because it is
  // the one refusal every handler would otherwise have to repeat, and because it
  // is the one a player is most likely to hit by accident.
  if (requiresTurn(action.type) && !isActivePlayer(state, meta.playerId)) {
    return err(violation('NOT_YOUR_TURN', 'It is not your turn.'));
  }

  /*
   * Dispatch to the handler and let it refuse in its own words.
   *
   * The handlers, not this function, are the authority on their own constraints.
   * A purchase nobody can afford should say so — routing it through a general
   * legality gate first would answer "wrong phase", which is both vaguer and
   * untrue.
   *
   * getLegalActions still governs what a client is *offered*: it omits a purchase
   * the player cannot fund, so the button never appears. The property that matters
   * is one-directional and asserted by a test — everything offered is accepted.
   * The converse was never needed, and insisting on it is what cost the precise
   * message.
   */
  switch (action.type) {
    case 'ROLL_DICE':
      return handleRollDice(state);
    case 'ROLL_FOR_JAIL':
      return handleRollForJail(state);
    case 'END_TURN':
      return handleEndTurn(state);
    case 'BUY_PROPERTY':
      return handleBuyProperty(state);
    case 'DECLINE_PURCHASE':
      return handleDeclinePurchase(state);
    default:
      return err(violation('WRONG_PHASE', `You cannot ${describe(action)} right now.`));
  }
}

/**
 * Whether an action belongs to the player whose turn it is.
 *
 * Bidding, trading and property management are deliberately absent: the real rules
 * let those happen on somebody else's turn (→ D10), so their handlers decide for
 * themselves who may act.
 */
function requiresTurn(type: Action['type']): boolean {
  switch (type) {
    case 'ROLL_DICE':
    case 'ROLL_FOR_JAIL':
    case 'PAY_JAIL_FINE':
    case 'USE_JAIL_CARD':
    case 'BUY_PROPERTY':
    case 'DECLINE_PURCHASE':
    case 'END_TURN':
      return true;
    default:
      return false;
  }
}

function describe(action: Action): string {
  switch (action.type) {
    case 'ROLL_DICE':
    case 'ROLL_FOR_JAIL':
      return 'roll';
    case 'END_TURN':
      return 'end your turn';
    case 'BUY_PROPERTY':
      return 'buy that';
    case 'DECLINE_PURCHASE':
      return 'decline that';
    case 'PLACE_BID':
      return 'bid';
    case 'PASS_BID':
      return 'pass';
    case 'AUCTION_TIMEOUT':
      return 'close the auction';
    case 'PAY_JAIL_FINE':
      return 'pay the fine';
    case 'USE_JAIL_CARD':
      return 'use that card';
    case 'BUILD_HOUSE':
      return 'build';
    case 'SELL_HOUSE':
      return 'sell buildings';
    case 'MORTGAGE':
      return 'mortgage that';
    case 'UNMORTGAGE':
      return 'clear that mortgage';
    case 'OFFER_TRADE':
      return 'offer a trade';
    case 'ACCEPT_TRADE':
      return 'accept that trade';
    case 'DECLINE_TRADE':
      return 'decline that trade';
    case 'WITHDRAW_TRADE':
      return 'withdraw that trade';
    case 'SETTLE_DEBT':
      return 'settle';
    case 'DECLARE_BANKRUPTCY':
      return 'declare bankruptcy';
    case 'CONCEDE':
      return 'concede';
    case 'START_GAME':
      return 'start the game';
  }
}
