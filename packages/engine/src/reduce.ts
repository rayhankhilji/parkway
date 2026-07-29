import type { Action, ActionMeta } from './actions/types';
import { violation, type RuleViolation } from './errors';
import type { GameEvent } from './events/types';
import { isActionLegal } from './legalActions';
import { handleEndTurn } from './phases/endTurn';
import { handleRollForJail } from './phases/jail';
import { handleRollDice } from './phases/roll';
import { err, type Result } from './result';
import type { GameState } from './state/types';
import { findPlayer } from './state/selectors';

/**
 * The root reducer: the only way a game state changes.
 *
 * It runs three checks before any handler sees the action — the actor is in the
 * game, the game is not over, and the action is one getLegalActions would offer
 * them — and then dispatches. Checking legality centrally rather than inside
 * each handler is what guarantees the buttons a client is shown and the actions
 * the server accepts cannot drift apart.
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

  if (!isActionLegal(state, meta.playerId, action.type)) {
    return err(refusalFor(state, meta.playerId, action));
  }

  switch (action.type) {
    case 'ROLL_DICE':
      return handleRollDice(state);
    case 'ROLL_FOR_JAIL':
      return handleRollForJail(state);
    case 'END_TURN':
      return handleEndTurn(state);
    default:
      return err(
        violation('WRONG_PHASE', 'That is not something you can do at this point in the game.'),
      );
  }
}

/**
 * Why an action was refused.
 *
 * The message a player reads should say what is actually wrong. "It is not your
 * turn" and "you cannot roll twice" are both refusals of the same action, and
 * showing the wrong one turns a clear rule into a confusing bug report.
 */
function refusalFor(state: GameState, playerId: string, action: Action): RuleViolation {
  const activeId = state.turnOrder[state.activeIndex];
  if (activeId !== undefined && activeId !== playerId) {
    return violation('NOT_YOUR_TURN', 'It is not your turn.');
  }
  return violation('WRONG_PHASE', `You cannot ${describe(action)} right now.`);
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
