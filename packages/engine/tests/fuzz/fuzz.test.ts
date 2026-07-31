import { describe, expect, it } from 'vitest';
import { checkInvariants, fuzzGame, replay } from './harness';

/**
 * The correctness stage, in two properties.
 *
 * Nothing breaks, and everything replays. Between them they cover the class of
 * bug that unit tests structurally cannot reach: the one that only appears when
 * an auction outlives the turn that started it, or a card lands a player on a
 * mortgaged station on the same roll a debt is settled.
 *
 * The bot plays at random and badly. That is the point — a hand-written scenario
 * only tests what its author already suspected.
 *
 * `pnpm test:engine` runs a fast sample of this so the loop stays quick;
 * `pnpm test:fuzz` runs the full ten thousand.
 */

const heavy = process.env['PARKWAY_FUZZ'] === 'full';
const games = heavy ? 10_000 : 120;

const rosters: readonly (readonly string[])[] = [
  ['ada', 'bo'],
  ['ada', 'bo', 'cy'],
  ['ada', 'bo', 'cy', 'di'],
  ['ada', 'bo', 'cy', 'di', 'eve'],
  ['ada', 'bo', 'cy', 'di', 'eve', 'fen'],
];

function rosterFor(index: number): readonly string[] {
  const roster = rosters[index % rosters.length];
  if (roster === undefined) throw new Error('no roster');
  return roster;
}

describe(`${games} fuzzed games`, () => {
  it(
    'never breaks an invariant and never refuses an action it offered',
    { timeout: 600_000 },
    () => {
      const failures: string[] = [];

      for (let index = 0; index < games; index += 1) {
        const run = fuzzGame(index + 1, rosterFor(index));
        if (run.broken !== null) {
          // The seed and roster are everything needed to reproduce it exactly.
          failures.push(`seed ${run.seed} (${run.playerIds.length} players): ${run.broken}`);
          if (failures.length >= 5) break;
        }
      }

      expect(failures).toEqual([]);
    },
  );

  it(
    'replays every game from its opening position to the same ending state',
    { timeout: 600_000 },
    () => {
      const mismatches: string[] = [];

      for (let index = 0; index < games; index += 1) {
        const run = fuzzGame(index + 1, rosterFor(index));
        if (run.broken !== null) continue;

        const replayed = replay(run);

        if (replayed.mismatchAt !== null) {
          mismatches.push(`seed ${run.seed}: action ${replayed.mismatchAt} was refused on replay`);
        } else if (JSON.stringify(replayed.state) !== JSON.stringify(run.final)) {
          mismatches.push(
            `seed ${run.seed}: replayed state differs after ${run.log.length} actions`,
          );
        }

        if (mismatches.length >= 5) break;
      }

      expect(mismatches).toEqual([]);
    },
  );

  it('finishes two-player games rather than wandering for ever', { timeout: 600_000 }, () => {
    // Larger rosters are not asserted to finish: this bot does not trade, and
    // without trading the lots stay spread and nothing gets built. What matters
    // there is that the game never runs out of moves, which the invariant run
    // above covers.
    let finished = 0;
    const sample = heavy ? 200 : 40;

    for (let index = 0; index < sample; index += 1) {
      if (fuzzGame(index + 1, ['ada', 'bo'], 6_000).finished) finished += 1;
    }

    // Not every run ends inside the limit — a bot that mortgages at random can
    // keep itself alive a long time — but the great majority should.
    expect(finished / sample).toBeGreaterThan(0.8);
  });
});

describe('the invariant checker itself', () => {
  it('accepts a game that has just started', () => {
    expect(checkInvariants(fuzzGame(1, ['ada', 'bo'], 0).initial)).toBeNull();
  });

  it('notices houses that do not add up', () => {
    const run = fuzzGame(1, ['ada', 'bo'], 0);
    const tampered = { ...run.initial, bank: { ...run.initial.bank, houses: 31 } };
    expect(checkInvariants(tampered)).toContain('houses do not add up');
  });

  it('notices a player holding negative cash', () => {
    const run = fuzzGame(1, ['ada', 'bo'], 0);
    const ada = run.initial.players['ada'];
    if (ada === undefined) throw new Error('ada should be in this game');
    const tampered = {
      ...run.initial,
      players: { ...run.initial.players, ada: { ...ada, cash: -1 } },
    };
    expect(checkInvariants(tampered)).toContain('negative cash');
  });

  it('notices an unevenly developed group', () => {
    const run = fuzzGame(1, ['ada', 'bo'], 0);
    const deed = run.initial.deeds[1];
    if (deed === undefined) throw new Error('square 1 should be ownable');
    const tampered = {
      ...run.initial,
      bank: { ...run.initial.bank, houses: run.initial.bank.houses - 3 },
      deeds: { ...run.initial.deeds, 1: { ...deed, ownerId: 'ada', houses: 3 } },
    };
    expect(checkInvariants(tampered)).toContain('developed unevenly');
  });

  it('notices a bankrupt player still holding property', () => {
    const run = fuzzGame(1, ['ada', 'bo'], 0);
    const ada = run.initial.players['ada'];
    const deed = run.initial.deeds[1];
    if (ada === undefined || deed === undefined) throw new Error('unexpected opening position');
    const tampered = {
      ...run.initial,
      players: { ...run.initial.players, ada: { ...ada, cash: 0, bankrupt: true } },
      deeds: { ...run.initial.deeds, 1: { ...deed, ownerId: 'ada' } },
    };
    expect(checkInvariants(tampered)).toContain('still owns');
  });
});
