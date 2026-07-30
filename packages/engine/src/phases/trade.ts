import { getOwnableSquare } from '../board/lookup';
import type { SquareId } from '../board/types';
import { violation, type RuleViolation } from '../errors';
import type { GameEvent } from '../events/types';
import { err, ok, type Result } from '../result';
import { nextUint32 } from '../rng/mulberry32';
import type { GameState, PlayerId, TradeOffer, TradeSide } from '../state/types';
import { boardOf, findPlayer, getDeed, getPlayer } from '../state/selectors';
import { managementBlockedBy } from '../rules/management';
import { transferInterest } from '../rules/mortgage';
import type { PhaseResult } from './turnFlow';

/**
 * Player-to-player trading.
 *
 * Not a phase, for the same reason building is not: a trade can be proposed at
 * almost any time, including on somebody else's turn (→ D10). What makes it
 * awkward instead is atomicity — an accepted trade moves cash, deeds and cards in
 * both directions, and a half-applied trade would leave two players each believing
 * they own the same lot.
 *
 * So the whole thing is validated before anything moves, and validated again on
 * acceptance rather than trusting the check made when it was offered. Cash can be
 * spent and buildings can go up in between.
 */

/**
 * A fresh id for an offer, drawn from the state's own generator.
 *
 * The generator is the engine's only source of values that are both unique and
 * reproducible — an id derived from the clock would break replay, and one derived
 * from the state's contents would collide whenever the same trade was offered
 * twice. Consuming a step here costs nothing: the sequence is only meaningful in
 * the order it is drawn, and a replay draws it in exactly the same place.
 */
function nextTradeId(state: GameState): { id: string; state: GameState } {
  const [value, rng] = nextUint32(state.rng);
  return { id: `trade-${value.toString(36)}`, state: { ...state, rng } };
}

export function handleOfferTrade(
  state: GameState,
  fromId: PlayerId,
  toId: PlayerId,
  offered: TradeSide,
  requested: TradeSide,
): Result<PhaseResult, RuleViolation> {
  const blocked = managementBlockedBy(state, fromId);
  if (blocked !== null) return err(blocked);

  if (state.openTrade !== null) {
    // One at a time, so nobody has to reason about which of three overlapping
    // offers they are looking at (→ PRD F13).
    return err(violation('TRADE_ALREADY_OPEN', 'There is already a trade on the table.'));
  }

  if (toId === fromId) {
    return err(violation('SELF_TRADE', 'You cannot trade with yourself.'));
  }

  const recipient = findPlayer(state, toId);
  if (recipient === undefined) {
    return err(violation('PLAYER_NOT_IN_GAME', 'That player is not in this game.'));
  }
  if (recipient.bankrupt) {
    return err(violation('PLAYER_BANKRUPT', 'That player is out of the game.'));
  }

  if (isEmpty(offered) && isEmpty(requested)) {
    return err(violation('INVALID_TRADE', 'A trade has to move something.'));
  }

  const invalid = checkSide(state, fromId, offered) ?? checkSide(state, toId, requested);
  if (invalid !== null) return err(invalid);

  const named = nextTradeId(state);
  const offer: TradeOffer = { id: named.id, fromId, toId, offered, requested };

  return ok({
    state: { ...named.state, openTrade: offer },
    events: [{ type: 'TRADE_OFFERED', tradeId: offer.id, fromId, toId, offered, requested }],
  });
}

export function handleAcceptTrade(
  state: GameState,
  playerId: PlayerId,
): Result<PhaseResult, RuleViolation> {
  const offer = state.openTrade;
  if (offer === null) {
    return err(violation('NO_OPEN_TRADE', 'There is no trade on the table.'));
  }
  if (offer.toId !== playerId) {
    return err(violation('NOT_TRADE_RECIPIENT', 'That trade was not offered to you.'));
  }

  const blocked = managementBlockedBy(state, playerId);
  if (blocked !== null) return err(blocked);

  /*
   * Validated again, not trusted.
   *
   * An offer can sit on the table across several actions. In that time the
   * proposer can spend the cash they promised, or build on a lot they offered.
   * Accepting against the checks made at offer time would transfer money nobody
   * has.
   */
  const invalid =
    checkSide(state, offer.fromId, offer.offered) ?? checkSide(state, offer.toId, offer.requested);
  if (invalid !== null) return err(invalid);

  const events: GameEvent[] = [{ type: 'TRADE_ACCEPTED', tradeId: offer.id }];

  // Everything moves in one construction rather than in steps, so there is no
  // intermediate state in which a deed belongs to nobody.
  let next = moveSide(state, offer.fromId, offer.toId, offer.offered);
  next = moveSide(next, offer.toId, offer.fromId, offer.requested);
  next = { ...next, openTrade: null };

  /*
   * Interest falls due on any mortgaged lot that changed hands (→ PRD F13, D21).
   *
   * The recipient keeps it mortgaged and may clear it later through the ordinary
   * action. F13 also allows clearing it there and then for a single combined
   * payment; that branch is not offered, and D21 records why.
   */
  const arriving = [...offer.offered.deedIds, ...offer.requested.deedIds];
  for (const squareId of arriving) {
    const deed = getDeed(next, squareId);
    if (!deed.mortgaged || deed.ownerId === null) continue;

    const interest = transferInterest(next, squareId);
    if (interest === 0) continue;

    const owner = getPlayer(next, deed.ownerId);
    next = {
      ...next,
      players: {
        ...next.players,
        [deed.ownerId]: { ...owner, cash: owner.cash - interest },
      },
    };
    events.push({
      type: 'MORTGAGE_INTEREST_PAID',
      playerId: deed.ownerId,
      squareId,
      amount: interest,
    });
  }

  return ok({ state: next, events });
}

