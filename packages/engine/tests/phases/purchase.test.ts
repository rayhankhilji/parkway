import { describe, expect, it } from 'vitest';
import { getLegalActions } from '../../src/legalActions';
import { reduce } from '../../src/reduce';
import { expectOk } from '../../src/result';
import type { GameState } from '../../src/state/types';
import { buildState, type BuildStateOptions } from '../helpers/buildState';

/**
 * PRD F6 — buy or decline.
 *
 * The decision blocks the turn, so most of what matters here is what is *not*
 * possible while it is open.
 */

function deciding(squareId: number, options: BuildStateOptions = {}): GameState {
  return buildState({
    ...options,
    players: { ...options.players, ada: { position: squareId, ...options.players?.['ada'] } },
    phase: { kind: 'awaiting_purchase', squareId },
  });
}

function act(state: GameState, type: 'BUY_PROPERTY' | 'DECLINE_PURCHASE', playerId = 'ada') {
  return reduce(state, { type }, { playerId, now: 0 });
}

describe('the offer', () => {
  it('offers both choices to a player who can afford it', () => {
    const state = deciding(1);
    expect(getLegalActions(state, 'ada')).toEqual([
      { type: 'BUY_PROPERTY', squareId: 1, price: 60 },
      { type: 'DECLINE_PURCHASE', squareId: 1 },
    ]);
  });

  it('offers only the decline to a player who cannot', () => {
    // A button that exists only to be refused is worse than no button.
    const state = deciding(39, { players: { ada: { position: 39, cash: 100 } } });
    expect(getLegalActions(state, 'ada')).toEqual([{ type: 'DECLINE_PURCHASE', squareId: 39 }]);
  });

  it('offers nothing to the other players', () => {
    expect(getLegalActions(deciding(1), 'bo')).toEqual([]);
  });
});

describe('buying', () => {
  it('transfers the deed and takes the price', () => {
    const result = expectOk(act(deciding(1), 'BUY_PROPERTY'), 'buying should be legal');
    expect(result.state.deeds[1]?.ownerId).toBe('ada');
    expect(result.state.players['ada']?.cash).toBe(1440);
    expect(result.events[0]).toEqual({
      type: 'PROPERTY_PURCHASED',
      playerId: 'ada',
      squareId: 1,
      price: 60,
    });
  });

  it('ends the turn when the roll was not a double', () => {
    const result = expectOk(act(deciding(1), 'BUY_PROPERTY'), 'buying should be legal');
    expect(result.state.phase.kind).toBe('awaiting_end_turn');
  });

  /** PRD F4 — the extra roll survives the obligation that interrupted the turn. */
  it('hands back the extra roll when the roll was a double', () => {
    const state = deciding(1, { turn: { doublesCount: 1, hasRolled: true, lastRoll: [3, 3] } });
    const result = expectOk(act(state, 'BUY_PROPERTY'), 'buying should be legal');
    expect(result.state.phase.kind).toBe('awaiting_roll');
  });

  it('pays the bank, not the pot, even when the pot variant is on', () => {
    // Property purchases are not fines. Only money owed to the bank as a penalty
    // feeds the pot.
    const state = deciding(1, { config: { freeParkingPot: true } });
    const result = expectOk(act(state, 'BUY_PROPERTY'), 'buying should be legal');
    expect(result.state.pot).toBe(60);
  });

  it('refuses a purchase the player cannot afford, and says why', () => {
    // The button is never offered, but a client that asks anyway deserves the
    // real reason rather than a vague "wrong phase".
    const state = deciding(39, { players: { ada: { position: 39, cash: 100 } } });
    const result = act(state, 'BUY_PROPERTY');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('INSUFFICIENT_FUNDS');
  });

  it('refuses a purchase from a player whose turn it is not', () => {
    const result = act(deciding(1), 'BUY_PROPERTY', 'bo');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('NOT_YOUR_TURN');
  });

  it('refuses a square somebody already owns', () => {
    const state = deciding(1, { deeds: { 1: { ownerId: 'bo' } } });
    const result = act(state, 'BUY_PROPERTY');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('SQUARE_ALREADY_OWNED');
  });

  it('buys a station and a utility the same way', () => {
    for (const [squareId, price] of [
      [5, 200],
      [12, 150],
    ] as const) {
      const result = expectOk(act(deciding(squareId), 'BUY_PROPERTY'), 'buying should be legal');
      expect(result.state.deeds[squareId]?.ownerId).toBe('ada');
      expect(result.state.players['ada']?.cash).toBe(1500 - price);
    }
  });
});

describe('declining', () => {
  it('leaves the square unowned and moves the turn on', () => {
    const result = expectOk(act(deciding(1), 'DECLINE_PURCHASE'), 'declining should be legal');
    expect(result.state.deeds[1]?.ownerId).toBeNull();
    expect(result.state.phase.kind).toBe('awaiting_end_turn');
    expect(result.events[0]).toEqual({
      type: 'PURCHASE_DECLINED',
      playerId: 'ada',
      squareId: 1,
    });
  });

  it('hands back the extra roll when the roll was a double', () => {
    const state = deciding(1, { turn: { doublesCount: 2, hasRolled: true, lastRoll: [4, 4] } });
    const result = expectOk(act(state, 'DECLINE_PURCHASE'), 'declining should be legal');
    expect(result.state.phase.kind).toBe('awaiting_roll');
  });

  it('takes no money', () => {
    const result = expectOk(act(deciding(39), 'DECLINE_PURCHASE'), 'declining should be legal');
    expect(result.state.players['ada']?.cash).toBe(1500);
  });
});

describe('while the decision is open', () => {
  it('refuses another roll', () => {
    const result = reduce(deciding(1), { type: 'ROLL_DICE' }, { playerId: 'ada', now: 0 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('WRONG_PHASE');
  });

  it('refuses to end the turn', () => {
    const result = reduce(deciding(1), { type: 'END_TURN' }, { playerId: 'ada', now: 0 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('WRONG_PHASE');
  });

  it('refuses to buy once the phase has moved on', () => {
    const bought = expectOk(act(deciding(1), 'BUY_PROPERTY'), 'buying should be legal').state;
    const again = act(bought, 'BUY_PROPERTY');
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error.code).toBe('WRONG_PHASE');
  });
});
