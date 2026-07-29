import { describe, expect, it } from 'vitest';
import { getBoardPack } from '../../src/board/registry.js';
import { createGame } from '../../src/state/createGame.js';
import { toPublicState } from '../../src/state/publicState.js';
import { expectOk } from '../../src/result.js';
import { buildState, testConfig } from '../helpers/buildState.js';

const pack = getBoardPack('parkway-classic');

const state = expectOk(
  createGame({
    playerIds: ['ada', 'bo', 'cy'],
    config: testConfig,
    boardPackId: 'parkway-classic',
    seed: 8675309,
  }),
  'createGame should succeed',
);

const publicState = toPublicState(state);
const serialised = JSON.parse(JSON.stringify(publicState)) as unknown;

/** Every key that appears anywhere in a nested structure. */
function collectKeys(value: unknown, into: Set<string> = new Set()): Set<string> {
  if (Array.isArray(value)) {
    for (const entry of value) collectKeys(entry, into);
    return into;
  }
  if (typeof value === 'object' && value !== null) {
    for (const [key, nested] of Object.entries(value)) {
      into.add(key);
      collectKeys(nested, into);
    }
  }
  return into;
}

/** Every string that appears anywhere in a nested structure. */
function collectStrings(value: unknown, into: Set<string> = new Set()): Set<string> {
  if (typeof value === 'string') {
    into.add(value);
    return into;
  }
  if (Array.isArray(value)) {
    for (const entry of value) collectStrings(entry, into);
    return into;
  }
  if (typeof value === 'object' && value !== null) {
    for (const nested of Object.values(value)) collectStrings(nested, into);
  }
  return into;
}

describe('toPublicState', () => {
  it('removes the generator entirely', () => {
    expect('rng' in publicState).toBe(false);
    expect(collectKeys(serialised).has('rng')).toBe(false);
    expect(collectKeys(serialised).has('seed')).toBe(false);
  });

  it('carries the seed nowhere in the serialised payload, under any key', () => {
    const numbers: number[] = [];
    const walk = (value: unknown): void => {
      if (typeof value === 'number') numbers.push(value);
      else if (Array.isArray(value)) value.forEach(walk);
      else if (typeof value === 'object' && value !== null) Object.values(value).forEach(walk);
    };
    walk(serialised);
    expect(numbers).not.toContain(state.rng.seed);
  });

  it('reduces each deck to a count', () => {
    expect(publicState.decks).toEqual({ chance: 16, chest: 16 });
  });

  it('reveals no card id from either deck', () => {
    const strings = collectStrings(serialised);
    const cardIds = [...pack.decks.chance, ...pack.decks.chest].map((card) => card.id);
    const leaked = cardIds.filter((id) => strings.has(id));
    expect(leaked).toEqual([]);
  });

  it('keeps everything a client legitimately needs', () => {
    expect(publicState.phase).toEqual(state.phase);
    expect(publicState.players).toEqual(state.players);
    expect(publicState.turnOrder).toEqual(state.turnOrder);
    expect(publicState.activeIndex).toBe(state.activeIndex);
    expect(publicState.deeds).toEqual(state.deeds);
    expect(publicState.bank).toEqual(state.bank);
    expect(publicState.pot).toBe(state.pot);
    expect(publicState.config).toEqual(state.config);
    expect(publicState.boardPackId).toBe(state.boardPackId);
    expect(publicState.turn).toEqual(state.turn);
    expect(publicState.openTrade).toBeNull();
    expect(publicState.version).toBe(1);
  });

  it('publishes exactly the expected set of top-level fields and no more', () => {
    // An allowlist rather than a check for known secrets: a field added to
    // GameState and forwarded without thought fails here, which is the point.
    expect(Object.keys(publicState).sort()).toEqual(
      [
        'activeIndex',
        'bank',
        'boardPackId',
        'config',
        'deeds',
        'decks',
        'openTrade',
        'phase',
        'players',
        'pot',
        'turn',
        'turnOrder',
        'version',
      ].sort(),
    );
  });

  it('does not mutate the state it projects', () => {
    const before = JSON.stringify(state);
    toPublicState(state);
    expect(JSON.stringify(state)).toBe(before);
  });

  it('counts down as cards leave the deck', () => {
    const drawn = buildState({ decks: { chance: ['chance-01', 'chance-02'], chest: [] } });
    expect(toPublicState(drawn).decks).toEqual({ chance: 2, chest: 0 });
  });
});
