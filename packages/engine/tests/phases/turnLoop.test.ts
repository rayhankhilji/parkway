import { describe, expect, it } from 'vitest';
import { getBoardPack } from '../../src/board/registry';
import { getLegalActions } from '../../src/legalActions';
import { reduce } from '../../src/reduce';
import { expectOk } from '../../src/result';
import type { GameEvent } from '../../src/events/types';
import type { GameState } from '../../src/state/types';
import { buildState } from '../helpers/buildState';
import { play, playForward, ScriptFailure, step } from '../helpers/play';

const pack = getBoardPack('parkway-classic');

/**
 * A generator seed produces a fixed sequence of dice, which makes "roll a
 * double" hard to ask for directly. Rather than searching for magic seeds in
 * every test, these helpers find one once and say what they were looking for.
 */
function seedRolling(predicate: (a: number, b: number) => boolean, from = 1): number {
  for (let seed = from; seed < from + 100_000; seed += 1) {
    const state = buildState({ seed });
    const result = reduce(state, { type: 'ROLL_DICE' }, { playerId: 'ada', now: 0 });
    if (!result.ok) continue;
    const rolled = result.value.events.find((event) => event.type === 'DICE_ROLLED');
    if (rolled?.type === 'DICE_ROLLED' && predicate(rolled.dice[0], rolled.dice[1])) {
      return seed;
    }
  }
  throw new Error('No seed found matching that roll');
}

const doubleSeed = seedRolling((a, b) => a === b);
const plainSeed = seedRolling((a, b) => a !== b);

function diceOf(events: readonly GameEvent[]): readonly (readonly [number, number])[] {
  return events.flatMap((event) => (event.type === 'DICE_ROLLED' ? [event.dice] : []));
}

/**
 * A seed whose first three rolls are all doubles, so a turn can be driven all
 * the way to the third-double rule without any searching in the test itself.
 * One run in two hundred and sixteen qualifies, so this finds one quickly.
 */
function seedWithThreeDoubles(): number {
  for (let seed = 1; seed < 200_000; seed += 1) {
    let state: GameState = buildState({ seed });
    let doubles = 0;
    for (let roll = 0; roll < 3; roll += 1) {
      if (state.phase.kind !== 'awaiting_roll') break;
      const result = reduce(state, { type: 'ROLL_DICE' }, { playerId: 'ada', now: 0 });
      if (!result.ok) break;
      state = result.value.state;
      const event = result.value.events.find((candidate) => candidate.type === 'DICE_ROLLED');
      if (event?.type !== 'DICE_ROLLED' || event.dice[0] !== event.dice[1]) break;
      doubles += 1;
    }
    if (doubles === 3) return seed;
  }
  throw new Error('No seed found with three consecutive doubles');
}

const tripleDoubleSeed = seedWithThreeDoubles();

/** Rolls a turn out until the player is jailed or the turn ends. */
function rollOutTurn(state: GameState, playerId = 'ada'): GameState {
  let current = state;
  for (let guard = 0; guard < 20; guard += 1) {
    if (current.phase.kind !== 'awaiting_roll') return current;
    current = expectOk(
      reduce(current, { type: 'ROLL_DICE' }, { playerId, now: 0 }),
      'roll should be legal',
    ).state;
  }
  throw new Error('Turn never ended');
}

