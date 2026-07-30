import { describe, expect, it } from 'vitest';
import { getBoardPack } from '../../src/board/registry';
import { getLegalActions } from '../../src/legalActions';
import { reduce } from '../../src/reduce';
import { expectOk } from '../../src/result';
import type { GameState } from '../../src/state/types';
import { buildState, type BuildStateOptions } from '../helpers/buildState';
import { declineAnyPurchase } from '../helpers/play';

const pack = getBoardPack('parkway-classic');

function jailed(options: BuildStateOptions = {}): GameState {
  return buildState({
    ...options,
    players: {
      ...options.players,
      ada: {
        inJail: true,
        position: pack.jail.squareId,
        ...options.players?.['ada'],
      },
    },
    phase: { kind: 'awaiting_jail_decision' },
  });
}

function rollForJail(state: GameState) {
  return expectOk(
    reduce(state, { type: 'ROLL_FOR_JAIL' }, { playerId: 'ada', now: 0 }),
    'rolling for the gaol should be legal',
  );
}

/** A seed whose next roll from the gaol is, or is not, a double. */
function jailSeed(wantDouble: boolean): number {
  for (let seed = 1; seed < 200_000; seed += 1) {
    const result = reduce(jailed({ seed }), { type: 'ROLL_FOR_JAIL' }, { playerId: 'ada', now: 0 });
    if (!result.ok) continue;
    const event = result.value.events.find((candidate) => candidate.type === 'DICE_ROLLED');
    if (event?.type === 'DICE_ROLLED' && (event.dice[0] === event.dice[1]) === wantDouble) {
      return seed;
    }
  }
  throw new Error('No seed found');
}

const doubleSeed = jailSeed(true);
const failSeed = jailSeed(false);

/**
 * A seed whose next three rolls from the gaol all fail, so a whole sentence can
 * be served without the player being freed halfway through by a lucky double.
 */
function seedFailingThreeTimes(): number {
  for (let seed = 1; seed < 200_000; seed += 1) {
    let state = jailed({ seed, players: { ada: { cash: 500 } } });
    let failures = 0;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const result = reduce(state, { type: 'ROLL_FOR_JAIL' }, { playerId: 'ada', now: 0 });
      if (!result.ok) break;
      const event = result.value.events.find((candidate) => candidate.type === 'DICE_ROLLED');
      if (event?.type !== 'DICE_ROLLED' || event.dice[0] === event.dice[1]) break;
      failures += 1;
      state = { ...result.value.state, phase: { kind: 'awaiting_jail_decision' } };
    }
    if (failures === 3) return seed;
  }
  throw new Error('No seed found failing three jail rolls');
}

const threeFailuresSeed = seedFailingThreeTimes();

