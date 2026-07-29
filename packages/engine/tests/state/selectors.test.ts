import { describe, expect, it } from 'vitest';
import {
  activePlayerId,
  canPayInCash,
  countOwnedOfKind,
  diceTotal,
  getDeed,
  getPlayer,
  groupIsUnmortgaged,
  isDouble,
  isSolvent,
  liquidatableValue,
  netWorth,
  ownedSquares,
  ownsFullGroup,
  priceOf,
  solventPlayerIds,
  squareNameOf,
} from '../../src/state/selectors.js';
import { buildState, groupSquareIds, ownGroup } from '../helpers/buildState.js';

/**
 * Selectors answer the questions the rules are built from, so a wrong answer
 * here becomes a wrong answer in several rules at once. The group tests matter
 * most: "owns the group" and "may build on the group" are different questions,
 * and conflating them is how rent doubling ends up wrong.
 */

// Ferryside: three lots at 100, 100 and 120, with a build cost of 50.
const ferryside = groupSquareIds('group-2');
// The Tanneries: two lots at 60, build cost 50.
const tanneries = groupSquareIds('group-1');

describe('player and deed access', () => {
  it('throws on a player who is not in the game', () => {
    const state = buildState();
    expect(() => getPlayer(state, 'ghost')).toThrow('not in this game');
  });

  it('throws on a square that cannot be owned', () => {
    const state = buildState();
    expect(() => getDeed(state, 0)).toThrow('not ownable');
  });
});

describe('turn order', () => {
  it('names the active player from the index', () => {
    const state = buildState({ playerIds: ['ada', 'bo', 'cy'], activeIndex: 2 });
    expect(activePlayerId(state)).toBe('cy');
  });

  it('lists solvent players in turn order, excluding the bankrupt', () => {
    const state = buildState({
      playerIds: ['ada', 'bo', 'cy'],
      players: { bo: { bankrupt: true } },
    });
    expect(solventPlayerIds(state)).toEqual(['ada', 'cy']);
  });
});

describe('dice', () => {
  it('totals a roll', () => {
    expect(diceTotal([3, 4])).toBe(7);
  });

  it('recognises a double', () => {
    expect(isDouble([5, 5])).toBe(true);
    expect(isDouble([5, 4])).toBe(false);
  });
});

describe('ownership', () => {
  it('lists a player holdings in board order', () => {
    const state = buildState({
      deeds: { 15: { ownerId: 'ada' }, 1: { ownerId: 'ada' }, 12: { ownerId: 'bo' } },
    });
    expect(ownedSquares(state, 'ada').map((square) => square.id)).toEqual([1, 15]);
  });

  it('counts stations and utilities separately', () => {
    const state = buildState({
      deeds: {
        5: { ownerId: 'ada' },
        15: { ownerId: 'ada' },
        25: { ownerId: 'bo' },
        12: { ownerId: 'ada' },
      },
    });
    expect(countOwnedOfKind(state, 'ada', 'transit')).toBe(2);
    expect(countOwnedOfKind(state, 'ada', 'utility')).toBe(1);
    expect(countOwnedOfKind(state, 'bo', 'transit')).toBe(1);
  });

  it('reads the price of an ownable square from the pack', () => {
    const state = buildState();
    expect(priceOf(state, 1)).toBe(60);
    expect(priceOf(state, 39)).toBe(400);
  });

  it('names a square', () => {
    expect(squareNameOf(buildState(), 0)).toBe('The Parkway');
  });
});

describe('ownsFullGroup', () => {
  it('is true only when every lot in the group is held', () => {
    const complete = buildState({ deeds: ownGroup('group-2', 'ada') });
    expect(ownsFullGroup(complete, 'ada', 'group-2')).toBe(true);

    const partial = buildState({
      deeds: { [ferryside[0] ?? 0]: { ownerId: 'ada' }, [ferryside[1] ?? 0]: { ownerId: 'ada' } },
    });
    expect(ownsFullGroup(partial, 'ada', 'group-2')).toBe(false);
  });

  it('is false when another player holds one lot', () => {
    const state = buildState({
      deeds: { ...ownGroup('group-2', 'ada'), [ferryside[2] ?? 0]: { ownerId: 'bo' } },
    });
    expect(ownsFullGroup(state, 'ada', 'group-2')).toBe(false);
  });

  it('ignores mortgages and buildings, which are separate questions', () => {
    const state = buildState({ deeds: ownGroup('group-2', 'ada', { mortgaged: true }) });
    expect(ownsFullGroup(state, 'ada', 'group-2')).toBe(true);
    expect(groupIsUnmortgaged(state, 'group-2')).toBe(false);
  });

  it('throws on a group the board does not have', () => {
    expect(() => ownsFullGroup(buildState(), 'ada', 'group-99')).toThrow('not in board pack');
  });
});

