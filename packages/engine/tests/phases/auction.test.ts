import { describe, expect, it } from 'vitest';
import { getLegalActions } from '../../src/legalActions';
import { minimumBid, openAuction } from '../../src/phases/auction';
import { reduce } from '../../src/reduce';
import { expectOk } from '../../src/result';
import type { Action } from '../../src/actions/types';
import type { GameState } from '../../src/state/types';
import { buildState, type BuildStateOptions } from '../helpers/buildState';

/**
 * PRD F8 — the auction.
 *
 * This is the first phase where players who are not taking their turn act, and the
 * only one where several act at once. Both acceptance rows are here: a bid above
 * the bidder's cash is refused, and the deadline only closes the auction once it
 * has genuinely passed.
 */

const opened = 1_000_000;

function auctioning(options: BuildStateOptions = {}): GameState {
  const base = buildState({ playerIds: ['ada', 'bo', 'cy'], ...options });
  return openAuction(base, 1, opened).state;
}

function act(state: GameState, action: Action, playerId: string, now = opened): GameState {
  return expectOk(reduce(state, action, { playerId, now }), `${action.type} should be legal`).state;
}

function attempt(state: GameState, action: Action, playerId: string, now = opened) {
  return reduce(state, action, { playerId, now });
}

describe('opening', () => {
  it('puts every solvent player in the running, whoever declined', () => {
    const state = auctioning();
    expect(state.phase).toMatchObject({
      kind: 'auction',
      squareId: 1,
      highBid: 0,
      highBidderId: null,
      activeBidderIds: ['ada', 'bo', 'cy'],
    });
  });

  it('leaves out players who are already out', () => {
    const state = auctioning({ players: { cy: { bankrupt: true } } });
    expect(state.phase).toMatchObject({ activeBidderIds: ['ada', 'bo'] });
  });

  it('sets the deadline from the configured duration', () => {
    const state = auctioning({ config: { auctionSeconds: 20 } });
    expect(state.phase).toMatchObject({ deadlineAt: opened + 20_000 });
  });

  it('offers bidding to everyone, not just the active player', () => {
    const state = auctioning();
    for (const id of ['ada', 'bo', 'cy']) {
      expect(getLegalActions(state, id).map((action) => action.type)).toEqual([
        'PLACE_BID',
        'PASS_BID',
      ]);
    }
  });
});

describe('bidding', () => {
  it('starts at the minimum increment', () => {
    expect(minimumBid(auctioning(), 0)).toBe(10);
  });

  it('records a bid and raises the minimum', () => {
    const state = act(auctioning(), { type: 'PLACE_BID', amount: 50 }, 'bo');
    expect(state.phase).toMatchObject({ highBid: 50, highBidderId: 'bo' });
    expect(minimumBid(state, 50)).toBe(60);
  });

  it('refuses a bid that does not clear the increment', () => {
    const state = act(auctioning(), { type: 'PLACE_BID', amount: 50 }, 'bo');
    const result = attempt(state, { type: 'PLACE_BID', amount: 55 }, 'cy');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('BID_BELOW_MINIMUM');
  });

  it('accepts a bid exactly at the minimum', () => {
    const state = act(auctioning(), { type: 'PLACE_BID', amount: 50 }, 'bo');
    expect(act(state, { type: 'PLACE_BID', amount: 60 }, 'cy').phase).toMatchObject({
      highBid: 60,
      highBidderId: 'cy',
    });
  });

  /** PRD F8 — a bid above the bidder's cash is refused and nothing changes. */
  it('refuses a bid beyond the bidder cash and leaves the auction untouched', () => {
    const state = auctioning({ players: { bo: { cash: 100 } } });
    const result = attempt(state, { type: 'PLACE_BID', amount: 101 }, 'bo');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('BID_ABOVE_CASH');
    // Nothing was written: the phase is exactly as it was.
    expect(state.phase).toMatchObject({ highBid: 0, highBidderId: null });
  });

  it('allows a bid of exactly the bidder cash', () => {
    const state = auctioning({ players: { bo: { cash: 100 } } });
    expect(act(state, { type: 'PLACE_BID', amount: 100 }, 'bo').phase).toMatchObject({
      highBid: 100,
    });
  });

  it('offers no bid to a player who cannot reach the minimum', () => {
    const state = act(
      auctioning({ players: { cy: { cash: 40 } } }),
      { type: 'PLACE_BID', amount: 50 },
      'bo',
    );
    expect(getLegalActions(state, 'cy').map((action) => action.type)).toEqual(['PASS_BID']);
  });

  it('restarts the clock on each bid, so a late bid can be answered', () => {
    const state = auctioning({ config: { auctionSeconds: 30 } });
    const later = act(state, { type: 'PLACE_BID', amount: 50 }, 'bo', opened + 29_000);
    expect(later.phase).toMatchObject({ deadlineAt: opened + 29_000 + 30_000 });
  });
});