describe('rolling for release', () => {
  /** PRD F9 — doubles release the player and move them, with no extra roll. */
  it('releases on a double and moves the rolled total', () => {
    const state = jailed({ seed: doubleSeed });
    const result = rollForJail(state);
    const roll = result.state.turn.lastRoll ?? [0, 0];
    const player = result.state.players['ada'];

    expect(player?.inJail).toBe(false);
    expect(player?.jailAttempts).toBe(0);
    expect(player?.position).toBe(pack.jail.squareId + roll[0] + roll[1]);
    expect(result.events.some((event) => event.type === 'LEFT_JAIL')).toBe(true);
  });

  it('grants no extra roll for the double that freed them', () => {
    const result = rollForJail(jailed({ seed: doubleSeed }));
    // The turn may pause on whatever they landed on, so the assertion is about
    // the rule — no further roll is owed — rather than the exact phase.
    expect(result.state.turn.doublesCount).toBe(0);
    expect(result.state.phase.kind).not.toBe('awaiting_roll');
    expect(declineAnyPurchase(result.state).phase.kind).toBe('awaiting_end_turn');
  });

  it('counts a failed attempt and ends the turn', () => {
    const result = rollForJail(jailed({ seed: failSeed }));
    const player = result.state.players['ada'];

    expect(player?.inJail).toBe(true);
    expect(player?.position).toBe(pack.jail.squareId);
    expect(player?.jailAttempts).toBe(1);
    expect(result.state.phase.kind).toBe('awaiting_end_turn');
    expect(result.events.some((event) => event.type === 'JAIL_ATTEMPT_FAILED')).toBe(true);
  });

  it('refuses a jail roll from a player who is not in the gaol', () => {
    const state = buildState({ phase: { kind: 'awaiting_jail_decision' } });
    const result = reduce(state, { type: 'ROLL_FOR_JAIL' }, { playerId: 'ada', now: 0 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('NOT_IN_JAIL');
  });

  it('refuses a normal roll while in the gaol', () => {
    const result = reduce(jailed(), { type: 'ROLL_DICE' }, { playerId: 'ada', now: 0 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('WRONG_PHASE');
  });
});

describe('the final attempt', () => {
  /** PRD F9 — on the third failed attempt the fine is deducted and they move. */
  it('deducts the fine and moves the player on the failing roll', () => {
    const state = jailed({
      seed: failSeed,
      players: { ada: { jailAttempts: pack.jail.maxTurns - 1, cash: 500 } },
    });
    const result = rollForJail(state);
    const roll = result.state.turn.lastRoll ?? [0, 0];
    const player = result.state.players['ada'];

    expect(player?.inJail).toBe(false);
    expect(player?.cash).toBe(500 - pack.jail.fine);
    expect(player?.position).toBe(pack.jail.squareId + roll[0] + roll[1]);
    expect(result.state.turn.doublesCount).toBe(0);
    expect(result.state.phase.kind).not.toBe('awaiting_roll');
  });

  it('reports the release as forced rather than chosen', () => {
    const state = jailed({
      seed: failSeed,
      players: { ada: { jailAttempts: pack.jail.maxTurns - 1, cash: 500 } },
    });
    const released = rollForJail(state).events.find((event) => event.type === 'LEFT_JAIL');
    expect(released).toEqual({ type: 'LEFT_JAIL', playerId: 'ada', method: 'forced_fine' });
  });

  it('holds the player in the gaol when they cannot afford the fine', () => {
    const state = jailed({
      seed: failSeed,
      players: { ada: { jailAttempts: pack.jail.maxTurns - 1, cash: 10 } },
    });
    const result = rollForJail(state);

    expect(result.state.phase).toEqual({
      kind: 'awaiting_debt',
      debtorId: 'ada',
      creditorId: null,
      amount: pack.jail.fine,
      interrupted: { kind: 'awaiting_end_turn' },
      remaining: [],
    });
    // The fine is owed, not taken: cash is untouched and they have not moved.
    expect(result.state.players['ada']?.cash).toBe(10);
    expect(result.state.players['ada']?.inJail).toBe(true);
    expect(result.state.players['ada']?.position).toBe(pack.jail.squareId);
  });

  it('pays the fine into the pot when that variant is on', () => {
    const state = jailed({
      seed: failSeed,
      config: { freeParkingPot: true },
      players: { ada: { jailAttempts: pack.jail.maxTurns - 1, cash: 500 } },
    });
    expect(rollForJail(state).state.pot).toBe(pack.jail.fine);
  });

  it('sends the fine nowhere when the pot variant is off', () => {
    const state = jailed({
      seed: failSeed,
      players: { ada: { jailAttempts: pack.jail.maxTurns - 1, cash: 500 } },
    });
    expect(rollForJail(state).state.pot).toBe(0);
  });
});

describe('a full sentence', () => {
  it('takes three failed attempts to force the fine', () => {
    let state = jailed({ seed: threeFailuresSeed, players: { ada: { cash: 500 } } });
    const attempts: number[] = [];

    for (let turn = 0; turn < pack.jail.maxTurns; turn += 1) {
      const result = rollForJail(state);
      attempts.push(result.state.players['ada']?.jailAttempts ?? -1);
      state = result.state;
      if (!state.players['ada']?.inJail) break;
      // Hand the turn round and back so the player is in the gaol again.
      state = { ...state, phase: { kind: 'awaiting_jail_decision' } };
    }

    // The first two attempts leave them inside; the third is the last.
    expect(attempts.slice(0, 2)).toEqual([1, 2]);
    expect(state.players['ada']?.inJail).toBe(false);
    expect(state.players['ada']?.cash).toBe(500 - pack.jail.fine);
  });
});

describe('paying the fine', () => {
  /** PRD F9 — a jailed player may pay and then roll as normal. */
  it('releases the player and hands them a normal roll', () => {
    const result = expectOk(
      reduce(jailed(), { type: 'PAY_JAIL_FINE' }, { playerId: 'ada', now: 0 }),
      'paying the fine should be legal',
    );

    expect(result.state.players['ada']?.inJail).toBe(false);
    expect(result.state.players['ada']?.cash).toBe(1500 - pack.jail.fine);
    // Not a roll, but the thing you do before one.
    expect(result.state.phase.kind).toBe('awaiting_roll');
    expect(result.events).toEqual([{ type: 'LEFT_JAIL', playerId: 'ada', method: 'fine' }]);
  });

  it('leaves the player on the gaol square until they roll', () => {
    const result = expectOk(
      reduce(jailed(), { type: 'PAY_JAIL_FINE' }, { playerId: 'ada', now: 0 }),
      'paying the fine should be legal',
    );
    expect(result.state.players['ada']?.position).toBe(pack.jail.squareId);
  });

  it('refuses the fine when they cannot afford it, and is not offered', () => {
    const state = jailed({ players: { ada: { cash: 10 } } });
    const result = reduce(state, { type: 'PAY_JAIL_FINE' }, { playerId: 'ada', now: 0 });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('INSUFFICIENT_FUNDS');
    expect(getLegalActions(state, 'ada').map((action) => action.type)).toEqual(['ROLL_FOR_JAIL']);
  });

  it('feeds the pot when that variant is on', () => {
    const state = jailed({ config: { freeParkingPot: true } });
    const result = expectOk(
      reduce(state, { type: 'PAY_JAIL_FINE' }, { playerId: 'ada', now: 0 }),
      'paying the fine should be legal',
    );
    expect(result.state.pot).toBe(pack.jail.fine);
  });

  it('refuses the fine from a player who is not in the gaol', () => {
    const result = reduce(buildState(), { type: 'PAY_JAIL_FINE' }, { playerId: 'ada', now: 0 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('WRONG_PHASE');
  });
});

describe('using a release card', () => {
  it('releases the player without charging them', () => {
    const state = jailed({ players: { ada: { heldJailCards: ['chance'] } } });
    const result = expectOk(
      reduce(state, { type: 'USE_JAIL_CARD' }, { playerId: 'ada', now: 0 }),
      'using the card should be legal',
    );

    expect(result.state.players['ada']?.inJail).toBe(false);
    expect(result.state.players['ada']?.cash).toBe(1500);
    expect(result.state.players['ada']?.heldJailCards).toEqual([]);
    expect(result.state.phase.kind).toBe('awaiting_roll');
    expect(result.events).toEqual([{ type: 'LEFT_JAIL', playerId: 'ada', method: 'card' }]);
  });

  /** PRD F10 — a spent card returns to the bottom of its own deck. */
  it('returns the card to the bottom of the deck it came from', () => {
    const releaseId = 'chance-08';
    const state = jailed({
      players: { ada: { heldJailCards: ['chance'] } },
      decks: { chance: ['chance-01', 'chance-02'] },
    });
    const result = expectOk(
      reduce(state, { type: 'USE_JAIL_CARD' }, { playerId: 'ada', now: 0 }),
      'using the card should be legal',
    );

    const order = result.state.decks.chance.order;
    expect(order[order.length - 1]).toBe(releaseId);
    expect(result.state.decks.chest.order).toEqual(pack.decks.chest.map((card) => card.id));
  });

  it('spends the right deck when the player holds a civic card', () => {
    const state = jailed({
      players: { ada: { heldJailCards: ['chest'] } },
      decks: { chest: ['chest-01', 'chest-05'] },
    });
    const result = expectOk(
      reduce(state, { type: 'USE_JAIL_CARD' }, { playerId: 'ada', now: 0 }),
      'using the card should be legal',
    );
    // chest-05 was removed on build because Ada holds it, and goes to the bottom.
    expect(result.state.decks.chest.order).toEqual(['chest-01', 'chest-05']);
  });

  it('spends one card and keeps the other when the player holds both', () => {
    const state = jailed({ players: { ada: { heldJailCards: ['chance', 'chest'] } } });
    const result = expectOk(
      reduce(state, { type: 'USE_JAIL_CARD' }, { playerId: 'ada', now: 0 }),
      'using the card should be legal',
    );
    expect(result.state.players['ada']?.heldJailCards).toEqual(['chest']);
  });

  it('refuses when the player holds no card, and is not offered', () => {
    const state = jailed();
    const result = reduce(state, { type: 'USE_JAIL_CARD' }, { playerId: 'ada', now: 0 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('NO_JAIL_CARD');
    expect(getLegalActions(state, 'ada').map((action) => action.type)).not.toContain(
      'USE_JAIL_CARD',
    );
  });

  it('is offered ahead of the fine, since it costs nothing', () => {
    const state = jailed({ players: { ada: { heldJailCards: ['chance'] } } });
    expect(getLegalActions(state, 'ada').map((action) => action.type)).toEqual([
      'USE_JAIL_CARD',
      'PAY_JAIL_FINE',
      'ROLL_FOR_JAIL',
    ]);
  });
});
