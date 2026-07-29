import type { SquareId } from '../board/types.js';
import type { PlayerId, TradeSide } from '../state/types.js';

/**
 * Everything a player can ask the game to do.
 *
 * Declared complete up front, before most of it is implemented, because this
 * union is the contract the HTTP route, the client and the reducer all share.
 * Growing it phase by phase would mean changing that contract eight times.
 *
 * No action carries the identity of the player taking it. The server resolves a
 * bearer token to a player id and passes it in the action metadata, so a client
 * cannot name a different actor than the one it authenticated as.
 */
export type Action =
  /**
   * Creates the state document rather than transforming one, so it is handled by
   * createGame ahead of the reducer. It travels through the same endpoint and is
   * recorded in the same log as every other action.
   */
  | { readonly type: 'START_GAME' }
  | { readonly type: 'ROLL_DICE' }
  | { readonly type: 'BUY_PROPERTY' }
  | { readonly type: 'DECLINE_PURCHASE' }
  | { readonly type: 'PLACE_BID'; readonly amount: number }
  | { readonly type: 'PASS_BID' }
  /** Fired by any connected client once the deadline shows as passed (→ D5). */
  | { readonly type: 'AUCTION_TIMEOUT' }
  | { readonly type: 'PAY_JAIL_FINE' }
  | { readonly type: 'USE_JAIL_CARD' }
  | { readonly type: 'ROLL_FOR_JAIL' }
  | { readonly type: 'BUILD_HOUSE'; readonly squareId: SquareId }
  | { readonly type: 'SELL_HOUSE'; readonly squareId: SquareId }
  | { readonly type: 'MORTGAGE'; readonly squareId: SquareId }
  | { readonly type: 'UNMORTGAGE'; readonly squareId: SquareId }
  | {
      readonly type: 'OFFER_TRADE';
      readonly toId: PlayerId;
      readonly offered: TradeSide;
      readonly requested: TradeSide;
    }
  | { readonly type: 'ACCEPT_TRADE' }
  | { readonly type: 'DECLINE_TRADE' }
  | { readonly type: 'WITHDRAW_TRADE' }
  | { readonly type: 'SETTLE_DEBT' }
  | { readonly type: 'DECLARE_BANKRUPTCY' }
  | { readonly type: 'CONCEDE' }
  | { readonly type: 'END_TURN' };

export type ActionType = Action['type'];

/**
 * The two things the engine cannot know for itself, supplied by the server on
 * every call: who is acting, and what time it is. Both enter as data so the
 * reducer stays a pure function (→ ARCHITECTURE, "Time").
 */
export type ActionMeta = {
  readonly playerId: PlayerId;
  /** Epoch milliseconds, stamped by the server. Never a client's clock. */
  readonly now: number;
};

/**
 * An action a player may take right now, with whatever the UI needs to render
 * its control. Buttons are built from this and from nothing else — a component
 * that decides for itself whether an action is available has copied a rule.
 */
export type LegalAction =
  | { readonly type: 'START_GAME' }
  | { readonly type: 'ROLL_DICE' }
  | { readonly type: 'BUY_PROPERTY'; readonly squareId: SquareId; readonly price: number }
  | { readonly type: 'DECLINE_PURCHASE'; readonly squareId: SquareId }
  | {
      readonly type: 'PLACE_BID';
      readonly squareId: SquareId;
      readonly minimum: number;
      readonly maximum: number;
    }
  | { readonly type: 'PASS_BID' }
  | { readonly type: 'AUCTION_TIMEOUT'; readonly deadlineAt: number }
  | { readonly type: 'PAY_JAIL_FINE'; readonly fine: number }
  | { readonly type: 'USE_JAIL_CARD' }
  | { readonly type: 'ROLL_FOR_JAIL'; readonly attemptsRemaining: number }
  | { readonly type: 'BUILD_HOUSE'; readonly squareIds: readonly SquareId[] }
  | { readonly type: 'SELL_HOUSE'; readonly squareIds: readonly SquareId[] }
  | { readonly type: 'MORTGAGE'; readonly squareIds: readonly SquareId[] }
  | { readonly type: 'UNMORTGAGE'; readonly squareIds: readonly SquareId[] }
  | { readonly type: 'OFFER_TRADE'; readonly candidateIds: readonly PlayerId[] }
  | { readonly type: 'ACCEPT_TRADE'; readonly tradeId: string }
  | { readonly type: 'DECLINE_TRADE'; readonly tradeId: string }
  | { readonly type: 'WITHDRAW_TRADE'; readonly tradeId: string }
  | { readonly type: 'SETTLE_DEBT'; readonly amount: number }
  | { readonly type: 'DECLARE_BANKRUPTCY'; readonly amount: number }
  | { readonly type: 'CONCEDE' }
  | { readonly type: 'END_TURN' };