describe('rolling', () => {
  it('moves the token by the total and records the roll', () => {
    const state = buildState({ seed: plainSeed });
    const result = expectOk(
      reduce(state, { type: 'ROLL_DICE' }, { playerId: 'ada', now: 0 }),
      'roll should be legal',
    );
    const roll = result.state.turn.lastRoll;
    expect(roll).not.toBeNull();
    if (roll === null) return;
    expect(result.state.players['ada']?.position).toBe(roll[0] + roll[1]);
    expect(result.state.turn.hasRolled).toBe(true);
  });

  it('refuses a roll from a player whose turn it is not', () => {
    const state = buildState();
    const result = reduce(state, { type: 'ROLL_DICE' }, { playerId: 'bo', now: 0 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('NOT_YOUR_TURN');
  });

  it('refuses a second roll after a plain roll', () => {
    const state = buildState({ seed: plainSeed });
    const { state: rolled } = play(state, [step({ type: 'ROLL_DICE' })]);
    const result = reduce(rolled, { type: 'ROLL_DICE' }, { playerId: 'ada', now: 0 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('WRONG_PHASE');
  });

  it('refuses an action from someone who is not in the game', () => {
    const result = reduce(buildState(), { type: 'ROLL_DICE' }, { playerId: 'ghost', now: 0 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('PLAYER_NOT_IN_GAME');
  });

  it('pays salary for passing the start square', () => {
    // Placed so that any roll of two to twelve wraps the board.
    const state = buildState({ players: { ada: { position: 39, cash: 0 } }, seed: plainSeed });
    const { state: after, events } = play(state, [step({ type: 'ROLL_DICE' })]);
    expect(after.players['ada']?.cash).toBe(200);
    expect(events.some((event) => event.type === 'SALARY_PAID')).toBe(true);
  });

  it('pays no salary for a move that does not reach the start square', () => {
    const state = buildState({ players: { ada: { position: 1, cash: 0 } }, seed: plainSeed });
    const { state: after, events } = play(state, [step({ type: 'ROLL_DICE' })]);
    expect(after.players['ada']?.cash).toBe(0);
    expect(events.some((event) => event.type === 'SALARY_PAID')).toBe(false);
  });
});

describe('doubles', () => {
  /** PRD F4 — doubles grant exactly one extra roll each. */
  it('grants another roll after a double', () => {
    const state = buildState({ seed: doubleSeed });
    const { state: after } = play(state, [step({ type: 'ROLL_DICE' })]);
    expect(after.phase.kind).toBe('awaiting_roll');
    expect(after.turn.doublesCount).toBe(1);
    expect(getLegalActions(after, 'ada').map((action) => action.type)).toEqual(['ROLL_DICE']);
  });

  /** PRD F4 — a double then a non-double is two rolls and no more. */
  it('ends the turn after a double followed by a plain roll', () => {
    let state = buildState({ seed: doubleSeed });
    const first = expectOk(
      reduce(state, { type: 'ROLL_DICE' }, { playerId: 'ada', now: 0 }),
      'first roll',
    );
    state = first.state;
    expect(state.phase.kind).toBe('awaiting_roll');

    // Keep rolling until a plain roll turns up, then check the turn is over.
    let rolls = 1;
    while (state.phase.kind === 'awaiting_roll' && rolls < 20) {
      const next = expectOk(
        reduce(state, { type: 'ROLL_DICE' }, { playerId: 'ada', now: 0 }),
        'later roll',
      );
      state = next.state;
      rolls += 1;
      if (state.phase.kind !== 'awaiting_roll') break;
    }

    expect(state.phase.kind).toBe('awaiting_end_turn');
    expect(getLegalActions(state, 'ada').map((action) => action.type)).toEqual(['END_TURN']);
  });

  it('resets the doubles count when the turn ends', () => {
    const state = buildState({ seed: doubleSeed });
    const { state: after } = play(state, [
      step({ type: 'ROLL_DICE' }),
      ...Array.from({ length: 0 }, () => step({ type: 'ROLL_DICE' })),
    ]);
    expect(after.turn.doublesCount).toBe(1);
  });
});

describe('three doubles', () => {
  /**
   * PRD F4 — the third double jails the player with no movement and no
   * resolution of the roll. Implementations get this wrong by moving first and
   * jailing afterwards, which changes the game whenever the third roll would
   * have landed somewhere that mattered.
   */
  it('sends the player to the gaol without moving them', () => {
    const opening = buildState({ seed: tripleDoubleSeed });

    // Two doubles in, the player has moved twice and is still on the board.
    let state = expectOk(
      reduce(opening, { type: 'ROLL_DICE' }, { playerId: 'ada', now: 0 }),
      'first roll',
    ).state;
    state = expectOk(
      reduce(state, { type: 'ROLL_DICE' }, { playerId: 'ada', now: 0 }),
      'second roll',
    ).state;

    const positionBeforeThird = state.players['ada']?.position ?? -1;
    expect(state.turn.doublesCount).toBe(2);
    expect(state.players['ada']?.inJail).toBe(false);

    const third = expectOk(
      reduce(state, { type: 'ROLL_DICE' }, { playerId: 'ada', now: 0 }),
      'third roll',
    );
    const player = third.state.players['ada'];
    const roll = third.state.turn.lastRoll ?? [0, 0];

    expect(player?.inJail).toBe(true);
    expect(player?.position).toBe(pack.jail.squareId);
    // The decisive assertion: they are not where the third roll would have put
    // them, and no TOKEN_MOVED was emitted for it.
    expect(player?.position).not.toBe((positionBeforeThird + roll[0] + roll[1]) % 40);
    expect(third.events.some((event) => event.type === 'TOKEN_MOVED')).toBe(false);
    expect(third.state.phase.kind).toBe('awaiting_end_turn');
  });

  it('records the third roll even though it is discarded', () => {
    const opening = buildState({ seed: tripleDoubleSeed });
    const state = rollOutTurn(opening);
    expect(state.turn.lastRoll).not.toBeNull();
    expect(state.turn.doublesCount).toBe(3);
  });

  it('does not pay salary for the discarded third roll', () => {
    // Sitting one square short of the start, so any movement would collect.
    const opening = buildState({
      players: { ada: { position: 39, cash: 0 } },
      seed: tripleDoubleSeed,
    });

    let state = expectOk(
      reduce(opening, { type: 'ROLL_DICE' }, { playerId: 'ada', now: 0 }),
      'first roll',
    ).state;
    state = expectOk(
      reduce(state, { type: 'ROLL_DICE' }, { playerId: 'ada', now: 0 }),
      'second roll',
    ).state;

    const cashBeforeThird = state.players['ada']?.cash ?? 0;
    const third = expectOk(
      reduce(state, { type: 'ROLL_DICE' }, { playerId: 'ada', now: 0 }),
      'third roll',
    );

    expect(third.state.players['ada']?.inJail).toBe(true);
    expect(third.state.players['ada']?.cash).toBe(cashBeforeThird);
    expect(third.events.some((event) => event.type === 'SALARY_PAID')).toBe(false);
  });

  it('ends the turn, so the third double grants no further roll', () => {
    const state = rollOutTurn(buildState({ seed: tripleDoubleSeed }));
    expect(getLegalActions(state, 'ada').map((action) => action.type)).toEqual(['END_TURN']);
  });
});

describe('the go-to-gaol square', () => {
  it('jails a player who lands on it and ends their turn', () => {
    // Landing exactly on square 30 from 24 needs a roll of six; whichever roll
    // the seed gives, place the player so it lands there.
    const state = buildState({ seed: plainSeed });
    const probe = expectOk(
      reduce(state, { type: 'ROLL_DICE' }, { playerId: 'ada', now: 0 }),
      'probe roll',
    );
    const total =
      (probe.state.turn.lastRoll ?? [0, 0])[0] + (probe.state.turn.lastRoll ?? [0, 0])[1];

    const placed = buildState({
      players: { ada: { position: pack.goToJailSquareId - total } },
      seed: plainSeed,
    });
    const { state: after, events } = play(placed, [step({ type: 'ROLL_DICE' })]);

    expect(after.players['ada']?.inJail).toBe(true);
    expect(after.players['ada']?.position).toBe(pack.jail.squareId);
    expect(after.phase.kind).toBe('awaiting_end_turn');
    expect(events.some((event) => event.type === 'SENT_TO_JAIL')).toBe(true);
  });

  it('cancels the extra roll a double would have granted', () => {
    const doubleTotal = (() => {
      const probe = expectOk(
        reduce(
          buildState({ seed: doubleSeed }),
          { type: 'ROLL_DICE' },
          { playerId: 'ada', now: 0 },
        ),
        'probe roll',
      );
      const roll = probe.state.turn.lastRoll ?? [0, 0];
      return roll[0] + roll[1];
    })();

    const placed = buildState({
      players: { ada: { position: pack.goToJailSquareId - doubleTotal } },
      seed: doubleSeed,
    });
    const { state: after } = play(placed, [step({ type: 'ROLL_DICE' })]);

    expect(after.players['ada']?.inJail).toBe(true);
    expect(after.phase.kind).toBe('awaiting_end_turn');
  });
});

describe('ending a turn', () => {
  it('passes play to the next player and clears the turn counters', () => {
    const state = buildState({ playerIds: ['ada', 'bo'], seed: plainSeed });
    const { state: after } = play(state, [step({ type: 'ROLL_DICE' }), step({ type: 'END_TURN' })]);
    expect(after.activeIndex).toBe(1);
    expect(after.phase.kind).toBe('awaiting_roll');
    expect(after.turn).toEqual({ doublesCount: 0, hasRolled: false, lastRoll: null });
  });

  it('wraps back to the first player', () => {
    const state = buildState({ playerIds: ['ada', 'bo'], activeIndex: 1, seed: plainSeed });
    const { state: after } = play(state, [
      step({ type: 'ROLL_DICE', ...{} }, { by: 'bo' }),
      step({ type: 'END_TURN' }, { by: 'bo' }),
    ]);
    expect(after.activeIndex).toBe(0);
  });

  it('steps over a bankrupt player without reordering the rest', () => {
    const state = buildState({
      playerIds: ['ada', 'bo', 'cy'],
      players: { bo: { bankrupt: true } },
      seed: plainSeed,
    });
    const { state: after } = play(state, [step({ type: 'ROLL_DICE' }), step({ type: 'END_TURN' })]);
    expect(after.turnOrder).toEqual(['ada', 'bo', 'cy']);
    expect(after.activeIndex).toBe(2);
  });

  it('opens a jailed player turn on the gaol decision', () => {
    const state = buildState({
      playerIds: ['ada', 'bo'],
      players: { bo: { inJail: true, position: pack.jail.squareId } },
      seed: plainSeed,
    });
    const { state: after } = play(state, [step({ type: 'ROLL_DICE' }), step({ type: 'END_TURN' })]);
    expect(after.phase.kind).toBe('awaiting_jail_decision');
    expect(getLegalActions(after, 'bo').map((action) => action.type)).toEqual(['ROLL_FOR_JAIL']);
  });

  it('refuses to end a turn before rolling', () => {
    const result = reduce(buildState(), { type: 'END_TURN' }, { playerId: 'ada', now: 0 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('WRONG_PHASE');
  });
});

describe('legal actions', () => {
  it('offers nothing to a player whose turn it is not', () => {
    expect(getLegalActions(buildState(), 'bo')).toEqual([]);
  });

  it('offers nothing to a bankrupt player on their own turn', () => {
    const state = buildState({ players: { ada: { bankrupt: true } } });
    expect(getLegalActions(state, 'ada')).toEqual([]);
  });

  it('offers nothing to anyone once the game is over', () => {
    const state = buildState({ phase: { kind: 'game_over', winnerId: 'ada' } });
    expect(getLegalActions(state, 'ada')).toEqual([]);
    expect(getLegalActions(state, 'bo')).toEqual([]);
  });

  it('offers nothing to a player who is not in the game', () => {
    expect(getLegalActions(buildState(), 'ghost')).toEqual([]);
  });

  it('counts down the attempts remaining in the gaol', () => {
    const state = buildState({
      players: { ada: { inJail: true, jailAttempts: 1, position: pack.jail.squareId } },
      phase: { kind: 'awaiting_jail_decision' },
    });
    const [action] = getLegalActions(state, 'ada');
    expect(action).toEqual({ type: 'ROLL_FOR_JAIL', attemptsRemaining: 2 });
  });
});

describe('the play harness', () => {
  it('fails loudly on a step the engine refuses', () => {
    expect(() => play(buildState(), [step({ type: 'END_TURN' })])).toThrow(ScriptFailure);
  });

  it('names the step and the violation when it fails', () => {
    try {
      play(buildState(), [step({ type: 'END_TURN' })]);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as Error).message).toContain('Step 0 (END_TURN)');
      expect((error as Error).message).toContain('WRONG_PHASE');
    }
  });
});

describe('a long scripted run', () => {
  /**
   * The phase checkpoint. Two hundred turns from a fixed seed, taking the first
   * action offered at every point, landing on an exactly asserted state. This is
   * the test that catches a loop which stalls, double-counts a roll, or drifts
   * by one square somewhere in the middle of a game.
   */
  it('plays two hundred turns to an exact state', () => {
    const opening = buildState({ playerIds: ['ada', 'bo', 'cy', 'di'], seed: 20260729 });
    const { state, actions } = playForward(opening, 200);

    expect(actions).toBe(200);
    expect(state.phase.kind).not.toBe('game_over');

    // Whatever the numbers are, they must be the same every run.
    expect({
      activeIndex: state.activeIndex,
      phase: state.phase.kind,
      positions: state.turnOrder.map((id) => state.players[id]?.position),
      cash: state.turnOrder.map((id) => state.players[id]?.cash),
      jailed: state.turnOrder.map((id) => state.players[id]?.inJail),
      seed: state.rng.seed,
    }).toMatchInlineSnapshot(`
      {
        "activeIndex": 2,
        "cash": [
          2250,
          2100,
          2250,
          2100,
        ],
        "jailed": [
          false,
          false,
          false,
          true,
        ],
        "phase": "awaiting_roll",
        "positions": [
          12,
          28,
          5,
          10,
        ],
        "seed": 3532781061,
      }
    `);
  });

  it('reaches the same state from the same seed every time', () => {
    const opening = () => buildState({ playerIds: ['ada', 'bo', 'cy', 'di'], seed: 20260729 });
    const first = playForward(opening(), 200);
    const second = playForward(opening(), 200);
    expect(JSON.stringify(second.state)).toBe(JSON.stringify(first.state));
    expect(diceOf(second.events)).toEqual(diceOf(first.events));
  });

  it('never stalls: every action is answered by another legal action', () => {
    const opening = buildState({ playerIds: ['ada', 'bo'], seed: 4242 });
    const { actions } = playForward(opening, 500);
    expect(actions).toBe(500);
  });

  it('keeps every player on a real square and out of debt for salary alone', () => {
    const opening = buildState({ playerIds: ['ada', 'bo', 'cy'], seed: 909090 });
    const { state } = playForward(opening, 400);
    for (const id of state.turnOrder) {
      const player = state.players[id];
      expect(player?.position).toBeGreaterThanOrEqual(0);
      expect(player?.position).toBeLessThan(pack.squares.length);
      expect(player?.cash).toBeGreaterThanOrEqual(0);
    }
  });
});
