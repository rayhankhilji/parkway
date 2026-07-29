import { describe, expect, it } from 'vitest';
import { createRng, nextInt, nextUint32, rollDie, shuffle } from '../../src/rng/mulberry32.js';

/**
 * The generator's job is not to be unpredictable — it is to be identical
 * everywhere, forever. These tests care about reproducibility and about the
 * absence of bias, in that order.
 */

describe('createRng', () => {
  it('normalises a seed to an unsigned 32-bit integer', () => {
    expect(createRng(-1).seed).toBe(0xffffffff);
    expect(createRng(0).seed).toBe(0);
    expect(createRng(0x1_0000_0001).seed).toBe(1);
  });

  it('survives a JSON round trip unchanged', () => {
    const state = createRng(123456789);
    const [value, next] = nextUint32(state);
    const revived = JSON.parse(JSON.stringify(next)) as typeof next;
    expect(revived).toEqual(next);
    expect(nextUint32(revived)[0]).toBe(nextUint32(next)[0]);
    expect(value).toBeTypeOf('number');
  });
});

describe('nextUint32', () => {
  it('is a pure function of its state', () => {
    const state = createRng(42);
    expect(nextUint32(state)).toEqual(nextUint32(state));
  });

  it('produces the same sequence from the same seed', () => {
    const take = (count: number): number[] => {
      let state = createRng(2026);
      const values: number[] = [];
      for (let i = 0; i < count; i += 1) {
        const [value, next] = nextUint32(state);
        values.push(value);
        state = next;
      }
      return values;
    };
    expect(take(20)).toEqual(take(20));
  });

  it('stays within the unsigned 32-bit range over a long run', () => {
    let state = createRng(7);
    // Collected rather than asserted per iteration: an expect() call costs far
    // more than the generator does, and this is meant to be the fast loop.
    const outOfRange: number[] = [];
    for (let i = 0; i < 20_000; i += 1) {
      const [value, next] = nextUint32(state);
      if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
        outOfRange.push(value);
      }
      state = next;
    }
    expect(outOfRange).toEqual([]);
  });

  it('does not settle into a short cycle', () => {
    let state = createRng(99);
    const seen = new Set<number>();
    for (let i = 0; i < 5000; i += 1) {
      const [value, next] = nextUint32(state);
      seen.add(value);
      state = next;
    }
    // Collisions in 5000 draws from 2^32 are possible but vanishingly unlikely;
    // a repeating generator would collapse this set to a handful of values.
    expect(seen.size).toBeGreaterThan(4990);
  });
});

describe('nextInt', () => {
  it('rejects a bound that is not a positive integer', () => {
    const state = createRng(1);
    expect(() => nextInt(state, 0)).toThrow('positive integer');
    expect(() => nextInt(state, -3)).toThrow('positive integer');
    expect(() => nextInt(state, 2.5)).toThrow('positive integer');
  });

  it('stays inside the bound', () => {
    let state = createRng(11);
    const outOfRange: number[] = [];
    for (let i = 0; i < 10_000; i += 1) {
      const [value, next] = nextInt(state, 6);
      if (value < 0 || value >= 6) outOfRange.push(value);
      state = next;
    }
    expect(outOfRange).toEqual([]);
  });

  it('distributes evenly enough that no die face is favoured', () => {
    const counts = new Array<number>(6).fill(0);
    let state = createRng(31337);
    const rolls = 120_000;

    for (let i = 0; i < rolls; i += 1) {
      const [value, next] = nextInt(state, 6);
      counts[value] = (counts[value] ?? 0) + 1;
      state = next;
    }

    const expected = rolls / 6;
    for (const count of counts) {
      // Three percent either side of even. A biased generator misses by far more.
      expect(Math.abs(count - expected) / expected).toBeLessThan(0.03);
    }
  });
});

describe('rollDie', () => {
  it('returns faces from one to the number of faces', () => {
    let state = createRng(5);
    const seen = new Set<number>();
    for (let i = 0; i < 500; i += 1) {
      const [value, next] = rollDie(state, 6);
      seen.add(value);
      state = next;
    }
    expect([...seen].sort()).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

describe('shuffle', () => {
  it('keeps every element exactly once', () => {
    const items = Array.from({ length: 40 }, (_, index) => index);
    const [shuffled] = shuffle(items, createRng(2024));
    expect([...shuffled].sort((a, b) => a - b)).toEqual(items);
  });

  it('does not mutate its input', () => {
    const items = [1, 2, 3, 4, 5];
    const copy = [...items];
    shuffle(items, createRng(8));
    expect(items).toEqual(copy);
  });

  it('produces the same order from the same state', () => {
    const items = ['a', 'b', 'c', 'd', 'e', 'f'];
    const [first] = shuffle(items, createRng(77));
    const [second] = shuffle(items, createRng(77));
    expect(first).toEqual(second);
  });

  it('produces different orders from different states', () => {
    const items = Array.from({ length: 40 }, (_, index) => index);
    const [first] = shuffle(items, createRng(1));
    const [second] = shuffle(items, createRng(2));
    expect(first).not.toEqual(second);
  });

  it('advances the generator so a second shuffle differs', () => {
    const items = Array.from({ length: 16 }, (_, index) => index);
    const [first, afterFirst] = shuffle(items, createRng(3));
    const [second] = shuffle(items, afterFirst);
    expect(first).not.toEqual(second);
  });

  it('handles empty and single-element inputs', () => {
    const state = createRng(4);
    expect(shuffle([], state)[0]).toEqual([]);
    expect(shuffle(['only'], state)[0]).toEqual(['only']);
  });

  it('reaches every permutation of a small set', () => {
    const items = ['a', 'b', 'c'];
    const seen = new Set<string>();
    let state = createRng(2718);
    for (let i = 0; i < 400; i += 1) {
      const [shuffled, next] = shuffle(items, state);
      seen.add(shuffled.join(''));
      state = next;
    }
    expect(seen.size).toBe(6);
  });
});
