import { describe, expect, it } from 'vitest';
import { getLegalActions } from '../../src/legalActions';
import { openAuction } from '../../src/phases/auction';
import { reduce } from '../../src/reduce';
import { expectOk } from '../../src/result';
import type { Action } from '../../src/actions/types';
import type { GameState, TradeSide } from '../../src/state/types';
import {
  buildState,
  groupSquareIds,
  ownGroup,
  type BuildStateOptions,
} from '../helpers/buildState';

/**
 * PRD F13 — trading.
 *
 * The acceptance row is that trades are atomic: every listed asset moves or none
 * does. Most of what follows is about the ways a trade can be invalid, because an
 * offer sits on the table across other actions and the world moves underneath it.
 */

const [tanneryA = 0, tanneryB = 0] = groupSquareIds('group-1');
const [ferryA = 0] = groupSquareIds('group-2');

const nothing: TradeSide = { cash: 0, deedIds: [], jailCards: 0 };
const side = (partial: Partial<TradeSide>): TradeSide => ({ ...nothing, ...partial });

function table(options: BuildStateOptions = {}): GameState {
  return buildState({
    ...options,
    players: { ada: { cash: 1000 }, bo: { cash: 1000 }, ...options.players },
    deeds: {
      [tanneryA]: { ownerId: 'ada' },
      [tanneryB]: { ownerId: 'ada' },
      [ferryA]: { ownerId: 'bo' },
      ...options.deeds,
    },
  });
}

function act(state: GameState, action: Action, playerId: string) {
  return reduce(state, action, { playerId, now: 0 });
}

function actOk(state: GameState, action: Action, playerId: string): GameState {
  return expectOk(act(state, action, playerId), `${action.type} should be legal`).state;
}

function offer(
  state: GameState,
  offered: TradeSide,
  requested: TradeSide,
  fromId = 'ada',
  toId = 'bo',
): GameState {
  return actOk(state, { type: 'OFFER_TRADE', toId, offered, requested }, fromId);
}

