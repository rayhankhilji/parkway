import { describe, expect, it } from 'vitest';
import { getLegalActions } from '../src/legalActions';
import { reduce } from '../src/reduce';
import { winnerOf } from '../src/rules/bankruptcy';
import type { Action, LegalAction } from '../src/actions/types';
import type { GameState } from '../src/state/types';
import { buildState } from './helpers/buildState';

/**
 * A whole game, played by nobody.
 *
 * Every rule now exists, so the loop should be able to run from the opening
 * position to a declared winner without a human choosing anything. This is the
 * checkpoint for the rules stage: not that any particular rule is right — the
 * other files cover that — but that the rules compose into a game that ends.
 *
 * The driver is not a bot. It takes the first action offered and bids the
 * minimum, which makes it a poor player and an excellent way of finding states
 * nobody thought to write down.
 */

/**
 * What the driver does next, in a fixed order of preference.
 *
 * The order matters more than it looks. A driver that only rolls and buys never
 * finishes a game: with nothing built, rent stays at the base rates while every
 * lap pays a salary, so both players simply get richer for ever. That is a real
 * property of the game rather than a bug in it — development is what makes
 * anybody lose — so the driver builds whenever it can.
 *
 * Conceding is skipped throughout. Ending the game by walking away would prove
 * nothing about whether the rules compose into something that finishes.
 */
const preference: readonly LegalAction['type'][] = [
  // An auction blocks everything, so it clears first.
  'PLACE_BID',
  'PASS_BID',
  // Then a debt, which blocks everything except raising money against it.
  'SELL_HOUSE',
  'SETTLE_DEBT',
  'DECLARE_BANKRUPTCY',
  // Then the turn itself.
  'BUY_PROPERTY',
  'DECLINE_PURCHASE',
  'BUILD_HOUSE',
  'USE_JAIL_CARD',
  'PAY_JAIL_FINE',
  'ROLL_FOR_JAIL',
  'ROLL_DICE',
  'END_TURN',
];

/**
 * What the driver keeps back rather than spending on houses.
 *
 * Building with the last pound in hand is how this driver used to deadlock a
 * four-player game: everyone develops until broke, falls into debt, mortgages to
 * survive, and a board of mortgaged lots charges no rent, so nobody can ever be
 * finished off. Keeping roughly one salary in reserve is not clever play, but it
 * is enough to stop the driver from testing its own worst habit.
 */
const buildReserve = 300;

function nextMove(state: GameState): { playerId: string; action: Action } | null {
  for (const wanted of preference) {
    for (const playerId of state.turnOrder) {
      for (const legal of getLegalActions(state, playerId)) {
        if (legal.type !== wanted) continue;

        if (legal.type === 'BUILD_HOUSE' && (state.players[playerId]?.cash ?? 0) < buildReserve) {
          continue;
        }

        const action = toAction(legal);
        if (action !== null) return { playerId, action };
      }
    }
  }

  // Nothing preferred is on offer. A debtor with only mortgages left takes them.
  for (const playerId of state.turnOrder) {
    for (const legal of getLegalActions(state, playerId)) {
      if (legal.type !== 'MORTGAGE') continue;
      const action = toAction(legal);
      if (action !== null) return { playerId, action };
    }
  }

  return null;
}

function toAction(legal: LegalAction): Action | null {
  switch (legal.type) {
    case 'ROLL_DICE':
      return { type: 'ROLL_DICE' };
    case 'ROLL_FOR_JAIL':
      return { type: 'ROLL_FOR_JAIL' };
    case 'PAY_JAIL_FINE':
      return { type: 'PAY_JAIL_FINE' };
    case 'USE_JAIL_CARD':
      return { type: 'USE_JAIL_CARD' };
    case 'BUY_PROPERTY':
      return { type: 'BUY_PROPERTY' };
    case 'DECLINE_PURCHASE':
      return { type: 'DECLINE_PURCHASE' };
    case 'PLACE_BID':
      return { type: 'PLACE_BID', amount: legal.minimum };
    case 'PASS_BID':
      return { type: 'PASS_BID' };
    case 'SETTLE_DEBT':
      return { type: 'SETTLE_DEBT' };
    case 'DECLARE_BANKRUPTCY':
      return { type: 'DECLARE_BANKRUPTCY' };
    case 'MORTGAGE': {
      const squareId = legal.squareIds[0];
      return squareId === undefined ? null : { type: 'MORTGAGE', squareId };
    }
    case 'SELL_HOUSE': {
      const squareId = legal.squareIds[0];
      return squareId === undefined ? null : { type: 'SELL_HOUSE', squareId };
    }
    case 'BUILD_HOUSE': {
      const squareId = legal.squareIds[0];
      return squareId === undefined ? null : { type: 'BUILD_HOUSE', squareId };
    }
    case 'END_TURN':
      return { type: 'END_TURN' };
    default:
      // Trading is a negotiation this driver has no opinion about.
      return null;
  }
}

