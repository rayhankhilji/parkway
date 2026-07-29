import type { DeckId, SquareId } from '../board/types';
import type { DiceRoll, PlayerId, TradeSide } from '../state/types';

/**
 * What happened, structured.
 *
 * Handlers emit these; they never emit prose. The client renders them to
 * sentences using the player names it already holds, which keeps copy out of the
 * engine, makes the feed translatable, and lets tests assert on effects instead
 * of on strings.
 *
 * Events are persisted alongside each action and replayed to build the feed
 * after a reconnect, so their shape is a stored contract: add fields, do not
 * repurpose them.
 */

export type GameEvent =
  | { readonly type: 'GAME_STARTED'; readonly turnOrder: readonly PlayerId[] }
  | {
      readonly type: 'DICE_ROLLED';
      readonly playerId: PlayerId;
      readonly dice: DiceRoll;
      readonly isDouble: boolean;
    }
  | {
      readonly type: 'TOKEN_MOVED';
      readonly playerId: PlayerId;
      readonly from: SquareId;
      readonly to: SquareId;
      readonly passedStart: boolean;
    }
  | { readonly type: 'SALARY_PAID'; readonly playerId: PlayerId; readonly amount: number }
  | {
      readonly type: 'PROPERTY_PURCHASED';
      readonly playerId: PlayerId;
      readonly squareId: SquareId;
      readonly price: number;
    }
  | {
      readonly type: 'PURCHASE_DECLINED';
      readonly playerId: PlayerId;
      readonly squareId: SquareId;
    }
  | {
      readonly type: 'RENT_PAID';
      readonly from: PlayerId;
      readonly to: PlayerId;
      readonly amount: number;
      readonly squareId: SquareId;
    }
  | {
      readonly type: 'TAX_PAID';
      readonly playerId: PlayerId;
      readonly squareId: SquareId;
      readonly amount: number;
    }
  | {
      readonly type: 'CARD_DRAWN';
      readonly playerId: PlayerId;
      readonly deck: DeckId;
      readonly cardId: string;
    }
  | {
      readonly type: 'CARD_KEPT';
      readonly playerId: PlayerId;
      readonly deck: DeckId;
      readonly cardId: string;
    }
  | {
      readonly type: 'SENT_TO_JAIL';
      readonly playerId: PlayerId;
      readonly reason: 'square' | 'card' | 'three_doubles';
    }
  | {
      readonly type: 'LEFT_JAIL';
      readonly playerId: PlayerId;
      readonly method: 'fine' | 'card' | 'doubles' | 'forced_fine';
    }
  | {
      readonly type: 'JAIL_ATTEMPT_FAILED';
      readonly playerId: PlayerId;
      readonly attempt: number;
    }
  | {
      readonly type: 'AUCTION_OPENED';
      readonly squareId: SquareId;
      readonly deadlineAt: number;
    }
  | { readonly type: 'BID_PLACED'; readonly playerId: PlayerId; readonly amount: number }
  | { readonly type: 'BID_PASSED'; readonly playerId: PlayerId }
  | {
      readonly type: 'AUCTION_WON';
      readonly playerId: PlayerId;
      readonly squareId: SquareId;
      readonly amount: number;
    }
  | { readonly type: 'AUCTION_UNSOLD'; readonly squareId: SquareId }
  | {
      readonly type: 'HOUSE_BUILT';
      readonly playerId: PlayerId;
      readonly squareId: SquareId;
      readonly cost: number;
      readonly houses: number;
    }
  | {
      readonly type: 'HOTEL_BUILT';
      readonly playerId: PlayerId;
      readonly squareId: SquareId;
      readonly cost: number;
    }
  | {
      readonly type: 'BUILDING_SOLD';
      readonly playerId: PlayerId;
      readonly squareId: SquareId;
      readonly refund: number;
      readonly houses: number;
      readonly hotels: number;
    }
  | {
      readonly type: 'MORTGAGED';
      readonly playerId: PlayerId;
      readonly squareId: SquareId;
      readonly amount: number;
    }
  | {
      readonly type: 'UNMORTGAGED';
      readonly playerId: PlayerId;
      readonly squareId: SquareId;
      readonly amount: number;
    }
  | {
      readonly type: 'MORTGAGE_INTEREST_PAID';
      readonly playerId: PlayerId;
      readonly squareId: SquareId;
      readonly amount: number;
    }
  | {
      readonly type: 'TRADE_OFFERED';
      readonly tradeId: string;
      readonly fromId: PlayerId;
      readonly toId: PlayerId;
      readonly offered: TradeSide;
      readonly requested: TradeSide;
    }
  | { readonly type: 'TRADE_ACCEPTED'; readonly tradeId: string }
  | { readonly type: 'TRADE_DECLINED'; readonly tradeId: string }
  | { readonly type: 'TRADE_WITHDRAWN'; readonly tradeId: string }
  | {
      readonly type: 'DEBT_INCURRED';
      readonly debtorId: PlayerId;
      readonly creditorId: PlayerId | null;
      readonly amount: number;
    }
  | {
      readonly type: 'DEBT_SETTLED';
      readonly debtorId: PlayerId;
      readonly creditorId: PlayerId | null;
      readonly amount: number;
    }
  | {
      readonly type: 'BANKRUPTED';
      readonly playerId: PlayerId;
      readonly creditorId: PlayerId | null;
    }
  | { readonly type: 'POT_CONTRIBUTED'; readonly amount: number }
  | { readonly type: 'POT_COLLECTED'; readonly playerId: PlayerId; readonly amount: number }
  | {
      readonly type: 'TURN_ENDED';
      readonly playerId: PlayerId;
      readonly nextPlayerId: PlayerId;
    }
  | { readonly type: 'GAME_OVER'; readonly winnerId: PlayerId };

export type GameEventType = GameEvent['type'];
