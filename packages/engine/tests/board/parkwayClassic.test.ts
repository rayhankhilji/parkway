import { describe, expect, it } from 'vitest';
import { findNextSquareOfKind, getGroup, getSquare, isOwnable } from '../../src/board/lookup';
import { getBoardPack } from '../../src/board/registry';
import type { Square } from '../../src/board/types';

/**
 * The board is data, which means its failure mode is a typo rather than a bug —
 * a rent table one entry short, a group listing a square that belongs to another
 * group, a mortgage value that is not half the price. None of that would throw;
 * it would just make the game quietly wrong. These assertions are the proofread.
 */

const pack = getBoardPack('parkway-classic');

const properties = pack.squares.filter(
  (square): square is Extract<Square, { kind: 'property' }> => square.kind === 'property',
);

describe('the board', () => {
  it('has forty squares', () => {
    expect(pack.squares).toHaveLength(40);
  });

  it('gives every square an id equal to its position', () => {
    pack.squares.forEach((square, index) => {
      expect(square.id).toBe(index);
    });
  });

  it('names every square', () => {
    for (const square of pack.squares) {
      expect(square.name.length).toBeGreaterThan(0);
    }
  });

  it('has exactly one start, one gaol, one free parking and one go-to-gaol', () => {
    const count = (kind: Square['kind']): number =>
      pack.squares.filter((square) => square.kind === kind).length;
    expect(count('start')).toBe(1);
    expect(count('jail')).toBe(1);
    expect(count('free_parking')).toBe(1);
    expect(count('go_to_jail')).toBe(1);
  });

  it('has four stations, two utilities and twenty-two lots', () => {
    const count = (kind: Square['kind']): number =>
      pack.squares.filter((square) => square.kind === kind).length;
    expect(count('transit')).toBe(4);
    expect(count('utility')).toBe(2);
    expect(count('property')).toBe(22);
  });

  it('points its corner references at squares of the matching kind', () => {
    expect(getSquare(pack, pack.startSquareId).kind).toBe('start');
    expect(getSquare(pack, pack.jail.squareId).kind).toBe('jail');
    expect(getSquare(pack, pack.goToJailSquareId).kind).toBe('go_to_jail');
  });
});

describe('lots', () => {
  it('gives every lot a six-entry rent table rising with development', () => {
    for (const lot of properties) {
      expect(lot.rent).toHaveLength(6);
      for (let level = 1; level < lot.rent.length; level += 1) {
        const previous = lot.rent[level - 1] ?? 0;
        const current = lot.rent[level] ?? 0;
        expect(current).toBeGreaterThan(previous);
      }
    }
  });

  it('mortgages every ownable square at half its price', () => {
    for (const square of pack.squares.filter(isOwnable)) {
      expect(square.mortgageValue).toBe(square.price / 2);
    }
  });

  it('uses only whole currency units', () => {
    for (const square of pack.squares.filter(isOwnable)) {
      expect(Number.isInteger(square.price)).toBe(true);
      expect(Number.isInteger(square.mortgageValue)).toBe(true);
    }
    for (const lot of properties) {
      expect(Number.isInteger(lot.buildCost)).toBe(true);
      for (const rent of lot.rent) {
        expect(Number.isInteger(rent)).toBe(true);
      }
    }
  });

  it('charges one build cost across a whole group', () => {
    for (const group of pack.groups) {
      const costs = new Set(
        group.memberIds.map((id) => {
          const square = getSquare(pack, id);
          if (square.kind !== 'property') throw new Error(`${id} is not a lot`);
          return square.buildCost;
        }),
      );
      expect(costs.size).toBe(1);
    }
  });
});

describe('groups', () => {
  it('assigns every lot to a declared group', () => {
    for (const lot of properties) {
      expect(() => getGroup(pack, lot.group)).not.toThrow();
    }
  });

  it('lists exactly the lots that claim each group, and no others', () => {
    for (const group of pack.groups) {
      const claiming = properties.filter((lot) => lot.group === group.id).map((lot) => lot.id);
      expect([...group.memberIds].sort((a, b) => a - b)).toEqual(claiming.sort((a, b) => a - b));
    }
  });

  it('covers all twenty-two lots across eight groups with no overlap', () => {
    const members = pack.groups.flatMap((group) => [...group.memberIds]);
    expect(pack.groups).toHaveLength(8);
    expect(new Set(members).size).toBe(members.length);
    expect(members).toHaveLength(22);
  });

  it('gives each group a distinct colour token', () => {
    const tokens = pack.groups.map((group) => group.colourToken);
    expect(new Set(tokens).size).toBe(tokens.length);
  });
});