describe('passing', () => {
  it('takes the player out of the running for good', () => {
    const state = act(auctioning(), { type: 'PASS_BID' }, 'cy');
    expect(state.phase).toMatchObject({ activeBidderIds: ['ada', 'bo'] });
    expect(getLegalActions(state, 'cy')).toEqual([]);
  });

  it('refuses a second pass', () => {
    const state = act(auctioning(), { type: 'PASS_BID' }, 'cy');
    const result = attempt(state, { type: 'PASS_BID' }, 'cy');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('ALREADY_PASSED');
  });

  it('refuses a bid from someone who has passed', () => {
    const state = act(auctioning(), { type: 'PASS_BID' }, 'cy');
    const result = attempt(state, { type: 'PLACE_BID', amount: 50 }, 'cy');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('ALREADY_PASSED');
  });

  it('refuses the leading bidder passing on their own bid', () => {
    const state = act(auctioning(), { type: 'PLACE_BID', amount: 50 }, 'bo');
    const result = attempt(state, { type: 'PASS_BID' }, 'bo');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('ALREADY_PASSED');
    expect(getLegalActions(state, 'bo').map((action) => action.type)).toEqual(['PLACE_BID']);
  });
});

describe('concluding', () => {
  it('sells to the last bidder standing', () => {
    let state = act(auctioning(), { type: 'PLACE_BID', amount: 50 }, 'bo');
    state = act(state, { type: 'PASS_BID' }, 'ada');
    state = act(state, { type: 'PASS_BID' }, 'cy');

    expect(state.deeds[1]?.ownerId).toBe('bo');
    expect(state.players['bo']?.cash).toBe(1450);
    expect(state.phase.kind).toBe('awaiting_end_turn');
  });

  it('concludes as soon as the leader is the only one left', () => {
    // Two passes leave Bo alone; the third player never has to act.
    let state = act(auctioning(), { type: 'PASS_BID' }, 'ada');
    state = act(state, { type: 'PASS_BID' }, 'cy');
    // Bo alone, with no bid yet: bidding now ends it immediately.
    state = act(state, { type: 'PLACE_BID', amount: 10 }, 'bo');

    expect(state.deeds[1]?.ownerId).toBe('bo');
    expect(state.players['bo']?.cash).toBe(1490);
  });

  it('leaves the lot unowned when everybody passes', () => {
    let state = auctioning();
    for (const id of ['ada', 'bo', 'cy']) {
      state = act(state, { type: 'PASS_BID' }, id);
    }
    expect(state.deeds[1]?.ownerId).toBeNull();
    expect(state.phase.kind).toBe('awaiting_end_turn');
  });

  it('hands back the extra roll owed for a double', () => {
    let state = auctioning({ turn: { doublesCount: 1, hasRolled: true, lastRoll: [3, 3] } });
    for (const id of ['ada', 'bo', 'cy']) {
      state = act(state, { type: 'PASS_BID' }, id);
    }
    expect(state.phase.kind).toBe('awaiting_roll');
  });

  it('feeds the pot when that variant is on', () => {
    let state = act(
      auctioning({ config: { freeParkingPot: true } }),
      { type: 'PLACE_BID', amount: 50 },
      'bo',
    );
    state = act(state, { type: 'PASS_BID' }, 'ada');
    state = act(state, { type: 'PASS_BID' }, 'cy');
    expect(state.pot).toBe(50);
  });

  it('sells below the printed price if that is all anyone offered', () => {
    // Tannery Row is printed at 60. An auction can go for less, which is the
    // point of having one.
    let state = act(auctioning(), { type: 'PLACE_BID', amount: 10 }, 'ada');
    state = act(state, { type: 'PASS_BID' }, 'bo');
    state = act(state, { type: 'PASS_BID' }, 'cy');
    expect(state.players['ada']?.cash).toBe(1490);
  });
});

