import { describe, expect, it } from 'vitest';
import { getBoardPack } from '@parkway/engine';
import { landingOdds } from '../src/landing';

const pack = getBoardPack('parkway-classic');
const odds = landingOdds(pack).bySquare;

const at = (id: number): number => odds[id] ?? 0;
const name = (id: number): string => pack.squares[id]?.name ?? '?';

/**
 * The analysis is only worth having if it reproduces the things that are known
 * about this board. These assertions are the check that it does — not that the
 * numbers match some published table exactly, but that the shape is right.
 */
describe('landing odds', () => {
  it('is a probability distribution', () => {
    const total = odds.reduce((sum, value) => sum + value, 0);
    expect(total).toBeCloseTo(1, 6);
    expect(odds).toHaveLength(pack.squares.length);
    expect(odds.every((value) => value >= 0)).toBe(true);
  });

  it('makes the gaol the most visited square on the board', () => {
    // Everything feeds it: the go-to-gaol square, two cards, and three doubles.
    const ranked = odds.map((value, id) => ({ id, value })).sort((a, b) => b.value - a.value);
    expect(ranked[0]?.id).toBe(pack.jail.squareId);
  });

  it('never lands anyone on the go-to-gaol square', () => {
    // A token that arrives there does not stay there.
    expect(at(pack.goToJailSquareId)).toBe(0);
  });

  it('favours the two groups just past the gaol', () => {
    // The reason orange and red are the strongest buys: a token leaving the most
    // visited square on the board reaches them on a common roll.
    const foundry = averageOf('group-4');
    const oldMarket = averageOf('group-5');
    const tanneries = averageOf('group-1');
    const close = averageOf('group-8');

    expect(foundry).toBeGreaterThan(tanneries);
    expect(foundry).toBeGreaterThan(close);
    expect(oldMarket).toBeGreaterThan(tanneries);
  });

  it('ranks the strongest lot ahead of the most expensive one', () => {
    // Ashvale Crescent is the priciest lot on the board and is landed on less
    // often than the orange group — which is exactly why price is a poor guide.
    const bestOrange = Math.max(...groupIds('group-4').map(at));
    expect(bestOrange).toBeGreaterThan(at(39));
  });

  it('gives every ordinary square some share', () => {
    const unreachable = pack.squares
      .filter((square) => square.kind !== 'go_to_jail' && at(square.id) <= 0)
      .map((square) => `${square.id} ${square.name}`);
    expect(unreachable).toEqual([]);
  });

  it('is stable: running it again gives the same numbers', () => {
    expect(landingOdds(pack).bySquare).toEqual(odds);
  });

  it('reports something sensible for the squares people talk about', () => {
    // A readable summary, so a reviewer can sanity-check the model at a glance.
    const top = odds
      .map((value, id) => ({ id, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 3)
      .map((entry) => name(entry.id));
    expect(top).toContain('Ashvale Gaol');
  });
});

function groupIds(groupId: string): readonly number[] {
  return pack.groups.find((group) => group.id === groupId)?.memberIds ?? [];
}

function averageOf(groupId: string): number {
  const ids = groupIds(groupId);
  return ids.reduce((sum, id) => sum + at(id), 0) / ids.length;
}
