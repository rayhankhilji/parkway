import type { SquareId } from '../board/types';
import { violation, type RuleViolation } from '../errors';
import type { GameEvent } from '../events/types';
import { err, ok, type Result } from '../result';
import type { GameState, PlayerId } from '../state/types';
import { boardOf, getDeed, getPlayer, solventPlayerIds } from '../state/selectors';
import { phaseAfterObligations, type PhaseResult } from './turnFlow';

/**
 * The auction.
 *
 * This is the first phase where players who are not taking their turn get to act,
 * and the only one where several of them legitimately act at once. The concurrency
 * that makes possible is handled a layer up, by the sequence guard on the write —
 * two bids cannot both commit, and the loser refetches and decides again (→ D4).
 *
 * Nothing that changes ownership or bank supply is legal while an auction is open,
 * so nobody can mortgage or build on the thing under the hammer (→ D10). That is
 * enforced by the handlers for those actions.
 */

/**
 * Opens an auction on a square.
 *
 * Every solvent player is eligible, including whoever just declined it — F8 is
 * explicit about that, and it is what makes declining a real strategic option
 * rather than simply passing the property up.
 */
export function openAuction(
  state: GameState,
  squareId: SquareId,
  now: number,
  estateRemainingIds: readonly SquareId[] = [],
): { state: GameState; events: readonly GameEvent[] } {
  const deadlineAt = now + state.config.auctionSeconds * 1000;

  return {
    state: {
      ...state,
      phase: {
        kind: 'auction',
        squareId,
        highBid: 0,
        highBidderId: null,
        activeBidderIds: solventPlayerIds(state),
        deadlineAt,
        estateRemainingIds,
      },
    },
    events: [{ type: 'AUCTION_OPENED', squareId, deadlineAt }],
  };
}

/** The least a new bid may be, given what is already on the table. */
export function minimumBid(state: GameState, highBid: number): number {
  return highBid + boardOf(state).auction.minimumIncrement;
}

export function handlePlaceBid(
  state: GameState,
  playerId: PlayerId,
  amount: number,
  now: number,
): Result<PhaseResult, RuleViolation> {
  const phase = state.phase;
  if (phase.kind !== 'auction') {
    return err(violation('NOT_IN_AUCTION', 'There is no auction running.'));
  }

  if (!phase.activeBidderIds.includes(playerId)) {
    // Either they already passed, which is final, or they are out of the game.
    return err(violation('ALREADY_PASSED', 'You have passed on this lot.'));
  }

  const minimum = minimumBid(state, phase.highBid);
  if (amount < minimum) {
    return err(violation('BID_BELOW_MINIMUM', `The next bid must be at least ${minimum}.`));
  }

  const player = getPlayer(state, playerId);
  if (amount > player.cash) {
    return err(violation('BID_ABOVE_CASH', 'You cannot bid more than you hold.'));
  }

  /*
   * A bid restarts the clock (→ D20).
   *
   * PRD F15 calls the setting a "bidding duration", which could be read as a
   * fixed window, but a fixed window makes the last bid before the deadline
   * unbeatable however much someone else was willing to pay. Extending on each
   * bid is what makes an auction an auction.
   */
  const deadlineAt = now + state.config.auctionSeconds * 1000;

  const bid: GameState = {
    ...state,
    phase: { ...phase, highBid: amount, highBidderId: playerId, deadlineAt },
  };

  const events: readonly GameEvent[] = [{ type: 'BID_PLACED', playerId, amount }];

  // A high bidder standing alone has won: nobody is left who could raise them.
  if (phase.activeBidderIds.length === 1) {
    return ok(concludeAuction(bid, events, now));
  }

  return ok({ state: bid, events });
}

export function handlePassBid(
  state: GameState,
  playerId: PlayerId,
  now: number,
): Result<PhaseResult, RuleViolation> {
  const phase = state.phase;
  if (phase.kind !== 'auction') {
    return err(violation('NOT_IN_AUCTION', 'There is no auction running.'));
  }

  if (!phase.activeBidderIds.includes(playerId)) {
    return err(violation('ALREADY_PASSED', 'You have already passed on this lot.'));
  }

  if (phase.highBidderId === playerId) {
    // Passing on your own standing bid is not a move, it is a contradiction.
    return err(violation('ALREADY_PASSED', 'You hold the leading bid.'));
  }

  const passed: GameState = {
    ...state,
    phase: {
      ...phase,
      activeBidderIds: phase.activeBidderIds.filter((id) => id !== playerId),
    },
  };

  const events: readonly GameEvent[] = [{ type: 'BID_PASSED', playerId }];

  return ok(concludeIfSettled(passed, events, now));
}

