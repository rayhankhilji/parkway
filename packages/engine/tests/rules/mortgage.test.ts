import { describe, expect, it } from 'vitest';
import { getLegalActions } from '../../src/legalActions';
import { openAuction } from '../../src/phases/auction';
import { reduce } from '../../src/reduce';
import { expectOk } from '../../src/result';
import {
  mortgageableSquares,
  unmortgageableSquares,
  unmortgageCost,
} from '../../src/rules/mortgage';
import { rentFor } from '../../src/rules/rent';
import type { GameState } from '../../src/state/types';
import {
  buildState,
  groupSquareIds,
  ownGroup,
  type BuildStateOptions,
} from '../helpers/buildState';

/**
 * PRD F11 — mortgaging.
 *
 * A mortgage is a trade: cash now against rent for as long as it stands. The rules
 * worth pinning down are the ones about what it stops — no rent while mortgaged, no
 * building anywhere in the group, and no mortgaging a lot that has buildings on it.
 */
const [lotA = 0, lotB = 0] = groupSquareIds('group-1');

function owning(options: BuildStateOptions = {}): GameState {
  return buildState({
    ...options,
    players: { ada: { cash: 1000 }, ...options.players },
    deeds: { ...ownGroup('group-1', 'ada'), ...options.deeds },
  });
}

function mortgage(state: GameState, squareId: number, playerId = 'ada') {
  return reduce(state, { type: 'MORTGAGE', squareId }, { playerId, now: 0 });
}

function unmortgage(state: GameState, squareId: number, playerId = 'ada') {
  return reduce(state, { type: 'UNMORTGAGE', squareId }, { playerId, now: 0 });
}

describe('mortgaging', () => {
  it('pays half the printed price and marks the deed', () => {
    const result = expectOk(mortgage(owning(), lotA), 'mortgaging should be legal');
    // Tannery Row is printed at 60.
    expect(result.state.players['ada']?.cash).toBe(1030);
    expect(result.state.deeds[lotA]).toMatchObject({ ownerId: 'ada', mortgaged: true });
    expect(result.events).toEqual([
      { type: 'MORTGAGED', playerId: 'ada', squareId: lotA, amount: 30 },
    ]);
  });

  it('keeps the owner, so a mortgaged lot is not back on the market', () => {
    const result = expectOk(mortgage(owning(), lotA), 'mortgaging should be legal');
    expect(result.state.deeds[lotA]?.ownerId).toBe('ada');
  });

  /** PRD F11 — a lot with any building on it cannot be mortgaged. */
  it('refuses a lot with a house on it', () => {
    const state = owning({ deeds: ownGroup('group-1', 'ada', { houses: 1 }) });
    const result = mortgage(state, lotA);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('PROPERTY_HAS_BUILDINGS');
  });

  it('refuses a lot with a hotel on it', () => {
    const state = owning({ deeds: { [lotA]: { ownerId: 'ada', hotels: 1 } } });
    const result = mortgage(state, lotA);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('PROPERTY_HAS_BUILDINGS');
  });

  it('allows mortgaging a bare lot whose sibling is built', () => {
    // The restriction is per lot, not per group: only the built lot is blocked.
    const state = owning({ deeds: { [lotB]: { ownerId: 'ada', houses: 1 } } });
    expect(mortgage(state, lotA).ok).toBe(true);
    expect(mortgage(state, lotB).ok).toBe(false);
  });

  it('refuses a lot already mortgaged', () => {
    const state = owning({ deeds: { [lotA]: { ownerId: 'ada', mortgaged: true } } });
    const result = mortgage(state, lotA);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('PROPERTY_MORTGAGED');
  });

  it('refuses a lot the player does not own', () => {
    const state = buildState({ deeds: ownGroup('group-1', 'bo') });
    const result = mortgage(state, lotA);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('NOT_THE_OWNER');
  });

  it('mortgages stations and utilities at half price too', () => {
    const state = buildState({
      players: { ada: { cash: 0 } },
      deeds: { 5: { ownerId: 'ada' }, 12: { ownerId: 'ada' } },
    });
    expect(expectOk(mortgage(state, 5), 'legal').state.players['ada']?.cash).toBe(100);
    expect(expectOk(mortgage(state, 12), 'legal').state.players['ada']?.cash).toBe(75);
  });

  it('offers exactly the lots that can be mortgaged', () => {
    const state = owning({ deeds: { [lotB]: { ownerId: 'ada', houses: 1 } } });
    expect(mortgageableSquares(state, 'ada')).toEqual([lotA]);
  });
});