describe('offering', () => {
  it('puts one offer on the table', () => {
    const state = offer(table(), side({ deedIds: [tanneryA] }), side({ cash: 200 }));

    expect(state.openTrade).toMatchObject({
      fromId: 'ada',
      toId: 'bo',
      offered: { cash: 0, deedIds: [tanneryA], jailCards: 0 },
      requested: { cash: 200, deedIds: [], jailCards: 0 },
    });
    // Nothing has moved yet: an offer is a proposal, not a transfer.
    expect(state.deeds[tanneryA]?.ownerId).toBe('ada');
    expect(state.players['bo']?.cash).toBe(1000);
  });

  /** PRD F13 — only one offer may be open at a time. */
  it('refuses a second offer while one is open', () => {
    const state = offer(table(), side({ deedIds: [tanneryA] }), side({ cash: 200 }));
    const result = act(
      state,
      { type: 'OFFER_TRADE', toId: 'ada', offered: nothing, requested: side({ cash: 10 }) },
      'bo',
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('TRADE_ALREADY_OPEN');
  });

  it('refuses trading with yourself', () => {
    const result = act(
      table(),
      { type: 'OFFER_TRADE', toId: 'ada', offered: side({ cash: 10 }), requested: nothing },
      'ada',
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('SELF_TRADE');
  });

  it('refuses an offer that moves nothing at all', () => {
    const result = act(
      table(),
      { type: 'OFFER_TRADE', toId: 'bo', offered: nothing, requested: nothing },
      'ada',
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('INVALID_TRADE');
  });

  it('refuses offering a lot the proposer does not own', () => {
    const result = act(
      table(),
      { type: 'OFFER_TRADE', toId: 'bo', offered: side({ deedIds: [ferryA] }), requested: nothing },
      'ada',
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('NOT_THE_OWNER');
  });

  it('refuses asking for a lot the recipient does not own', () => {
    const result = act(
      table(),
      {
        type: 'OFFER_TRADE',
        toId: 'bo',
        offered: nothing,
        requested: side({ deedIds: [tanneryA] }),
      },
      'ada',
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('NOT_THE_OWNER');
  });

  it('refuses cash neither side holds', () => {
    const state = table({ players: { ada: { cash: 10 }, bo: { cash: 1000 } } });
    const result = act(
      state,
      { type: 'OFFER_TRADE', toId: 'bo', offered: side({ cash: 500 }), requested: nothing },
      'ada',
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('INSUFFICIENT_FUNDS');
  });

  /** PRD F13 — a built lot is rejected at offer time. */
  it('refuses a lot with buildings on it', () => {
    const state = table({ deeds: ownGroup('group-1', 'ada', { houses: 1 }) });
    const result = act(
      state,
      {
        type: 'OFFER_TRADE',
        toId: 'bo',
        offered: side({ deedIds: [tanneryA] }),
        requested: nothing,
      },
      'ada',
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('PROPERTY_HAS_BUILDINGS');
  });

  it('refuses more release cards than the player holds', () => {
    const result = act(
      table(),
      { type: 'OFFER_TRADE', toId: 'bo', offered: side({ jailCards: 1 }), requested: nothing },
      'ada',
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('INVALID_TRADE');
  });

  it('refuses a recipient who is out of the game', () => {
    const state = table({ playerIds: ['ada', 'bo', 'cy'], players: { cy: { bankrupt: true } } });
    const result = act(
      state,
      { type: 'OFFER_TRADE', toId: 'cy', offered: side({ cash: 10 }), requested: nothing },
      'ada',
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('PLAYER_BANKRUPT');
  });
});

describe('accepting', () => {
  /** PRD F13 — an accepted trade transfers every listed asset. */
  it('moves cash, deeds and cards in both directions at once', () => {
    const start = table({
      players: {
        ada: { cash: 1000, heldJailCards: ['chance'] },
        bo: { cash: 1000 },
      },
    });

    const offered = side({ cash: 150, deedIds: [tanneryA], jailCards: 1 });
    const requested = side({ cash: 400, deedIds: [ferryA] });

    const done = actOk(offer(start, offered, requested), { type: 'ACCEPT_TRADE' }, 'bo');

    expect(done.players['ada']?.cash).toBe(1000 - 150 + 400);
    expect(done.players['bo']?.cash).toBe(1000 + 150 - 400);
    expect(done.deeds[tanneryA]?.ownerId).toBe('bo');
    expect(done.deeds[ferryA]?.ownerId).toBe('ada');
    expect(done.players['ada']?.heldJailCards).toEqual([]);
    expect(done.players['bo']?.heldJailCards).toEqual(['chance']);
    expect(done.openTrade).toBeNull();
  });

  it('leaves everything alone when the proposer can no longer deliver', () => {
    // The offer stands, but Ada spends the cash before Bo answers. Accepting must
    // refuse rather than move part of it.
    const start = table();
    const proposed = offer(start, side({ cash: 900 }), side({ deedIds: [ferryA] }));
    const ada = proposed.players['ada'];
    if (ada === undefined) throw new Error('Ada should be in this game');
    const poorer: GameState = {
      ...proposed,
      players: { ...proposed.players, ada: { ...ada, cash: 10 } },
    };

    const result = act(poorer, { type: 'ACCEPT_TRADE' }, 'bo');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('INSUFFICIENT_FUNDS');
    expect(poorer.deeds[ferryA]?.ownerId).toBe('bo');
    expect(poorer.openTrade).not.toBeNull();
  });

  it('leaves everything alone when a lot has been built on since the offer', () => {
    const start = table({ players: { ada: { cash: 5000 }, bo: { cash: 1000 } } });
    const proposed = offer(start, side({ deedIds: [tanneryA] }), side({ cash: 10 }));
    const built = actOk(proposed, { type: 'BUILD_HOUSE', squareId: tanneryA }, 'ada');

    const result = act(built, { type: 'ACCEPT_TRADE' }, 'bo');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('PROPERTY_HAS_BUILDINGS');
    expect(built.deeds[tanneryA]?.ownerId).toBe('ada');
  });

  it('refuses acceptance from anyone but the recipient', () => {
    const state = offer(
      table({ playerIds: ['ada', 'bo', 'cy'] }),
      side({ deedIds: [tanneryA] }),
      side({ cash: 10 }),
    );
    for (const id of ['ada', 'cy']) {
      const result = act(state, { type: 'ACCEPT_TRADE' }, id);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('NOT_TRADE_RECIPIENT');
    }
  });

  it('refuses acceptance when nothing is on the table', () => {
    const result = act(table(), { type: 'ACCEPT_TRADE' }, 'bo');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('NO_OPEN_TRADE');
  });
});

describe('a mortgaged lot changing hands', () => {
  /** PRD F13 — interest falls due on receipt (→ D21). */
  it('charges the new owner interest', () => {
    const start = table({
      deeds: { [tanneryA]: { ownerId: 'ada', mortgaged: true }, [ferryA]: { ownerId: 'bo' } },
    });
    const done = actOk(
      offer(start, side({ deedIds: [tanneryA] }), side({ cash: 10 })),
      { type: 'ACCEPT_TRADE' },
      'bo',
    );

    // Bo pays the 10 Ada asked for, and 3 interest on the mortgage that arrived:
    // Tannery Row mortgages at 30, so ten percent of that is 3.
    expect(done.players['bo']?.cash).toBe(1000 - 10 - 3);
    expect(done.deeds[tanneryA]).toMatchObject({ ownerId: 'bo', mortgaged: true });
  });

  it('reports the interest so the feed can explain the deduction', () => {
    const start = table({ deeds: { [tanneryA]: { ownerId: 'ada', mortgaged: true } } });
    const result = expectOk(
      act(
        offer(start, side({ deedIds: [tanneryA] }), side({ cash: 10 })),
        { type: 'ACCEPT_TRADE' },
        'bo',
      ),
      'accepting should be legal',
    );

    expect(result.events).toEqual([
      { type: 'TRADE_ACCEPTED', tradeId: expect.any(String) },
      { type: 'MORTGAGE_INTEREST_PAID', playerId: 'bo', squareId: tanneryA, amount: 3 },
    ]);
  });

  it('charges nothing on an unmortgaged lot', () => {
    const done = actOk(
      offer(table(), side({ deedIds: [tanneryA] }), side({ cash: 10 })),
      { type: 'ACCEPT_TRADE' },
      'bo',
    );
    // The 10 Ada asked for, and nothing else: no mortgage, no interest.
    expect(done.players['bo']?.cash).toBe(990);
  });
});

describe('declining and withdrawing', () => {
  it('clears the table on a decline, moving nothing', () => {
    const state = offer(table(), side({ deedIds: [tanneryA] }), side({ cash: 200 }));
    const done = actOk(state, { type: 'DECLINE_TRADE' }, 'bo');

    expect(done.openTrade).toBeNull();
    expect(done.deeds[tanneryA]?.ownerId).toBe('ada');
    expect(done.players['ada']?.cash).toBe(1000);
  });

  it('lets the proposer withdraw their own offer', () => {
    const state = offer(table(), side({ deedIds: [tanneryA] }), side({ cash: 200 }));
    expect(actOk(state, { type: 'WITHDRAW_TRADE' }, 'ada').openTrade).toBeNull();
  });

  it('refuses a withdrawal from the recipient', () => {
    const state = offer(table(), side({ deedIds: [tanneryA] }), side({ cash: 200 }));
    const result = act(state, { type: 'WITHDRAW_TRADE' }, 'bo');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('NOT_TRADE_RECIPIENT');
  });

  it('frees the table for a new offer once cleared', () => {
    const state = offer(table(), side({ deedIds: [tanneryA] }), side({ cash: 200 }));
    const cleared = actOk(state, { type: 'DECLINE_TRADE' }, 'bo');
    expect(
      act(
        cleared,
        { type: 'OFFER_TRADE', toId: 'ada', offered: side({ cash: 5 }), requested: nothing },
        'bo',
      ).ok,
    ).toBe(true);
  });
});

describe('what is offered to whom', () => {
  it('offers the trade to the recipient and a withdrawal to the proposer', () => {
    const state = offer(
      table({ playerIds: ['ada', 'bo', 'cy'] }),
      side({ deedIds: [tanneryA] }),
      side({ cash: 10 }),
    );

    const types = (id: string) => getLegalActions(state, id).map((action) => action.type);
    expect(types('bo')).toContain('ACCEPT_TRADE');
    expect(types('bo')).toContain('DECLINE_TRADE');
    expect(types('ada')).toContain('WITHDRAW_TRADE');
    expect(types('cy')).not.toContain('ACCEPT_TRADE');
  });

  it('offers no new trade while one is open', () => {
    const state = offer(table(), side({ deedIds: [tanneryA] }), side({ cash: 10 }));
    for (const id of ['ada', 'bo']) {
      expect(getLegalActions(state, id).map((action) => action.type)).not.toContain('OFFER_TRADE');
    }
  });

  it('names the players who can be traded with', () => {
    const state = table({ playerIds: ['ada', 'bo', 'cy'] });
    const offering = getLegalActions(state, 'ada').find((action) => action.type === 'OFFER_TRADE');
    expect(offering).toEqual({ type: 'OFFER_TRADE', candidateIds: ['bo', 'cy'] });
  });
});

describe('when trading is allowed at all', () => {
  it('is allowed on somebody else turn', () => {
    const state = table({ activeIndex: 1 });
    expect(
      act(
        state,
        { type: 'OFFER_TRADE', toId: 'bo', offered: side({ cash: 10 }), requested: nothing },
        'ada',
      ).ok,
    ).toBe(true);
  });

  it('is refused while an auction is running', () => {
    const state = openAuction(table(), 6, 0).state;
    const result = act(
      state,
      { type: 'OFFER_TRADE', toId: 'bo', offered: side({ cash: 10 }), requested: nothing },
      'ada',
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('AUCTION_IN_PROGRESS');
  });

  it('is allowed to a debtor, who may be trading their way out', () => {
    const state = table({
      players: { ada: { cash: 10 }, bo: { cash: 1000 } },
      phase: {
        kind: 'awaiting_debt',
        debtorId: 'ada',
        creditorId: 'bo',
        amount: 500,
        interrupted: { kind: 'awaiting_end_turn' },
        remaining: [],
      },
    });
    expect(
      act(
        state,
        {
          type: 'OFFER_TRADE',
          toId: 'bo',
          offered: side({ deedIds: [tanneryA] }),
          requested: side({ cash: 500 }),
        },
        'ada',
      ).ok,
    ).toBe(true);
  });
});
