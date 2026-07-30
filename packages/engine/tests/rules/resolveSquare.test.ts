import { describe, expect, it } from 'vitest';
import { getBoardPack } from '../../src/board/registry';
import { resolveSquare, taxDue } from '../../src/rules/resolveSquare';
import type { GameState } from '../../src/state/types';
import { buildState, ownGroup, type BuildStateOptions } from '../helpers/buildState';

const pack = getBoardPack('parkway-classic');

/**
 * PRD F5 — every square type resolves, with no unhandled kind.
 *
 * Resolution is called directly here rather than through a roll, so each square
 * can be exercised on its own rather than waiting for the dice to land there.
 */

function standingOn(squareId: number, options: BuildStateOptions = {}): GameState {
  return buildState({
    ...options,
    players: { ...options.players, ada: { position: squareId, ...options.players?.['ada'] } },
  });
}

function resolve(state: GameState, causingRoll: [number, number] | null = [3, 4]) {
  return resolveSquare(state, 'ada', { causingRoll, depth: 0, viaCard: false, now: 0 });
}

describe('every square kind resolves', () => {
  it('covers all nine kinds without an unhandled case', () => {
    const kinds = new Set(pack.squares.map((square) => square.kind));
    const seen: string[] = [];

    for (const kind of kinds) {
      const square = pack.squares.find((candidate) => candidate.kind === kind);
      if (square === undefined) continue;
      // Every kind must return a landing rather than throwing on an unknown kind.
      expect(() => resolve(standingOn(square.id))).not.toThrow();
      seen.push(kind);
    }

    expect(seen.sort()).toEqual(
      [
        'card',
        'free_parking',
        'go_to_jail',
        'jail',
        'property',
        'start',
        'tax',
        'transit',
        'utility',
      ].sort(),
    );
  });
});

describe('inert squares', () => {
  it('does nothing on the start square', () => {
    const landing = resolve(standingOn(0));
    expect(landing.halted).toBe(false);
    expect(landing.events).toEqual([]);
  });

  it('does nothing on the gaol square when only visiting', () => {
    const landing = resolve(standingOn(pack.jail.squareId));
    expect(landing.halted).toBe(false);
    expect(landing.state.players['ada']?.inJail).toBe(false);
  });

  it('does nothing on free parking when the pot variant is off', () => {
    const landing = resolve(standingOn(20, { pot: 500 }));
    expect(landing.events).toEqual([]);
    expect(landing.state.players['ada']?.cash).toBe(1500);
  });

  it('hands over the pot on free parking when the variant is on', () => {
    const landing = resolve(standingOn(20, { pot: 500, config: { freeParkingPot: true } }));
    expect(landing.state.players['ada']?.cash).toBe(2000);
    expect(landing.state.pot).toBe(0);
    expect(landing.events).toEqual([{ type: 'POT_COLLECTED', playerId: 'ada', amount: 500 }]);
  });
});

describe('the go-to-gaol square', () => {
  it('jails the player and halts the turn', () => {
    const landing = resolve(standingOn(pack.goToJailSquareId));
    expect(landing.halted).toBe(true);
    expect(landing.state.players['ada']?.inJail).toBe(true);
    expect(landing.state.players['ada']?.position).toBe(pack.jail.squareId);
  });
});

describe('tax', () => {
  it('charges the flat amount by default', () => {
    const landing = resolve(standingOn(4));
    expect(landing.state.players['ada']?.cash).toBe(1300);
    expect(landing.events[0]).toEqual({
      type: 'TAX_PAID',
      playerId: 'ada',
      squareId: 4,
      amount: 200,
    });
  });

  it('charges a percentage of total worth when configured', () => {
    const state = standingOn(4, {
      config: { incomeTaxMode: 'percentage' },
      players: { ada: { position: 4, cash: 1000 } },
      deeds: { 1: { ownerId: 'ada' } },
    });
    // 1000 in cash plus a lot printed at 60 is 1060; ten percent is 106.
    expect(taxDue(state, 'ada', 200, 0.1)).toBe(106);
    expect(resolve(state).state.players['ada']?.cash).toBe(894);
  });

  it('ignores the percentage mode on a square that has no percentage rate', () => {
    // Excise duty is always flat, whatever the income tax setting says.
    const state = standingOn(38, { config: { incomeTaxMode: 'percentage' } });
    expect(resolve(state).state.players['ada']?.cash).toBe(1400);
  });

  it('parks the player in debt when they cannot cover the bill', () => {
    const landing = resolve(standingOn(4, { players: { ada: { position: 4, cash: 10 } } }));
    expect(landing.halted).toBe(true);
    expect(landing.state.phase.kind).toBe('awaiting_debt');
    // The money has not moved: the debt is owed, not part-paid.
    expect(landing.state.players['ada']?.cash).toBe(10);
  });
});

describe('ownable squares', () => {
  it('offers a purchase on an unowned square', () => {
    const landing = resolve(standingOn(1));
    expect(landing.halted).toBe(true);
    expect(landing.state.phase).toEqual({ kind: 'awaiting_purchase', squareId: 1 });
  });

  it('charges rent to a visitor', () => {
    const landing = resolve(standingOn(1, { deeds: { 1: { ownerId: 'bo' } } }));
    expect(landing.halted).toBe(false);
    expect(landing.state.players['ada']?.cash).toBe(1498);
    expect(landing.state.players['bo']?.cash).toBe(1502);
    expect(landing.events[0]).toEqual({
      type: 'RENT_PAID',
      from: 'ada',
      to: 'bo',
      amount: 2,
      squareId: 1,
    });
  });

  it('charges nothing on a square the lander owns', () => {
    const landing = resolve(standingOn(1, { deeds: { 1: { ownerId: 'ada' } } }));
    expect(landing.events).toEqual([]);
    expect(landing.state.players['ada']?.cash).toBe(1500);
  });

  it('charges nothing on a mortgaged square', () => {
    const landing = resolve(standingOn(1, { deeds: { 1: { ownerId: 'bo', mortgaged: true } } }));
    expect(landing.events).toEqual([]);
    expect(landing.state.players['bo']?.cash).toBe(1500);
  });

  it('parks the visitor in debt when the rent is beyond them', () => {
    const landing = resolve(
      standingOn(39, {
        players: { ada: { position: 39, cash: 10 } },
        deeds: ownGroup('group-8', 'bo', { hotels: 1 }),
      }),
    );
    expect(landing.halted).toBe(true);
    expect(landing.state.phase).toMatchObject({
      kind: 'awaiting_debt',
      debtorId: 'ada',
      creditorId: 'bo',
      amount: 2000,
    });
  });
});
