import { describe, expect, it } from 'vitest';
import {
  createGame,
  expectOk,
  getLegalActions,
  reduce,
  toPublicState,
  type GameState,
  type PlayerId,
} from '@parkway/engine';
import { createBot, type Difficulty } from '../src/index';

/**
 * Are these bots any good?
 *
 * A bot that never crashes is not the same as a bot worth playing against, and
 * the only honest way to answer the second question is to sit them opposite each
 * other and count. A ruthless bot that cannot reliably beat a gentle one has a
 * difficulty setting that does nothing.
 *
 * These are statistical, so they use enough games to mean something and assert
 * margins wide enough not to flake.
 */

const config = {
  startingCash: 1500,
  salary: 200,
  freeParkingPot: false,
  incomeTaxMode: 'flat',
  auctionOnDecline: true,
  auctionSeconds: 30,
} as const;

type Match = { readonly winner: PlayerId | null; readonly actions: number };

function playMatch(
  seed: number,
  seats: Readonly<Record<PlayerId, Difficulty>>,
  limit = 8_000,
): Match {
  const playerIds = Object.keys(seats);
  const created = createGame({ playerIds, config, boardPackId: 'parkway-classic', seed });
  let state: GameState = expectOk(created, 'createGame should succeed');

  const bots = new Map(
    playerIds.map((id) => {
      const difficulty = seats[id];
      if (difficulty === undefined) throw new Error(`no difficulty for ${id}`);
      // Seeded per player and per game, so a match is reproducible.
      return [id, createBot(id, difficulty, seed * 31 + id.charCodeAt(0))];
    }),
  );

  for (let count = 0; count < limit; count += 1) {
    if (state.phase.kind === 'game_over') {
      return { winner: state.phase.winnerId, actions: count };
    }

    // Everyone is asked, because during an auction the player who can act is not
    // the one whose turn it is.
    const view = toPublicState(state);
    let applied = false;

    for (const id of state.turnOrder) {
      const legalActions = getLegalActions(state, id);
      if (legalActions.length === 0) continue;

      const bot = bots.get(id);
      if (bot === undefined) continue;

      const action = bot.decide({ state: view, playerId: id, legalActions, now: count * 60_000 });
      if (action === null) continue;

      const result = reduce(state, action, { playerId: id, now: count * 60_000 });
      if (!result.ok) {
        throw new Error(
          `${bot.difficulty} bot ${id} chose ${action.type} and the engine refused it: ` +
            `${result.error.code} — ${result.error.message}`,
        );
      }

      state = result.value.state;
      applied = true;
      break;
    }

    if (!applied) return { winner: null, actions: count };
  }

  return { winner: null, actions: limit };
}

function winRate(
  games: number,
  seats: Readonly<Record<PlayerId, Difficulty>>,
  countFor: PlayerId,
  limit = 20_000,
): { rate: number; decided: number } {
  let wins = 0;
  let decided = 0;

  for (let seed = 1; seed <= games; seed += 1) {
    const match = playMatch(seed, seats, limit);
    if (match.winner === null) continue;
    decided += 1;
    if (match.winner === countFor) wins += 1;
  }

  return { rate: decided === 0 ? 0 : wins / decided, decided };
}

describe('bots play legally', () => {
  it('never chooses an action the engine refuses', () => {
    // playMatch throws on a refusal, so reaching the end is the assertion.
    for (const difficulty of ['gentle', 'steady', 'sharp', 'ruthless'] as const) {
      const match = playMatch(7, { ada: difficulty, bo: difficulty });
      expect(match.actions).toBeGreaterThan(0);
    }
  });

  it('always finds a move, so a game never stalls on a bot', () => {
    const match = playMatch(11, { ada: 'sharp', bo: 'sharp', cy: 'steady', di: 'gentle' });
    // Either somebody won or it ran to the limit — never "nobody could move".
    expect(match.actions).toBeGreaterThan(100);
  });

  it('is deterministic: the same seed plays the same game', () => {
    const first = playMatch(42, { ada: 'sharp', bo: 'steady' });
    const second = playMatch(42, { ada: 'sharp', bo: 'steady' });
    expect(second).toEqual(first);
  });
});

describe('difficulty means something', () => {
  it('has ruthless beat gentle clearly', { timeout: 300_000 }, () => {
    const { rate, decided } = winRate(60, { ada: 'ruthless', bo: 'gentle' }, 'ada');
    expect(decided).toBeGreaterThan(30);
    expect(rate).toBeGreaterThan(0.65);
  });

  it('has sharp beat gentle', { timeout: 300_000 }, () => {
    const { rate, decided } = winRate(60, { ada: 'sharp', bo: 'gentle' }, 'ada');
    expect(decided).toBeGreaterThan(30);
    expect(rate).toBeGreaterThan(0.6);
  });

  it('gives gentle a real chance, since it is meant to be beatable', { timeout: 300_000 }, () => {
    // A difficulty nobody can ever beat is not an easy setting, it is a broken one.
    const { rate } = winRate(60, { ada: 'ruthless', bo: 'gentle' }, 'ada');
    expect(rate).toBeLessThan(0.98);
  });

  it('is roughly even between two bots of the same tier', { timeout: 300_000 }, () => {
    // Not exactly even — the first seat moves first — but nowhere near lopsided.
    const { rate, decided } = winRate(60, { ada: 'sharp', bo: 'sharp' }, 'ada');
    expect(decided).toBeGreaterThan(30);
    expect(rate).toBeGreaterThan(0.3);
    expect(rate).toBeLessThan(0.7);
  });
});

describe('bots finish games', () => {
  it('reaches a winner far more often than a random bot did', { timeout: 300_000 }, () => {
    let decided = 0;
    for (let seed = 1; seed <= 40; seed += 1) {
      if (playMatch(seed, { ada: 'sharp', bo: 'steady' }).winner !== null) decided += 1;
    }
    // Bots that buy well, build and trade end games; the random fuzz bot barely did.
    expect(decided / 40).toBeGreaterThan(0.8);
  });
});