describe('the deadline', () => {
  /** PRD F8 — a timeout before the deadline is rejected. */
  it('refuses a timeout fired early', () => {
    const state = auctioning({ config: { auctionSeconds: 30 } });
    const result = attempt(state, { type: 'AUCTION_TIMEOUT' }, 'ada', opened + 29_999);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('DEADLINE_NOT_REACHED');
  });

  /** PRD F8 — once it passes, a timeout from any client concludes the auction. */
  it('concludes once the deadline has passed, from any client', () => {
    const state = act(auctioning(), { type: 'PLACE_BID', amount: 70 }, 'cy');
    // Fired by a player who is not the leader and not the active player.
    const closed = act(state, { type: 'AUCTION_TIMEOUT' }, 'bo', opened + 60_000);

    expect(closed.deeds[1]?.ownerId).toBe('cy');
    expect(closed.players['cy']?.cash).toBe(1430);
  });

  it('records everyone silent as having passed before knocking the lot down', () => {
    const state = act(auctioning(), { type: 'PLACE_BID', amount: 70 }, 'cy');
    const closed = expectOk(
      reduce(state, { type: 'AUCTION_TIMEOUT' }, { playerId: 'ada', now: opened + 60_000 }),
      'the timeout should be legal',
    );

    expect(closed.events.map((event) => event.type)).toEqual([
      'BID_PASSED',
      'BID_PASSED',
      'AUCTION_WON',
    ]);
    // The leader is not among them: they were not silent, they were winning.
    const passed = closed.events.flatMap((event) =>
      event.type === 'BID_PASSED' ? [event.playerId] : [],
    );
    expect(passed).toEqual(['ada', 'bo']);
  });

  it('leaves the lot unsold when the deadline passes with no bid at all', () => {
    const closed = act(auctioning(), { type: 'AUCTION_TIMEOUT' }, 'ada', opened + 60_000);
    expect(closed.deeds[1]?.ownerId).toBeNull();
    expect(closed.phase.kind).toBe('awaiting_end_turn');
  });

  it('accepts a timeout exactly on the deadline', () => {
    const state = auctioning({ config: { auctionSeconds: 30 } });
    expect(attempt(state, { type: 'AUCTION_TIMEOUT' }, 'ada', opened + 30_000).ok).toBe(true);
  });
});

describe('while an auction is running', () => {
  it('refuses a roll, even from the active player', () => {
    const result = attempt(auctioning(), { type: 'ROLL_DICE' }, 'ada');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('WRONG_PHASE');
  });

  it('refuses ending the turn', () => {
    const result = attempt(auctioning(), { type: 'END_TURN' }, 'ada');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('WRONG_PHASE');
  });

  it('refuses a bid once the auction has closed', () => {
    let state = auctioning();
    for (const id of ['ada', 'bo', 'cy']) {
      state = act(state, { type: 'PASS_BID' }, id);
    }
    const result = attempt(state, { type: 'PLACE_BID', amount: 50 }, 'ada');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('NOT_IN_AUCTION');
  });
});
