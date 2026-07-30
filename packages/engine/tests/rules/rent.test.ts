import { describe, expect, it } from 'vitest';
import { rentFor } from '../../src/rules/rent';
import { buildState, groupSquareIds, ownGroup } from '../helpers/buildState';

/**
 * Rent, one rule at a time.
 *
 * PRD F7 has two acceptance rows and both are here, but so are the cases that
 * quietly break real implementations: doubling applied on top of the rent table so
 * one house looks like a downgrade, a mortgaged lot in the group still doubling,
 * and utility rent using a fresh roll instead of the one that caused the landing.
 */

// Ferryside: 100, 100, 120 at build cost 50. Base rents 6, 6, 8.
const ferryside = groupSquareIds('group-2');
const first = ferryside[0] ?? 0;
const second = ferryside[1] ?? 0;
const third = ferryside[2] ?? 0;

// The Tanneries: two lots, base rents 2 and 4.
const tanneries = groupSquareIds('group-1');
const tanneryOne = tanneries[0] ?? 0;
const tanneryTwo = tanneries[1] ?? 0;

describe('who owes what', () => {
  it('charges nothing on an unowned square', () => {
    const state = buildState();
    expect(rentFor(state, first, 'bo', [3, 4])).toBe(0);
  });

  it('charges nothing to the owner standing on their own square', () => {
    const state = buildState({ deeds: { [first]: { ownerId: 'ada' } } });
    expect(rentFor(state, first, 'ada', [3, 4])).toBe(0);
  });

  it('charges nothing on a mortgaged square', () => {
    const state = buildState({ deeds: { [first]: { ownerId: 'ada', mortgaged: true } } });
    expect(rentFor(state, first, 'bo', [3, 4])).toBe(0);
  });
});

describe('lots', () => {
  it('charges the base rate for a lone lot', () => {
    const state = buildState({ deeds: { [first]: { ownerId: 'ada' } } });
    expect(rentFor(state, first, 'bo', [3, 4])).toBe(6);
  });

  /** PRD F7 — rent doubles on a complete unimproved group. */
  it('doubles the base rate on a complete unimproved group', () => {
    const state = buildState({ deeds: ownGroup('group-2', 'ada') });
    expect(rentFor(state, first, 'bo', [3, 4])).toBe(12);
    expect(rentFor(state, third, 'bo', [3, 4])).toBe(16);
  });

  it('does not double when one lot in the group belongs to someone else', () => {
    const state = buildState({
      deeds: { ...ownGroup('group-2', 'ada'), [third]: { ownerId: 'bo' } },
    });
    expect(rentFor(state, first, 'bo', [3, 4])).toBe(6);
  });

  it('does not double when any lot in the group is mortgaged', () => {
    // The landed square itself is unmortgaged; a sibling is. Doubling still stops.
    const state = buildState({
      deeds: { ...ownGroup('group-2', 'ada'), [second]: { ownerId: 'ada', mortgaged: true } },
    });
    expect(rentFor(state, first, 'bo', [3, 4])).toBe(6);
  });

  it('uses the rent table once there are houses, without doubling on top', () => {
    // One house on a complete group is 30, not 60. Applying the doubling as well
    // is the mistake that makes the first house look like a downgrade.
    const state = buildState({ deeds: ownGroup('group-2', 'ada', { houses: 1 }) });
    expect(rentFor(state, first, 'bo', [3, 4])).toBe(30);
  });

  it('climbs the rent table with each house', () => {
    const rents = [1, 2, 3, 4].map((houses) => {
      const state = buildState({ deeds: ownGroup('group-2', 'ada', { houses }) });
      return rentFor(state, first, 'bo', [3, 4]);
    });
    expect(rents).toEqual([30, 90, 270, 400]);
  });

  it('charges the hotel rate for a hotel', () => {
    const state = buildState({
      deeds: { ...ownGroup('group-2', 'ada'), [first]: { ownerId: 'ada', hotels: 1 } },
    });
    expect(rentFor(state, first, 'bo', [3, 4])).toBe(550);
  });

  it('doubles the cheapest group correctly too', () => {
    const state = buildState({ deeds: ownGroup('group-1', 'ada') });
    expect(rentFor(state, tanneryOne, 'bo', [3, 4])).toBe(4);
    expect(rentFor(state, tanneryTwo, 'bo', [3, 4])).toBe(8);
  });
});

describe('stations', () => {
  const stations = [5, 15, 25, 35];

  it('charges by how many the owner holds, not which one you landed on', () => {
    const rents = [1, 2, 3, 4].map((held) => {
      const deeds = Object.fromEntries(
        stations.slice(0, held).map((id) => [id, { ownerId: 'ada' }]),
      );
      const state = buildState({ deeds });
      return rentFor(state, 5, 'bo', [3, 4]);
    });
    expect(rents).toEqual([25, 50, 100, 200]);
  });

  it('charges double when a card sent the player there', () => {
    const state = buildState({ deeds: { 5: { ownerId: 'ada' }, 15: { ownerId: 'ada' } } });
    expect(rentFor(state, 5, 'bo', [3, 4], 'card')).toBe(100);
  });
});

describe('utilities', () => {
  /** PRD F7 — utility rent uses the roll that caused the landing. */
  it('multiplies the causing roll by four when one is held', () => {
    const state = buildState({ deeds: { 12: { ownerId: 'ada' } } });
    expect(rentFor(state, 12, 'bo', [3, 4])).toBe(4 * 7);
    expect(rentFor(state, 12, 'bo', [6, 6])).toBe(4 * 12);
  });

  it('multiplies by ten when both are held', () => {
    const state = buildState({ deeds: { 12: { ownerId: 'ada' }, 28: { ownerId: 'ada' } } });
    expect(rentFor(state, 12, 'bo', [3, 4])).toBe(10 * 7);
  });

  it('uses the higher multiplier whichever utility was landed on', () => {
    const state = buildState({ deeds: { 12: { ownerId: 'ada' }, 28: { ownerId: 'ada' } } });
    expect(rentFor(state, 28, 'bo', [5, 5])).toBe(10 * 10);
  });

  it('charges ten times the roll when a card sent the player there, even with one utility', () => {
    const state = buildState({ deeds: { 12: { ownerId: 'ada' } } });
    expect(rentFor(state, 12, 'bo', [3, 4], 'card')).toBe(10 * 7);
  });

  it('refuses to guess when the causing roll is unknown', () => {
    // A utility charge with no roll behind it would have to invent a number, and
    // an invented number is not reproducible on replay.
    const state = buildState({ deeds: { 12: { ownerId: 'ada' } } });
    expect(() => rentFor(state, 12, 'bo', null)).toThrow('needs the roll');
  });
});
