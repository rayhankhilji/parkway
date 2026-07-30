import { describe, expect, it } from 'vitest';
import { getBoardPack } from '../../src/board/registry';
import { getLegalActions } from '../../src/legalActions';
import { openAuction } from '../../src/phases/auction';
import { reduce } from '../../src/reduce';
import { expectOk } from '../../src/result';
import { buildableSquares, sellableSquares } from '../../src/rules/building';
import type { GameState } from '../../src/state/types';
import {
  buildState,
  groupSquareIds,
  ownGroup,
  type BuildStateOptions,
} from '../helpers/buildState';

const pack = getBoardPack('parkway-classic');

/**
 * PRD F11 — houses and hotels. All three acceptance rows are here.
 *
 * The Tanneries is the useful group for this: two lots at a build cost of 50, so a
 * whole group can be taken to hotels without needing thousands in cash, and the
 * even-build rule is visible with the smallest possible number of moves.
 */
const [lotA = 0, lotB = 0] = groupSquareIds('group-1');

function owning(options: BuildStateOptions = {}): GameState {
  return buildState({
    ...options,
    // Merged after the spread, or the caller's own deeds would replace the
    // ownership this helper exists to set up rather than adding to it.
    players: { ada: { cash: 5000 }, ...options.players },
    deeds: { ...ownGroup('group-1', 'ada'), ...options.deeds },
  });
}

function build(state: GameState, squareId: number, playerId = 'ada') {
  return reduce(state, { type: 'BUILD_HOUSE', squareId }, { playerId, now: 0 });
}

function sell(state: GameState, squareId: number, playerId = 'ada') {
  return reduce(state, { type: 'SELL_HOUSE', squareId }, { playerId, now: 0 });
}

function buildOk(state: GameState, squareId: number, playerId = 'ada'): GameState {
  return expectOk(build(state, squareId, playerId), 'building should be legal').state;
}

describe('what has to be true before building', () => {
  it('refuses a lot the player does not own', () => {
    const state = buildState({ deeds: ownGroup('group-1', 'bo') });
    const result = build(state, lotA);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('NOT_THE_OWNER');
  });

  it('refuses an incomplete group', () => {
    const state = buildState({ deeds: { [lotA]: { ownerId: 'ada' } } });
    const result = build(state, lotA);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('INCOMPLETE_GROUP');
  });

  it('refuses a group with a mortgage anywhere in it', () => {
    const state = owning({
      deeds: { ...ownGroup('group-1', 'ada'), [lotB]: { ownerId: 'ada', mortgaged: true } },
    });
    const result = build(state, lotA);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('GROUP_HAS_MORTGAGE');
  });

  it('refuses a station or a utility', () => {
    const state = buildState({ deeds: { 5: { ownerId: 'ada' }, 12: { ownerId: 'ada' } } });
    for (const squareId of [5, 12]) {
      const result = build(state, squareId);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('SQUARE_NOT_OWNABLE');
    }
  });

  it('refuses a player who cannot afford the build cost', () => {
    const state = owning({ players: { ada: { cash: 10 } } });
    const result = build(state, lotA);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('INSUFFICIENT_FUNDS');
  });
});

describe('even build', () => {
  /** PRD F11 — a second house while a sibling has none is rejected. */
  it('refuses a second house while another lot in the group has none', () => {
    const state = owning({ deeds: { [lotA]: { ownerId: 'ada', houses: 1 } } });
    const result = build(state, lotA);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('UNEVEN_BUILD');
  });

  it('allows the lot that is behind to catch up', () => {
    const state = owning({ deeds: { [lotA]: { ownerId: 'ada', houses: 1 } } });
    expect(buildOk(state, lotB).deeds[lotB]?.houses).toBe(1);
  });

  it('offers only the lots that are at the group minimum', () => {
    const state = owning({ deeds: { [lotA]: { ownerId: 'ada', houses: 1 } } });
    expect(buildableSquares(state, 'ada')).toEqual([lotB]);
  });

  it('walks a group up to hotels one legal step at a time', () => {
    let state = owning();
    const order: number[] = [];

    // Alternating is the only legal path: each lot must wait for the other.
    for (let round = 0; round < 5; round += 1) {
      for (const lot of [lotA, lotB]) {
        state = buildOk(state, lot);
        order.push(lot);
      }
    }

    expect(order).toHaveLength(10);
    expect(state.deeds[lotA]).toMatchObject({ houses: 0, hotels: 1 });
    expect(state.deeds[lotB]).toMatchObject({ houses: 0, hotels: 1 });
  });

  it('refuses building on a lot that already has a hotel', () => {
    const state = owning({ deeds: ownGroup('group-1', 'ada', { hotels: 1 }) });
    const result = build(state, lotA);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('MAX_DEVELOPMENT');
  });
});