type Outcome = {
  readonly state: GameState;
  readonly actions: number;
  readonly finished: boolean;
};

function playToTheEnd(seed: number, playerIds: readonly string[], limit = 20_000): Outcome {
  let state = buildState({ playerIds, seed });

  for (let count = 0; count < limit; count += 1) {
    if (state.phase.kind === 'game_over') {
      return { state, actions: count, finished: true };
    }

    const move = nextMove(state);
    if (move === null) {
      return { state, actions: count, finished: false };
    }

    const result = reduce(state, move.action, { playerId: move.playerId, now: count * 60_000 });
    if (!result.ok) {
      throw new Error(
        `${move.action.type} was offered to ${move.playerId} and refused: ` +
          `${result.error.code} — ${result.error.message}`,
      );
    }
    state = result.value.state;
  }

  return { state, actions: limit, finished: false };
}

describe('a game played to the end', () => {
  it('reaches a winner', () => {
    const outcome = playToTheEnd(20260729, ['ada', 'bo']);

    expect(outcome.finished).toBe(true);
    expect(outcome.state.phase).toMatchObject({ kind: 'game_over' });
    if (outcome.state.phase.kind === 'game_over') {
      expect(outcome.state.turnOrder).toContain(outcome.state.phase.winnerId);
    }
  });

  it('declares the last player standing, and only them', () => {
    const outcome = playToTheEnd(20260729, ['ada', 'bo']);
    if (outcome.state.phase.kind !== 'game_over') throw new Error('game did not finish');

    const standing = outcome.state.turnOrder.filter(
      (id) => outcome.state.players[id]?.bankrupt === false,
    );
    expect(standing).toEqual([outcome.state.phase.winnerId]);
    expect(winnerOf(outcome.state)).toBe(outcome.state.phase.winnerId);
  });

  it('finishes every two-player game', () => {
    const unfinished: string[] = [];

    for (const seed of [1, 7, 42, 1234, 99999, 20260729]) {
      const outcome = playToTheEnd(seed, ['ada', 'bo']);
      if (!outcome.finished) {
        unfinished.push(`seed ${seed}: ${outcome.state.phase.kind} after ${outcome.actions}`);
      }
    }

    expect(unfinished).toEqual([]);
  });

  /**
   * Three and four-player games are *not* asserted to finish, and that is a fact
   * about the game rather than a gap in the engine.
   *
   * This driver never trades. With three or four players the twenty-two lots are
   * spread thinly enough that complete groups rarely form by landing alone, and
   * without a complete group nobody can build. Unbuilt rent is small — two to
   * fifty pounds — against two hundred every lap, so everyone slowly gets richer
   * and nobody is ever finished off. Real games resolve that by trading, which is
   * a negotiation this driver has no opinion about.
   *
   * What is worth asserting is that the engine never runs out of moves and never
   * breaks an invariant, however long the game goes on. Stage 7's fuzz suite
   * takes this much further.
   */
  it('never runs out of moves in a longer game with more players', { timeout: 60_000 }, () => {
    const stalled: string[] = [];

    for (const seed of [1, 42]) {
      for (const roster of [
        ['ada', 'bo', 'cy'],
        ['ada', 'bo', 'cy', 'di'],
      ]) {
        const outcome = playToTheEnd(seed, roster, 2_000);
        // Either it finished, or it was still going: what must never happen is
        // reaching a position where nobody can do anything.
        const stuck = !outcome.finished && outcome.actions < 2_000;
        if (stuck) {
          stalled.push(
            `seed ${seed} with ${roster.length} players stalled in ${outcome.state.phase.kind} ` +
              `after ${outcome.actions} actions`,
          );
        }
      }
    }

    expect(stalled).toEqual([]);
  });

  it('holds its invariants at every step of a full game', () => {
    // Checked as the game runs rather than only at the end: a bank that goes
    // negative in the middle and recovers would pass a final assertion.
    let state = buildState({ playerIds: ['ada', 'bo', 'cy'], seed: 555 });
    const broken: string[] = [];

    for (let count = 0; count < 20_000; count += 1) {
      if (state.phase.kind === 'game_over') break;

      if (state.bank.houses < 0 || state.bank.hotels < 0) {
        broken.push(`bank went negative at action ${count}`);
      }
      for (const id of state.turnOrder) {
        const player = state.players[id];
        if (player === undefined) continue;
        if (player.cash < 0) broken.push(`${id} held negative cash at action ${count}`);
        if (player.bankrupt && player.cash !== 0) {
          broken.push(`${id} was out but still held cash at action ${count}`);
        }
      }
      if (broken.length > 0) break;

      const move = nextMove(state);
      if (move === null) break;

      const result = reduce(state, move.action, { playerId: move.playerId, now: count * 60_000 });
      if (!result.ok) throw new Error(`refused: ${result.error.code}`);
      state = result.value.state;
    }

    expect(broken).toEqual([]);
  });
});