describe('netWorth', () => {
  it('is cash alone for a player who owns nothing', () => {
    const state = buildState({ players: { ada: { cash: 1500 } } });
    expect(netWorth(state, 'ada')).toBe(1500);
  });

  it('adds the printed price of every property held', () => {
    const state = buildState({
      players: { ada: { cash: 500 } },
      deeds: { 1: { ownerId: 'ada' }, 5: { ownerId: 'ada' } },
    });
    expect(netWorth(state, 'ada')).toBe(500 + 60 + 200);
  });

  it('counts mortgaged property at its printed price', () => {
    const state = buildState({
      players: { ada: { cash: 0 } },
      deeds: { 1: { ownerId: 'ada', mortgaged: true } },
    });
    expect(netWorth(state, 'ada')).toBe(60);
  });

  it('counts buildings at what they cost', () => {
    const state = buildState({
      players: { ada: { cash: 0 } },
      deeds: ownGroup('group-1', 'ada', { houses: 2 }),
    });
    // Two lots at 60, four houses at 50.
    expect(netWorth(state, 'ada')).toBe(60 + 60 + 4 * 50);
  });

  it('counts a hotel as the five houses it took to build', () => {
    const state = buildState({
      players: { ada: { cash: 0 } },
      deeds: {
        [tanneries[0] ?? 0]: { ownerId: 'ada', hotels: 1 },
        [tanneries[1] ?? 0]: { ownerId: 'ada' },
      },
    });
    expect(netWorth(state, 'ada')).toBe(60 + 60 + 5 * 50);
  });
});

describe('liquidatableValue', () => {
  it('is cash alone for a player who owns nothing', () => {
    const state = buildState({ players: { ada: { cash: 240 } } });
    expect(liquidatableValue(state, 'ada')).toBe(240);
  });

  it('adds the mortgage value of unmortgaged property', () => {
    const state = buildState({
      players: { ada: { cash: 100 } },
      deeds: { 1: { ownerId: 'ada' }, 5: { ownerId: 'ada' } },
    });
    expect(liquidatableValue(state, 'ada')).toBe(100 + 30 + 100);
  });

  it('adds nothing for property already mortgaged', () => {
    const state = buildState({
      players: { ada: { cash: 100 } },
      deeds: { 1: { ownerId: 'ada', mortgaged: true } },
    });
    expect(liquidatableValue(state, 'ada')).toBe(100);
  });

  it('values buildings at the half price the bank pays back', () => {
    const state = buildState({
      players: { ada: { cash: 0 } },
      deeds: ownGroup('group-1', 'ada', { houses: 1 }),
    });
    // Two lots mortgaging at 30, two houses selling back at 25.
    expect(liquidatableValue(state, 'ada')).toBe(30 + 30 + 25 + 25);
  });

  it('decides solvency against the amount owed', () => {
    const state = buildState({
      players: { ada: { cash: 10 } },
      deeds: { 1: { ownerId: 'ada' } },
    });
    // Ten in hand plus thirty of mortgage value.
    expect(isSolvent(state, 'ada', 40)).toBe(true);
    expect(isSolvent(state, 'ada', 41)).toBe(false);
  });

  it('is not the same question as being able to pay in cash', () => {
    const state = buildState({
      players: { ada: { cash: 10 } },
      deeds: { 1: { ownerId: 'ada' } },
    });
    expect(canPayInCash(state, 'ada', 40)).toBe(false);
    expect(isSolvent(state, 'ada', 40)).toBe(true);
  });
});

describe('buildState', () => {
  it('rejects overrides for a player who is not in the roster', () => {
    expect(() => buildState({ players: { ghost: { cash: 1 } } })).toThrow('not in playerIds');
  });

  it('rejects deed overrides for a square that cannot be owned', () => {
    expect(() => buildState({ deeds: { 0: { ownerId: 'ada' } } })).toThrow('not ownable');
  });

  it('rejects an active index outside the turn order', () => {
    expect(() => buildState({ playerIds: ['ada', 'bo'], activeIndex: 2 })).toThrow(
      'outside the turn order',
    );
  });

  it('rejects duplicate player ids', () => {
    expect(() => buildState({ playerIds: ['ada', 'ada'] })).toThrow('duplicate player ids');
  });

  it('produces a state that survives a JSON round trip', () => {
    const state = buildState({ deeds: ownGroup('group-3', 'bo', { houses: 3 }) });
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
  });
});