describe('the bank supply', () => {
  /** PRD F11 — with no houses in the bank, a build is refused. */
  it('refuses a house when the bank has none', () => {
    const state = owning({ bank: { houses: 0 } });
    const result = build(state, lotA);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('BANK_OUT_OF_HOUSES');
    expect(buildableSquares(state, 'ada')).toEqual([]);
  });

  it('refuses a hotel when the bank has none, even with houses available', () => {
    const state = owning({
      bank: { houses: 10, hotels: 0 },
      deeds: ownGroup('group-1', 'ada', { houses: 4 }),
    });
    const result = build(state, lotA);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('BANK_OUT_OF_HOTELS');
  });

  it('takes one house out of the bank per house built', () => {
    const state = buildOk(owning(), lotA);
    expect(state.bank.houses).toBe(pack.bank.houses - 1);
  });

  /** PRD F11 — a hotel frees four houses, available immediately. */
  it('returns four houses to the bank when a hotel goes up', () => {
    const state = owning({
      bank: { houses: 0, hotels: 12 },
      deeds: ownGroup('group-1', 'ada', { houses: 4 }),
    });

    const withHotel = buildOk(state, lotA);
    expect(withHotel.deeds[lotA]).toMatchObject({ houses: 0, hotels: 1 });
    expect(withHotel.bank.houses).toBe(pack.housesPerHotel);
    expect(withHotel.bank.hotels).toBe(11);
  });

  it('needs no houses from the bank to build a hotel', () => {
    // The fifth house is exchanged for the four already standing, so an empty
    // bank is no obstacle to a hotel — only to a house.
    const state = owning({
      bank: { houses: 0, hotels: 12 },
      deeds: ownGroup('group-1', 'ada', { houses: 4 }),
    });
    expect(build(state, lotA).ok).toBe(true);
  });

  it('makes those freed houses usable by another player on the next action', () => {
    const state = owning({
      playerIds: ['ada', 'bo'],
      bank: { houses: 0, hotels: 12 },
      players: { ada: { cash: 5000 }, bo: { cash: 5000 } },
      deeds: {
        ...ownGroup('group-1', 'ada', { houses: 4 }),
        ...ownGroup('group-2', 'bo'),
      },
    });

    const [boLot = 0] = groupSquareIds('group-2');
    expect(build(state, boLot, 'bo').ok).toBe(false);

    const afterHotel = buildOk(state, lotA);
    expect(build(afterHotel, boLot, 'bo').ok).toBe(true);
  });
});

describe('paying for it', () => {
  it('charges the group build cost', () => {
    const state = buildOk(owning({ players: { ada: { cash: 1000 } } }), lotA);
    expect(state.players['ada']?.cash).toBe(950);
  });

  it('charges the right cost for a dearer group', () => {
    const state = buildState({
      players: { ada: { cash: 2000 } },
      deeds: ownGroup('group-8', 'ada'),
    });
    const [close = 0] = groupSquareIds('group-8');
    expect(buildOk(state, close).players['ada']?.cash).toBe(1800);
  });

  it('feeds the pot when that variant is on', () => {
    const state = buildOk(owning({ config: { freeParkingPot: true } }), lotA);
    expect(state.pot).toBe(50);
  });

  it('reports the build with the running house count', () => {
    const result = expectOk(build(owning(), lotA), 'building should be legal');
    expect(result.events).toEqual([
      { type: 'HOUSE_BUILT', playerId: 'ada', squareId: lotA, cost: 50, houses: 1 },
    ]);
  });

  it('reports a hotel separately', () => {
    const state = owning({ deeds: ownGroup('group-1', 'ada', { houses: 4 }) });
    const result = expectOk(build(state, lotA), 'building should be legal');
    expect(result.events).toEqual([
      { type: 'HOTEL_BUILT', playerId: 'ada', squareId: lotA, cost: 50 },
    ]);
  });
});

