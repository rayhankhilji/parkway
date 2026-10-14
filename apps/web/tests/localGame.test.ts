import { describe, expect, it } from 'vitest';
import { getLegalActions, toPublicState } from '@parkway/engine';
import { createBot } from '@parkway/bot';
import { applyLocal, createLocalGame, payloadFor, type LocalSave } from '../lib/local/localGame';

/**
 * The solo driver.
 *
 * A solo game runs the engine in the browser, so the thing worth proving is
 * that what it hands the UI is the same shape the server would, that it never
 * leaks the secret fields, and that a game of bots can actually be finished
 * through it.
 */

const setup = {
  name: 'Ada',
  colour: 'sky',
  opponents: 3,
  difficulty: 'steady',
  config: {
    startingCash: 1500,
    salary: 200,
    freeParkingPot: false,
    incomeTaxMode: 'flat',
    auctionOnDecline: true,
    auctionSeconds: 10,
  },
} as const;

describe('a solo game', () => {
  it('seats the player and the requested number of bots, each in a different colour', () => {
    const save = createLocalGame(setup);
    expect(save.seats).toHaveLength(4);
    expect(save.seats.filter((seat) => seat.bot === null)).toHaveLength(1);
    expect(new Set(save.seats.map((seat) => seat.colour)).size).toBe(4);
    expect(save.seats[0]?.colour).toBe('sky');
  });

  it('hands the UI a public payload with no secrets in it', () => {
    const payload = payloadFor(createLocalGame(setup));
    expect(payload.publicState).not.toHaveProperty('rng');
    expect(typeof payload.publicState?.decks.chance).toBe('number');
    expect(payload.players.filter((player) => player.isBot === true)).toHaveLength(3);
  });

  it('refuses an illegal move without changing anything', () => {
    const save = createLocalGame(setup);
    const notActive = save.state.turnOrder.find((id) => id !== save.state.turnOrder[0]);
    const result = applyLocal(save, notActive ?? '', { type: 'ROLL_DICE' }, 1);
    expect(result.ok).toBe(false);
  });

  it('can be played to the end by bots', () => {
    let save: LocalSave = createLocalGame(setup);
    const bots = new Map(
      save.seats.map((seat, index) => [seat.id, createBot(seat.id, 'steady', index + 1)]),
    );

    for (let step = 0; step < 20_000 && save.state.phase.kind !== 'game_over'; step += 1) {
      const now = step * 60_000;
      let moved = false;
      for (const id of save.state.turnOrder) {
        const legalActions = getLegalActions(save.state, id);
        const action = bots
          .get(id)
          ?.decide({ state: toPublicState(save.state), playerId: id, legalActions, now });
        if (action == null) continue;
        const result = applyLocal(save, id, action, now);
        if (result.ok) {
          save = result.save;
          moved = true;
          break;
        }
      }
      if (!moved) {
        const result = applyLocal(save, save.humanId, { type: 'AUCTION_TIMEOUT' }, now);
        if (result.ok) save = result.save;
      }
    }

    expect(save.state.phase.kind).toBe('game_over');
    expect(save.feed.length).toBeLessThanOrEqual(400);
  });
});