/**
 * The deadline, fired by whichever client noticed it first.
 *
 * The engine compares the server-stamped time against the deadline it stored
 * earlier, so a client cannot bring an auction to an early close by lying about
 * the time (→ D5). Everyone who has not bid is treated as having passed.
 */
export function handleAuctionTimeout(
  state: GameState,
  now: number,
): Result<PhaseResult, RuleViolation> {
  const phase = state.phase;
  if (phase.kind !== 'auction') {
    return err(violation('NOT_IN_AUCTION', 'There is no auction running.'));
  }

  if (now < phase.deadlineAt) {
    return err(violation('DEADLINE_NOT_REACHED', 'The auction is still running.'));
  }

  const events: GameEvent[] = phase.activeBidderIds
    .filter((id) => id !== phase.highBidderId)
    .map((playerId) => ({ type: 'BID_PASSED', playerId }));

  const silenced: GameState = {
    ...state,
    phase: {
      ...phase,
      activeBidderIds: phase.highBidderId === null ? [] : [phase.highBidderId],
    },
  };

  return ok(concludeAuction(silenced, events, now));
}

/** Concludes only if nobody is left who could still raise the bid. */
function concludeIfSettled(
  state: GameState,
  events: readonly GameEvent[],
  now: number,
): PhaseResult {
  const phase = state.phase;
  if (phase.kind !== 'auction') {
    throw new Error('concludeIfSettled called outside an auction');
  }

  const remaining = phase.activeBidderIds;

  if (remaining.length === 0) {
    return concludeAuction(state, events, now);
  }

  if (remaining.length === 1 && remaining[0] === phase.highBidderId) {
    return concludeAuction(state, events, now);
  }

  return { state, events };
}

/**
 * Hands the lot over, or leaves it on the shelf.
 *
 * With no bid at all the square simply stays unowned and play continues, which is
 * what F8 asks for — the bank does not force a sale.
 */
function concludeAuction(state: GameState, events: readonly GameEvent[], now: number): PhaseResult {
  const phase = state.phase;
  if (phase.kind !== 'auction') {
    throw new Error('concludeAuction called outside an auction');
  }

  const { squareId, highBid, highBidderId, estateRemainingIds } = phase;

  if (highBidderId === null) {
    return resumeAfterLot(
      state,
      [...events, { type: 'AUCTION_UNSOLD', squareId }],
      estateRemainingIds,
      now,
    );
  }

  const winner = getPlayer(state, highBidderId);
  if (winner.cash < highBid) {
    // Bids are checked against cash when placed, and nothing during an auction
    // can reduce a player's cash. If this ever fires, that guarantee has broken.
    throw new Error(`Auction winner ${highBidderId} can no longer cover their own bid`);
  }

  const sold: GameState = {
    ...state,
    players: {
      ...state.players,
      [highBidderId]: { ...winner, cash: winner.cash - highBid },
    },
    deeds: {
      ...state.deeds,
      [squareId]: { ...getDeed(state, squareId), ownerId: highBidderId },
    },
    // Money paid to the bank feeds the pot when that variant is on.
    pot: state.config.freeParkingPot ? state.pot + highBid : state.pot,
  };

  return resumeAfterLot(
    sold,
    [...events, { type: 'AUCTION_WON', playerId: highBidderId, squareId, amount: highBid }],
    estateRemainingIds,
    now,
  );
}

/**
 * What happens after a lot is settled.
 *
 * A bankrupt player's estate is auctioned lot by lot in board order (→ PRD F14),
 * so the next one opens straight away rather than handing the turn back.
 */
function resumeAfterLot(
  state: GameState,
  events: readonly GameEvent[],
  estateRemainingIds: readonly SquareId[],
  now: number,
): PhaseResult {
  const [next, ...rest] = estateRemainingIds;

  if (next !== undefined) {
    // The next lot gets a fresh clock from the action that closed the last one,
    // not the deadline that just expired.
    const opened = openAuction(state, next, now, rest);
    return { state: opened.state, events: [...events, ...opened.events] };
  }

  return { state: { ...state, phase: phaseAfterObligations(state) }, events };
}

/** Whether an auction is running, for the handlers that must stand down while it is. */
export function auctionInProgress(state: GameState): boolean {
  return state.phase.kind === 'auction';
}
