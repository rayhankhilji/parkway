import { describe, expect, it } from 'vitest';
import { getBoardPack } from '../../src/board/registry';
import { drawCard, returnCardToBottom, takeCardOutOfCycle } from '../../src/cards/deck';
import { resolveSquare } from '../../src/rules/resolveSquare';
import type { GameState } from '../../src/state/types';
import { buildState, ownGroup, type BuildStateOptions } from '../helpers/buildState';

const pack = getBoardPack('parkway-classic');
const chanceIds = pack.decks.chance.map((card) => card.id);
const chestIds = pack.decks.chest.map((card) => card.id);

/** A state standing on a Fortune square with a chosen card on top. */
function withTopCard(cardId: string, options: BuildStateOptions = {}): GameState {
  const deck = cardId.startsWith('chance') ? 'chance' : 'chest';
  const all = deck === 'chance' ? chanceIds : chestIds;
  const square = deck === 'chance' ? 7 : 2;

  return buildState({
    ...options,
    players: { ...options.players, ada: { position: square, ...options.players?.['ada'] } },
    decks: { [deck]: [cardId, ...all.filter((id) => id !== cardId)] },
  });
}

function resolve(state: GameState, causingRoll: [number, number] = [3, 4]) {
  return resolveSquare(state, 'ada', { causingRoll, depth: 0, viaCard: false });
}

describe('the deck cycle', () => {
  /** PRD F10 — drawing every card and one more returns the first, in order. */
  it('cycles in a fixed order forever', () => {
    let state = buildState();
    const drawn: string[] = [];

    for (let index = 0; index < chanceIds.length + 1; index += 1) {
      const draw = drawCard(state, 'chance');
      drawn.push(draw.card.id);
      state = draw.state;
    }

    expect(drawn.slice(0, chanceIds.length)).toEqual(chanceIds);
    expect(drawn[chanceIds.length]).toBe(chanceIds[0]);
  });

  it('returns each drawn card to the bottom', () => {
    const draw = drawCard(buildState(), 'chance');
    const order = draw.state.decks.chance.order;
    expect(order[order.length - 1]).toBe(chanceIds[0]);
    expect(order[0]).toBe(chanceIds[1]);
  });

  it('leaves the other deck untouched', () => {
    const draw = drawCard(buildState(), 'chance');
    expect(draw.state.decks.chest.order).toEqual(chestIds);
  });

  it('excludes a held card from the cycle', () => {
    const releaseId = 'chance-08';
    let state = takeCardOutOfCycle(buildState(), 'chance', releaseId);
    const drawn: string[] = [];

    for (let index = 0; index < chanceIds.length - 1; index += 1) {
      const draw = drawCard(state, 'chance');
      drawn.push(draw.card.id);
      state = draw.state;
    }

    expect(drawn).not.toContain(releaseId);
    expect(drawn).toHaveLength(chanceIds.length - 1);
  });

  it('puts a returned card at the bottom, not back where it was', () => {
    const releaseId = 'chance-08';
    const without = takeCardOutOfCycle(buildState(), 'chance', releaseId);
    const restored = returnCardToBottom(without, 'chance', releaseId);
    const order = restored.decks.chance.order;
    expect(order[order.length - 1]).toBe(releaseId);
    expect(order).toHaveLength(chanceIds.length);
  });

  it('refuses to return a card that is already in the deck', () => {
    expect(() => returnCardToBottom(buildState(), 'chance', 'chance-08')).toThrow('already in');
  });
});

describe('money cards', () => {
  it('pays out a collection', () => {
    // chance-07: harbour bonds pay out, collect £50.
    const landing = resolve(withTopCard('chance-07'));
    expect(landing.state.players['ada']?.cash).toBe(1550);
    expect(landing.halted).toBe(false);
  });

  it('takes a fine', () => {
    // chance-12: cited for racing, pay £15.
    const landing = resolve(withTopCard('chance-12'));
    expect(landing.state.players['ada']?.cash).toBe(1485);
  });

  it('reports which card was drawn', () => {
    const landing = resolve(withTopCard('chance-07'));
    expect(landing.events[0]).toEqual({
      type: 'CARD_DRAWN',
      playerId: 'ada',
      deck: 'chance',
      cardId: 'chance-07',
    });
  });

  it('charges for buildings on a repairs card', () => {
    // chest-14: £40 a house, £115 a hotel. Two lots with two houses each, plus a
    // third group lot carrying a hotel.
    const landing = resolve(
      withTopCard('chest-14', {
        deeds: {
          ...ownGroup('group-2', 'ada', { houses: 2 }),
          9: { ownerId: 'ada', hotels: 1 },
        },
      }),
    );
    // Four houses at 40 and one hotel at 115.
    expect(landing.state.players['ada']?.cash).toBe(1500 - (4 * 40 + 115));
  });

  it('charges nothing on a repairs card with nothing built', () => {
    const landing = resolve(withTopCard('chest-14'));
    expect(landing.state.players['ada']?.cash).toBe(1500);
  });
});