export function handleDeclineTrade(
  state: GameState,
  playerId: PlayerId,
): Result<PhaseResult, RuleViolation> {
  const offer = state.openTrade;
  if (offer === null) {
    return err(violation('NO_OPEN_TRADE', 'There is no trade on the table.'));
  }
  if (offer.toId !== playerId) {
    return err(violation('NOT_TRADE_RECIPIENT', 'That trade was not offered to you.'));
  }

  return ok({
    state: { ...state, openTrade: null },
    events: [{ type: 'TRADE_DECLINED', tradeId: offer.id }],
  });
}

export function handleWithdrawTrade(
  state: GameState,
  playerId: PlayerId,
): Result<PhaseResult, RuleViolation> {
  const offer = state.openTrade;
  if (offer === null) {
    return err(violation('NO_OPEN_TRADE', 'There is no trade on the table.'));
  }
  if (offer.fromId !== playerId) {
    return err(violation('NOT_TRADE_RECIPIENT', 'That trade is not yours to withdraw.'));
  }

  return ok({
    state: { ...state, openTrade: null },
    events: [{ type: 'TRADE_WITHDRAWN', tradeId: offer.id }],
  });
}

function isEmpty(side: TradeSide): boolean {
  return side.cash === 0 && side.deedIds.length === 0 && side.jailCards === 0;
}

/** Whether a player can actually deliver what their side of a trade promises. */
function checkSide(state: GameState, playerId: PlayerId, side: TradeSide): RuleViolation | null {
  const player = getPlayer(state, playerId);

  if (player.cash < side.cash) {
    return violation('INSUFFICIENT_FUNDS', 'One side of that trade cannot cover the cash.');
  }

  if (player.heldJailCards.length < side.jailCards) {
    return violation('INVALID_TRADE', 'One side does not hold that many release cards.');
  }

  for (const squareId of side.deedIds) {
    const square = squareOrNull(state, squareId);
    if (square === null) {
      return violation('SQUARE_NOT_OWNABLE', 'That square cannot be traded.');
    }

    const deed = getDeed(state, squareId);
    if (deed.ownerId !== playerId) {
      return violation('NOT_THE_OWNER', 'One side does not own everything it offered.');
    }

    if (deed.houses > 0 || deed.hotels > 0) {
      // PRD F13: buildings have to be sold before the lot can move. Trading a
      // built lot would carry buildings out of an even group and break the rule
      // that keeps groups level.
      return violation(
        'PROPERTY_HAS_BUILDINGS',
        'Sell the buildings on that lot before trading it.',
      );
    }
  }

  return null;
}

function squareOrNull(state: GameState, squareId: SquareId) {
  try {
    return getOwnableSquare(boardOf(state), squareId);
  } catch {
    return null;
  }
}

/** Hands one side's cash, deeds and cards over. */
function moveSide(state: GameState, fromId: PlayerId, toId: PlayerId, side: TradeSide): GameState {
  const from = getPlayer(state, fromId);
  const to = getPlayer(state, toId);

  const movedCards = from.heldJailCards.slice(0, side.jailCards);
  const keptCards = from.heldJailCards.slice(side.jailCards);

  const deeds = { ...state.deeds };
  for (const squareId of side.deedIds) {
    deeds[squareId] = { ...getDeed(state, squareId), ownerId: toId };
  }

  return {
    ...state,
    players: {
      ...state.players,
      [fromId]: { ...from, cash: from.cash - side.cash, heldJailCards: keptCards },
      [toId]: {
        ...to,
        cash: to.cash + side.cash,
        heldJailCards: [...to.heldJailCards, ...movedCards],
      },
    },
    deeds,
  };
}
