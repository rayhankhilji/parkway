import { describe, expect, it } from 'vitest';
import { getBoardPack } from '../../src/board/registry.js';
import { isOwnable } from '../../src/board/lookup.js';
import { createGame, maxPlayers, minPlayers } from '../../src/state/createGame.js';
import { expectOk } from '../../src/result.js';
import { testConfig } from '../helpers/buildState.js';

const pack = getBoardPack('parkway-classic');

function create(playerIds: readonly string[], seed = 12345) {
  return createGame({ playerIds, config: testConfig, boardPackId: 'parkway-classic', seed });
}

function createOk(playerIds: readonly string[], seed = 12345) {
  return expectOk(create(playerIds, seed), 'createGame should succeed');
}

describe('createGame', () => {
  it('refuses a roster below the minimum', () => {
    const result = create(['solo']);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('NOT_ENOUGH_PLAYERS');
  });

  it('refuses a roster above the maximum', () => {
    const result = create(['a', 'b', 'c', 'd', 'e', 'f', 'g']);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('TOO_MANY_PLAYERS');
  });

  it('accepts every roster size in range', () => {
    for (let size = minPlayers; size <= maxPlayers; size += 1) {
      const ids = Array.from({ length: size }, (_, index) => `p${index}`);
      expect(create(ids).ok).toBe(true);
    }
  });

  it('throws rather than returning a violation on a duplicate id', () => {
    // Duplicate ids cannot come from the players table, so this is a broken
    // caller rather than a player doing something disallowed.
    expect(() => create(['same', 'same'])).toThrow('duplicate player ids');
  });

  it('seats every player at the start square with the configured cash', () => {
    const state = createOk(['ada', 'bo', 'cy']);
    for (const id of ['ada', 'bo', 'cy']) {
      const player = state.players[id];
      expect(player).toBeDefined();
      expect(player?.cash).toBe(testConfig.startingCash);
      expect(player?.position).toBe(pack.startSquareId);
      expect(player?.inJail).toBe(false);
      expect(player?.bankrupt).toBe(false);
      expect(player?.heldJailCards).toEqual([]);
    }
  });

  it('puts every player in the turn order exactly once', () => {
    const ids = ['ada', 'bo', 'cy', 'di'];
    const state = createOk(ids);
    expect([...state.turnOrder].sort()).toEqual([...ids].sort());
  });

  it('opens with the first player awaiting a roll', () => {
    const state = createOk(['ada', 'bo']);
    expect(state.phase).toEqual({ kind: 'awaiting_roll' });
    expect(state.activeIndex).toBe(0);
    expect(state.turn).toEqual({ doublesCount: 0, hasRolled: false, lastRoll: null });
  });

  it('leaves every ownable square unowned and undeveloped', () => {
    const state = createOk(['ada', 'bo']);
    const ownable = pack.squares.filter(isOwnable);
    expect(Object.keys(state.deeds)).toHaveLength(ownable.length);
    for (const square of ownable) {
      expect(state.deeds[square.id]).toEqual({
        ownerId: null,
        mortgaged: false,
        houses: 0,
        hotels: 0,
      });
    }
  });

  it('creates no deed for squares that cannot be owned', () => {
    const state = createOk(['ada', 'bo']);
    expect(state.deeds[pack.startSquareId]).toBeUndefined();
    expect(state.deeds[pack.jail.squareId]).toBeUndefined();
    expect(state.deeds[pack.goToJailSquareId]).toBeUndefined();
  });

  it('stocks the bank from the board pack', () => {
    const state = createOk(['ada', 'bo']);
    expect(state.bank).toEqual(pack.bank);
  });

  it('deals both decks complete, with every card present once', () => {
    const state = createOk(['ada', 'bo']);
    expect([...state.decks.chance.order].sort()).toEqual(
      pack.decks.chance.map((card) => card.id).sort(),
    );
    expect([...state.decks.chest.order].sort()).toEqual(
      pack.decks.chest.map((card) => card.id).sort(),
    );
  });

  it('shuffles both decks away from the order they are declared in', () => {
    const state = createOk(['ada', 'bo'], 987654);
    expect(state.decks.chance.order).not.toEqual(pack.decks.chance.map((card) => card.id));
    expect(state.decks.chest.order).not.toEqual(pack.decks.chest.map((card) => card.id));
  });

  it('starts with an empty pot and no open trade', () => {
    const state = createOk(['ada', 'bo']);
    expect(state.pot).toBe(0);
    expect(state.openTrade).toBeNull();
  });
});

describe('createGame determinism', () => {
  /**
   * The checkpoint for this phase, and the property every later guarantee rests
   * on. If the same seed can produce two different opening positions, the action
   * log stops being a replay of anything.
   */
  it('produces a byte-identical document across a thousand runs', () => {
    const reference = JSON.stringify(createOk(['ada', 'bo', 'cy', 'di'], 424242));
    const divergent: number[] = [];

    for (let run = 0; run < 1000; run += 1) {
      if (JSON.stringify(createOk(['ada', 'bo', 'cy', 'di'], 424242)) !== reference) {
        divergent.push(run);
      }
    }

    expect(divergent).toEqual([]);
  });

  it('does not depend on the order the roster arrives in', () => {
    const forwards = createOk(['ada', 'bo', 'cy'], 55);
    const backwards = createOk(['cy', 'bo', 'ada'], 55);
    // Turn order is drawn from the roster, so it follows the input order; the
    // stored player map must not, or the document would depend on however the
    // database happened to sort its rows.
    expect(Object.keys(forwards.players)).toEqual(Object.keys(backwards.players));
  });

  it('gives different seeds different openings', () => {
    const first = createOk(['ada', 'bo', 'cy', 'di'], 1);
    const second = createOk(['ada', 'bo', 'cy', 'di'], 2);
    expect(JSON.stringify(first)).not.toBe(JSON.stringify(second));
  });

  it('survives a JSON round trip unchanged', () => {
    const state = createOk(['ada', 'bo'], 31415);
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
  });

  it('advances the generator past the shuffles it performed', () => {
    // If the stored rng were still the raw seed, the first dice roll of the game
    // would be correlated with the deck order.
    const state = createOk(['ada', 'bo'], 777);
    expect(state.rng.seed).not.toBe(777);
  });
});