describe('selling', () => {
  it('refunds half the build cost', () => {
    const state = owning({
      players: { ada: { cash: 100 } },
      deeds: ownGroup('group-1', 'ada', { houses: 1 }),
    });
    const sold = expectOk(sell(state, lotA), 'selling should be legal');
    expect(sold.state.players['ada']?.cash).toBe(125);
    expect(sold.state.deeds[lotA]?.houses).toBe(0);
  });

  it('returns the house to the bank', () => {
    const state = owning({
      bank: { houses: 20 },
      deeds: ownGroup('group-1', 'ada', { houses: 1 }),
    });
    expect(expectOk(sell(state, lotA), 'selling should be legal').state.bank.houses).toBe(21);
  });

  it('refuses selling from a lot with nothing on it', () => {
    const result = sell(owning(), lotA);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('NO_BUILDINGS_TO_SELL');
  });

  it('enforces even selling, taking the tallest lots down first', () => {
    const state = owning({
      deeds: {
        ...ownGroup('group-1', 'ada', { houses: 1 }),
        [lotA]: { ownerId: 'ada', houses: 2 },
      },
    });
    const result = sell(state, lotB);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('UNEVEN_SELL');
    expect(sellableSquares(state, 'ada')).toEqual([lotA]);
  });

  it('breaks a hotel back into four houses rather than into nothing', () => {
    const state = owning({
      players: { ada: { cash: 0 } },
      deeds: {
        ...ownGroup('group-1', 'ada', { houses: 4 }),
        [lotA]: { ownerId: 'ada', hotels: 1 },
      },
    });
    const sold = expectOk(sell(state, lotA), 'selling should be legal');

    expect(sold.state.deeds[lotA]).toMatchObject({ houses: 4, hotels: 0 });
    // Only the fifth house was sold, so the refund is half of one build cost.
    expect(sold.state.players['ada']?.cash).toBe(25);
    expect(sold.state.bank.hotels).toBe(pack.bank.hotels + 1);
    expect(sold.state.bank.houses).toBe(pack.bank.houses - pack.housesPerHotel);
  });

  it('refuses to break a hotel the bank cannot supply houses for', () => {
    const state = owning({
      bank: { houses: 3 },
      deeds: {
        ...ownGroup('group-1', 'ada', { houses: 4 }),
        [lotA]: { ownerId: 'ada', hotels: 1 },
      },
    });
    const result = sell(state, lotA);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('BANK_OUT_OF_HOUSES');
  });

  it('refuses selling from a lot the player does not own', () => {
    const state = buildState({ deeds: ownGroup('group-1', 'bo', { houses: 1 }) });
    const result = sell(state, lotA);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('NOT_THE_OWNER');
  });
});

describe('when building is allowed at all', () => {
  it('is allowed on somebody else turn', () => {
    // PRD F11 is explicit: these actions are available at any time, which is why
    // building is not a phase (→ D10).
    const state = owning({ playerIds: ['ada', 'bo'], activeIndex: 1 });
    expect(build(state, lotA).ok).toBe(true);
  });

  it('is allowed while a purchase decision is open for somebody else', () => {
    const state = owning({
      playerIds: ['ada', 'bo'],
      activeIndex: 1,
      players: { ada: { cash: 5000 }, bo: { position: 6 } },
      phase: { kind: 'awaiting_purchase', squareId: 6 },
    });
    expect(build(state, lotA).ok).toBe(true);
  });

  it('is refused while an auction is running', () => {
    const state = openAuction(owning(), 6, 0).state;
    const result = build(state, lotA);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('AUCTION_IN_PROGRESS');
    expect(getLegalActions(state, 'ada').map((action) => action.type)).not.toContain('BUILD_HOUSE');
  });

  it('is refused to everyone but the debtor while a debt is open', () => {
    const state = owning({
      playerIds: ['ada', 'bo'],
      players: { ada: { cash: 5000 }, bo: { cash: 5000 } },
      deeds: { ...ownGroup('group-1', 'ada'), ...ownGroup('group-2', 'bo') },
      phase: {
        kind: 'awaiting_debt',
        debtorId: 'bo',
        creditorId: null,
        amount: 200,
        interrupted: { kind: 'awaiting_end_turn' },
        remaining: [],
      },
    });

    const result = build(state, lotA);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('DEBT_OUTSTANDING');

    // The debtor may still act — raising money is the whole point of the phase.
    const [boLot = 0] = groupSquareIds('group-2');
    expect(build(state, boLot, 'bo').ok).toBe(true);
  });
});