describe('what a mortgage stops', () => {
  it('charges no rent while it stands', () => {
    const state = owning({ deeds: ownGroup('group-1', 'ada', { mortgaged: true }) });
    expect(rentFor(state, lotA, 'bo', [3, 4])).toBe(0);
  });

  it('stops the group doubling, even for the lots that are not mortgaged', () => {
    const state = owning({
      deeds: { ...ownGroup('group-1', 'ada'), [lotB]: { ownerId: 'ada', mortgaged: true } },
    });
    // Base rate rather than double: the group is no longer clean.
    expect(rentFor(state, lotA, 'bo', [3, 4])).toBe(2);
  });

  it('stops building anywhere in the group', () => {
    const state = buildState({
      players: { ada: { cash: 5000 } },
      deeds: { ...ownGroup('group-1', 'ada'), [lotB]: { ownerId: 'ada', mortgaged: true } },
    });
    const result = reduce(
      state,
      { type: 'BUILD_HOUSE', squareId: lotA },
      { playerId: 'ada', now: 0 },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('GROUP_HAS_MORTGAGE');
  });
});

describe('clearing a mortgage', () => {
  it('costs half the price plus interest', () => {
    // Half of 60 is 30, and ten percent interest on that is 3.
    const state = owning({ deeds: { [lotA]: { ownerId: 'ada', mortgaged: true } } });
    expect(unmortgageCost(state, lotA)).toBe(33);

    const result = expectOk(unmortgage(state, lotA), 'clearing should be legal');
    expect(result.state.players['ada']?.cash).toBe(967);
    expect(result.state.deeds[lotA]?.mortgaged).toBe(false);
    expect(result.events).toEqual([
      { type: 'UNMORTGAGED', playerId: 'ada', squareId: lotA, amount: 33 },
    ]);
  });

  it('rounds the interest up, so the bank is never short-changed', () => {
    // Cathedral Close is printed at 350, so the mortgage is 175 and ten percent
    // interest is 17.5 — the one figure on this board that does not land on a
    // whole unit. Money is an integer everywhere, and rounding a debt down would
    // hand the player half a pound of the bank's money on every mortgage.
    const state = buildState({
      players: { ada: { cash: 1000 } },
      deeds: { 37: { ownerId: 'ada', mortgaged: true } },
    });
    expect(unmortgageCost(state, 37)).toBe(175 + 18);
  });

  it('restores rent once cleared', () => {
    const state = owning({ deeds: ownGroup('group-1', 'ada', { mortgaged: true }) });
    const cleared = expectOk(unmortgage(state, lotA), 'clearing should be legal').state;
    expect(rentFor(cleared, lotA, 'bo', [3, 4])).toBe(2);
  });

  it('refuses when the player cannot cover the cost', () => {
    const state = owning({
      players: { ada: { cash: 10 } },
      deeds: { [lotA]: { ownerId: 'ada', mortgaged: true } },
    });
    const result = unmortgage(state, lotA);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('INSUFFICIENT_FUNDS');
  });

  it('refuses a lot that is not mortgaged', () => {
    const result = unmortgage(owning(), lotA);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('PROPERTY_NOT_MORTGAGED');
  });

  it('refuses a lot the player does not own', () => {
    const state = buildState({ deeds: ownGroup('group-1', 'bo', { mortgaged: true }) });
    const result = unmortgage(state, lotA);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('NOT_THE_OWNER');
  });

  it('offers exactly the lots that can be cleared', () => {
    const state = owning({ deeds: { [lotA]: { ownerId: 'ada', mortgaged: true } } });
    expect(unmortgageableSquares(state, 'ada')).toEqual([lotA]);
  });

  it('offers nothing to clear when the player cannot afford any of it', () => {
    const state = owning({
      players: { ada: { cash: 0 } },
      deeds: ownGroup('group-1', 'ada', { mortgaged: true }),
    });
    expect(unmortgageableSquares(state, 'ada')).toEqual([]);
  });
});

describe('when mortgaging is allowed at all', () => {
  it('is allowed on somebody else turn', () => {
    const state = owning({ playerIds: ['ada', 'bo'], activeIndex: 1 });
    expect(mortgage(state, lotA).ok).toBe(true);
  });

  it('is refused while an auction is running', () => {
    const state = openAuction(owning(), 6, 0).state;
    const result = mortgage(state, lotA);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('AUCTION_IN_PROGRESS');
    expect(getLegalActions(state, 'ada').map((action) => action.type)).not.toContain('MORTGAGE');
  });

  it('is allowed to the debtor while their debt is open', () => {
    // Raising money is the entire point of the phase (→ PRD F12).
    const state = owning({
      phase: {
        kind: 'awaiting_debt',
        debtorId: 'ada',
        creditorId: 'bo',
        amount: 200,
        interrupted: { kind: 'awaiting_end_turn' },
        remaining: [],
      },
    });
    expect(mortgage(state, lotA).ok).toBe(true);
  });

  it('is refused to everyone else while a debt is open', () => {
    const state = owning({
      playerIds: ['ada', 'bo'],
      phase: {
        kind: 'awaiting_debt',
        debtorId: 'bo',
        creditorId: null,
        amount: 200,
        interrupted: { kind: 'awaiting_end_turn' },
        remaining: [],
      },
    });
    const result = mortgage(state, lotA);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('DEBT_OUTSTANDING');
  });
});