describe('decks', () => {
  const allCards = [...pack.decks.chance, ...pack.decks.chest];

  it('holds sixteen cards in each deck', () => {
    expect(pack.decks.chance).toHaveLength(16);
    expect(pack.decks.chest).toHaveLength(16);
  });

  it('gives every card a unique id', () => {
    const ids = allCards.map((card) => card.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('tags every card with the deck it is filed under', () => {
    for (const card of pack.decks.chance) expect(card.deck).toBe('chance');
    for (const card of pack.decks.chest) expect(card.deck).toBe('chest');
  });

  it('writes text for every card', () => {
    for (const card of allCards) {
      expect(card.text.length).toBeGreaterThan(0);
    }
  });

  it('points every movement effect at a square on this board', () => {
    for (const card of allCards) {
      const effect = card.effect;
      if (effect.kind === 'move_to') {
        expect(() => getSquare(pack, effect.squareId)).not.toThrow();
      }
    }
  });

  it('carries exactly one release card in each deck', () => {
    const releases = (deck: typeof allCards): number =>
      deck.filter((card) => card.effect.kind === 'get_out_of_jail').length;
    expect(releases([...pack.decks.chance])).toBe(1);
    expect(releases([...pack.decks.chest])).toBe(1);
  });

  it('uses only whole currency amounts', () => {
    for (const card of allCards) {
      const effect = card.effect;
      if ('amount' in effect) expect(Number.isInteger(effect.amount)).toBe(true);
      if (effect.kind === 'repairs') {
        expect(Number.isInteger(effect.perHouse)).toBe(true);
        expect(Number.isInteger(effect.perHotel)).toBe(true);
      }
    }
  });
});

describe('bank and supply', () => {
  it('stocks thirty-two houses and twelve hotels', () => {
    expect(pack.bank).toEqual({ houses: 32, hotels: 12 });
  });

  it('returns four houses per hotel', () => {
    expect(pack.housesPerHotel).toBe(4);
  });

  it('rolls two six-sided dice', () => {
    expect(pack.dice).toEqual({ count: 2, faces: 6 });
  });
});

describe('rent ladders', () => {
  it('gives stations one rent per station on the board', () => {
    expect(pack.transit.rentByCount).toHaveLength(4);
  });

  it('gives utilities one multiplier per utility on the board', () => {
    expect(pack.utility.multiplierByCount).toHaveLength(2);
  });

  it('rises with each additional station held', () => {
    const rents = pack.transit.rentByCount;
    for (let index = 1; index < rents.length; index += 1) {
      expect(rents[index] ?? 0).toBeGreaterThan(rents[index - 1] ?? 0);
    }
  });
});

describe('findNextSquareOfKind', () => {
  it('finds the next station going forward', () => {
    expect(findNextSquareOfKind(pack, 7, 'transit')).toBe(15);
    expect(findNextSquareOfKind(pack, 22, 'transit')).toBe(25);
  });

  it('wraps past the end of the board', () => {
    expect(findNextSquareOfKind(pack, 36, 'transit')).toBe(5);
  });

  it('skips the square it starts on', () => {
    expect(findNextSquareOfKind(pack, 5, 'transit')).toBe(15);
  });

  it('finds the next utility going forward, wrapping', () => {
    expect(findNextSquareOfKind(pack, 7, 'utility')).toBe(12);
    expect(findNextSquareOfKind(pack, 22, 'utility')).toBe(28);
    expect(findNextSquareOfKind(pack, 36, 'utility')).toBe(12);
  });

  it('throws when the board has no such square', () => {
    expect(() => findNextSquareOfKind(pack, 0, 'lodging' as Square['kind'])).toThrow('no square');
  });
});

describe('the registry', () => {
  it('throws on an unknown pack rather than falling back to a default', () => {
    expect(() => getBoardPack('does-not-exist')).toThrow('Unknown board pack');
  });
});