describe('cards that touch every player', () => {
  it('pays every other player', () => {
    // chance-15: elected to the drainage board, pay every other player £50.
    const state = withTopCard('chance-15', { playerIds: ['ada', 'bo', 'cy'] });
    const landing = resolve(state);
    expect(landing.state.players['ada']?.cash).toBe(1400);
    expect(landing.state.players['bo']?.cash).toBe(1550);
    expect(landing.state.players['cy']?.cash).toBe(1550);
  });

  it('collects from every other player', () => {
    // chest-09: it is your name day, collect £10 from everyone.
    const state = withTopCard('chest-09', { playerIds: ['ada', 'bo', 'cy'] });
    const landing = resolve(state);
    expect(landing.state.players['ada']?.cash).toBe(1520);
    expect(landing.state.players['bo']?.cash).toBe(1490);
    expect(landing.state.players['cy']?.cash).toBe(1490);
  });

  it('skips players who are already out', () => {
    const state = withTopCard('chance-15', {
      playerIds: ['ada', 'bo', 'cy'],
      players: { cy: { bankrupt: true } },
    });
    const landing = resolve(state);
    expect(landing.state.players['ada']?.cash).toBe(1450);
    expect(landing.state.players['cy']?.cash).toBe(1500);
  });

  it('keeps the unmet obligations when one payment cannot be covered', () => {
    // Ada owes three players £50 each but holds only £70. The first is paid, the
    // second opens the debt, and the third must survive it — otherwise settling
    // would quietly cancel money owed to someone uninvolved.
    const state = withTopCard('chance-15', {
      playerIds: ['ada', 'bo', 'cy', 'di'],
      players: { ada: { cash: 70 } },
    });
    const landing = resolve(state);

    expect(landing.halted).toBe(true);
    expect(landing.state.phase).toMatchObject({
      kind: 'awaiting_debt',
      debtorId: 'ada',
      amount: 50,
      remaining: [{ debtorId: 'ada', amount: 50 }],
    });
  });

  it('names the shortfall against the player who cannot pay when collecting', () => {
    const state = withTopCard('chest-09', {
      playerIds: ['ada', 'bo', 'cy'],
      players: { bo: { cash: 3 } },
    });
    const landing = resolve(state);
    expect(landing.state.phase).toMatchObject({
      kind: 'awaiting_debt',
      debtorId: 'bo',
      creditorId: 'ada',
      amount: 10,
    });
  });
});

describe('movement cards', () => {
  /** PRD F10 — a card sending a player forwards past the start pays salary. */
  it('collects salary when advancing forwards past the start', () => {
    // chance-01 advances to the start from square 7.
    const landing = resolve(withTopCard('chance-01'));
    expect(landing.state.players['ada']?.position).toBe(0);
    expect(landing.state.players['ada']?.cash).toBe(1700);
    expect(landing.events.some((event) => event.type === 'SALARY_PAID')).toBe(true);
  });

  it('moves backwards and resolves where it lands', () => {
    // chance-09 goes back three. From the Fortune square at 7 that is the tax
    // square at 4, which charges the flat amount.
    const landing = resolve(withTopCard('chance-09', { players: { ada: { cash: 500 } } }));
    expect(landing.state.players['ada']?.position).toBe(4);
    expect(landing.state.players['ada']?.cash).toBe(300);
    expect(landing.events.some((event) => event.type === 'SALARY_PAID')).toBe(false);
  });

  it('resolves the destination it arrives at', () => {
    // chance-03 advances to Weavers Gate, which Bo owns: rent follows.
    const landing = resolve(withTopCard('chance-03', { deeds: { 11: { ownerId: 'bo' } } }));
    expect(landing.state.players['ada']?.position).toBe(11);
    expect(landing.events.some((event) => event.type === 'RENT_PAID')).toBe(true);
  });

  it('offers a purchase when the destination is unowned', () => {
    const landing = resolve(withTopCard('chance-03'));
    expect(landing.halted).toBe(true);
    expect(landing.state.phase).toEqual({ kind: 'awaiting_purchase', squareId: 11 });
  });

  it('sends the player to the gaol without passing the start', () => {
    const landing = resolve(
      withTopCard('chance-10', { players: { ada: { position: 7, cash: 0 } } }),
    );
    expect(landing.state.players['ada']?.inJail).toBe(true);
    expect(landing.state.players['ada']?.position).toBe(pack.jail.squareId);
    expect(landing.state.players['ada']?.cash).toBe(0);
    expect(landing.halted).toBe(true);
  });
});

