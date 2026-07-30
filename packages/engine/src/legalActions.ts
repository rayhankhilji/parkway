import type { LegalAction } from './actions/types';
import type { GameState, PlayerId } from './state/types';
import { minimumBid } from './phases/auction';
import { canManage } from './rules/management';
import { buildableSquares, sellableSquares } from './rules/building';
import { mortgageableSquares, unmortgageableSquares } from './rules/mortgage';
import {
  activePlayerId,
  boardOf,
  findPlayer,
  getPlayer,
  priceOf,
  solventPlayerIds,
} from './state/selectors';

/**
 * What this player may do, right now.
 *
 * The UI builds every button from this and from nothing else. A component that
 * decides for itself whether an action is available has copied a rule, and a
 * second copy of a rule is the failure this whole architecture exists to
 * prevent. The reducer checks against the same function, so a button that is
 * absent and an action that is refused can never disagree.
 *
 * Actions that are legal outside the phase machine — building, mortgaging,
 * trading — are added by the rules that own them (→ D10). Everything listed here
 * is turn flow.
 */
export function getLegalActions(state: GameState, playerId: PlayerId): readonly LegalAction[] {
  const player = findPlayer(state, playerId);
  if (player === undefined || player.bankrupt) {
    return [];
  }

  if (state.phase.kind === 'game_over') {
    return [];
  }

  const actions: LegalAction[] = [];
  const isActive = activePlayerId(state) === playerId;

  switch (state.phase.kind) {
    case 'awaiting_roll':
      if (isActive) actions.push({ type: 'ROLL_DICE' });
      break;

    case 'awaiting_jail_decision':
      if (isActive) {
        const pack = boardOf(state);
        // A held card first: it costs nothing, so offering the fine above it would
        // be inviting a player to waste money.
        if (player.heldJailCards.length > 0) {
          actions.push({ type: 'USE_JAIL_CARD' });
        }
        if (player.cash >= pack.jail.fine) {
          actions.push({ type: 'PAY_JAIL_FINE', fine: pack.jail.fine });
        }
        actions.push({
          type: 'ROLL_FOR_JAIL',
          attemptsRemaining: pack.jail.maxTurns - player.jailAttempts,
        });
      }
      break;

    case 'awaiting_end_turn':
      if (isActive) actions.push({ type: 'END_TURN' });
      break;

    case 'awaiting_purchase':
      if (isActive) {
        const squareId = state.phase.squareId;
        const price = priceOf(state, squareId);
        // The purchase is only offered when it can actually be paid for. A player
        // who cannot afford it has one choice, and pretending otherwise would mean
        // a button that exists only to be refused (→ PRD F6).
        if (getPlayer(state, playerId).cash >= price) {
          actions.push({ type: 'BUY_PROPERTY', squareId, price });
        }
        actions.push({ type: 'DECLINE_PURCHASE', squareId });
      }
      break;

    case 'auction': {
      // Any solvent player still in the running may act, whosever turn it is.
      if (!state.phase.activeBidderIds.includes(playerId)) break;

      const minimum = minimumBid(state, state.phase.highBid);
      if (player.cash >= minimum) {
        actions.push({
          type: 'PLACE_BID',
          squareId: state.phase.squareId,
          minimum,
          maximum: player.cash,
        });
      }
      // The leading bidder has nothing to pass on.
      if (state.phase.highBidderId !== playerId) {
        actions.push({ type: 'PASS_BID' });
      }
      /*
       * AUCTION_TIMEOUT is deliberately absent.
       *
       * It is not something a player chooses — it is fired by whichever client's
       * countdown runs out first, and the deadline is already in public state for
       * the UI to count against (→ D5). Listing it here would put a "close the
       * auction" button in the action bar, and would offer an action the reducer
       * refuses until the deadline actually passes.
       */
      break;
    }

    case 'awaiting_debt':
      // Settlement arrives with the debt rules.
      break;
  }

  /*
   * Property management is appended regardless of phase, because the real rules
   * allow it on somebody else's turn (→ D10). The predicates inside these
   * selectors are what exclude it during an auction, and during a debt for
   * everyone except the debtor.
   *
   * Each entry carries the squares it applies to, so the UI can open a dialog
   * listing exactly the lots that qualify rather than working that out itself.
   */
  const buildable = buildableSquares(state, playerId);
  if (buildable.length > 0) actions.push({ type: 'BUILD_HOUSE', squareIds: buildable });

  const sellable = sellableSquares(state, playerId);
  if (sellable.length > 0) actions.push({ type: 'SELL_HOUSE', squareIds: sellable });

  const mortgageable = mortgageableSquares(state, playerId);
  if (mortgageable.length > 0) actions.push({ type: 'MORTGAGE', squareIds: mortgageable });

  const redeemable = unmortgageableSquares(state, playerId);
  if (redeemable.length > 0) actions.push({ type: 'UNMORTGAGE', squareIds: redeemable });

  /*
   * Trading is not a phase, so it is appended after the phase switch rather than
   * inside it — the same reasoning that keeps building out of the machine (→ D10).
   */
  if (canManage(state, playerId)) {
    if (state.openTrade === null) {
      const candidates = solventPlayerIds(state).filter((id) => id !== playerId);
      if (candidates.length > 0) actions.push({ type: 'OFFER_TRADE', candidateIds: candidates });
    } else if (state.openTrade.toId === playerId) {
      actions.push({ type: 'ACCEPT_TRADE', tradeId: state.openTrade.id });
      actions.push({ type: 'DECLINE_TRADE', tradeId: state.openTrade.id });
    } else if (state.openTrade.fromId === playerId) {
      actions.push({ type: 'WITHDRAW_TRADE', tradeId: state.openTrade.id });
    }
  }

  return actions;
}

export function isActionLegal(
  state: GameState,
  playerId: PlayerId,
  type: LegalAction['type'],
): boolean {
  return getLegalActions(state, playerId).some((action) => action.type === type);
}