describe('the nearest-of-kind cards', () => {
  it('advances to the next station going forwards', () => {
    // chance-05 from square 7 reaches Eastdock Station at 15.
    const landing = resolve(withTopCard('chance-05'));
    expect(landing.state.players['ada']?.position).toBe(15);
  });

  /** PRD F10 — the pack's penalty rate applies, not the standard one. */
  it('charges double the station fare when a card sent them', () => {
    const landing = resolve(withTopCard('chance-05', { deeds: { 15: { ownerId: 'bo' } } }));
    const rent = landing.events.find((event) => event.type === 'RENT_PAID');
    // One station held charges 25; the card penalty doubles it.
    expect(rent).toMatchObject({ amount: 50, squareId: 15 });
  });

  it('charges ten times the roll at a utility, even when only one is held', () => {
    // chance-04 from square 7 reaches Riverhead Waterworks at 12.
    const landing = resolve(withTopCard('chance-04', { deeds: { 12: { ownerId: 'bo' } } }), [5, 4]);
    const rent = landing.events.find((event) => event.type === 'RENT_PAID');
    expect(rent).toMatchObject({ amount: 90, squareId: 12 });
  });

  it('wraps the board and collects salary on the way', () => {
    // From square 36 the next station is Northgate at 5, which is past the start.
    const landing = resolve(
      withTopCard('chance-05', { players: { ada: { position: 36, cash: 0 } } }),
    );
    expect(landing.state.players['ada']?.position).toBe(5);
    expect(landing.state.players['ada']?.cash).toBe(200);
  });
});

describe('the release card', () => {
  it('is kept by the player and leaves the deck', () => {
    const landing = resolve(withTopCard('chance-08'));
    expect(landing.state.players['ada']?.heldJailCards).toEqual(['chance']);
    expect(landing.state.decks.chance.order).not.toContain('chance-08');
    expect(landing.halted).toBe(false);
  });

  it('records which deck it came from, so it can go home later', () => {
    const landing = resolve(withTopCard('chest-05'));
    expect(landing.state.players['ada']?.heldJailCards).toEqual(['chest']);
  });
});

describe('chained cards', () => {
  it('resolves a card that lands the player on another card square', () => {
    // chance-09 goes back three. From 36 that is 33, a Civic Fund square, whose
    // top card here collects £200.
    const state = buildState({
      players: { ada: { position: 36, cash: 0 } },
      decks: {
        chance: ['chance-09', ...chanceIds.filter((id) => id !== 'chance-09')],
        chest: ['chest-02', ...chestIds.filter((id) => id !== 'chest-02')],
      },
    });
    const landing = resolve(state);

    expect(landing.state.players['ada']?.position).toBe(33);
    expect(landing.state.players['ada']?.cash).toBe(200);
    // Both draws are reported, in the order they happened.
    const draws = landing.events.filter((event) => event.type === 'CARD_DRAWN');
    expect(draws).toHaveLength(2);
  });

  it('refuses to recurse without end', () => {
    // A pack whose card sends the player back onto the same card square would
    // loop forever. An error naming the pack beats a stack overflow.
    const looping = buildState({ players: { ada: { position: 7, cash: 0 } } });
    const context = { causingRoll: [3, 4] as [number, number], depth: 99, viaCard: false };
    expect(() => resolveSquare(looping, 'ada', context)).toThrow('suggests a loop');
  });
});
