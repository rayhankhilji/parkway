import { describe, expect, it } from 'vitest';
import { getLegalActions } from '../../src/legalActions';
import { reduce } from '../../src/reduce';
import { expectOk } from '../../src/result';
import type { Action } from '../../src/actions/types';
import type { GameState, TurnPhase } from '../../src/state/types';
import {
  buildState,
  groupSquareIds,
  ownGroup,
  type BuildStateOptions,
} from '../helpers/buildState';
import { turnActionTypes } from '../helpers/actions';

/**
 * PRD F12 and F14 — debt, bankruptcy and victory.
 *
 * The rule that shapes all of this is that a debt halts the game for the debtor
 * and for everybody else: no other turn begins until it resolves. It resolves in
 * exactly two ways, settled or declared, and the only thing a debtor may do in
 * between is raise money.
 */

const [tanneryA = 0, tanneryB = 0] = groupSquareIds('group-1');

function owing(
  amount: number,
  creditorId: string | null,
  options: BuildStateOptions = {},
): GameState {
  const interrupted: TurnPhase = { kind: 'awaiting_end_turn' };
  return buildState({
    playerIds: ['ada', 'bo'],
    ...options,
    players: { ada: { cash: 0 }, bo: { cash: 1000 }, ...options.players },
    phase: {
      kind: 'awaiting_debt',
      debtorId: 'ada',
      creditorId,
      amount,
      interrupted,
      remaining: [],
    },
  });
}

function act(state: GameState, action: Action, playerId: string) {
  return reduce(state, action, { playerId, now: 0 });
}

function actOk(state: GameState, action: Action, playerId: string): GameState {
  return expectOk(act(state, action, playerId), `${action.type} should be legal`).state;
}

describe('while a debt is open', () => {
  /** PRD F12 — the debt blocks the debtor, and no other turn begins. */
  it('offers the debtor only the ways out and the ways to raise money', () => {
    const state = owing(200, 'bo', {
      players: { ada: { cash: 0 } },
      deeds: { [tanneryA]: { ownerId: 'ada' } },
    });
    expect(getLegalActions(state, 'ada').map((action) => action.type)).toEqual([
      'DECLARE_BANKRUPTCY',
      'MORTGAGE',
      'OFFER_TRADE',
      'CONCEDE',
    ]);
  });

  it('offers nothing at all to anybody else', () => {
    expect(getLegalActions(owing(200, 'bo'), 'bo')).toEqual([]);
  });

  it('refuses the debtor rolling or ending their turn', () => {
    const state = owing(200, 'bo');
    for (const action of [{ type: 'ROLL_DICE' }, { type: 'END_TURN' }] as const) {
      const result = act(state, action, 'ada');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('WRONG_PHASE');
    }
  });

  it('refuses settling before the money is there', () => {
    const state = owing(200, 'bo', { players: { ada: { cash: 50 } } });
    const result = act(state, { type: 'SETTLE_DEBT' }, 'ada');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('DEBT_NOT_SETTLED');
    expect(turnActionTypes(state, 'ada')).toEqual(['DECLARE_BANKRUPTCY']);
  });

  it('refuses somebody else settling or declaring on the debtor behalf', () => {
    const state = owing(200, 'bo');
    for (const action of [{ type: 'SETTLE_DEBT' }, { type: 'DECLARE_BANKRUPTCY' }] as const) {
      const result = act(state, action, 'bo');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('NO_DEBT');
    }
  });
});

describe('settling', () => {
  it('pays the creditor and restores the interrupted turn', () => {
    const state = owing(200, 'bo', { players: { ada: { cash: 500 } } });
    const settled = actOk(state, { type: 'SETTLE_DEBT' }, 'ada');

    expect(settled.players['ada']?.cash).toBe(300);
    expect(settled.players['bo']?.cash).toBe(1200);
    expect(settled.phase.kind).toBe('awaiting_end_turn');
  });

  it('pays the bank when nobody is owed, feeding the pot if that is on', () => {
    const state = owing(200, null, {
      config: { freeParkingPot: true },
      players: { ada: { cash: 500 } },
    });
    const settled = actOk(state, { type: 'SETTLE_DEBT' }, 'ada');
    expect(settled.pot).toBe(200);
    expect(settled.players['ada']?.cash).toBe(300);
  });

  it('reports the settlement', () => {
    const state = owing(200, 'bo', { players: { ada: { cash: 500 } } });
    const result = expectOk(act(state, { type: 'SETTLE_DEBT' }, 'ada'), 'settling should be legal');
    expect(result.events[0]).toEqual({
      type: 'DEBT_SETTLED',
      debtorId: 'ada',
      creditorId: 'bo',
      amount: 200,
    });
  });

  it('lets a debtor mortgage their way to solvency and then settle', () => {
    // The sequence PRD F12 describes: raise the money, then pay. Ferryside
    // mortgages for 50 + 50 + 60, which is short of 180; Tannery Row adds 30.
    const state = owing(180, 'bo', {
      players: { ada: { cash: 0 } },
      deeds: { ...ownGroup('group-2', 'ada'), [tanneryA]: { ownerId: 'ada' } },
    });
    const [ferryA = 0, ferryB = 0, ferryC = 0] = groupSquareIds('group-2');

    let raised = state;
    for (const squareId of [ferryA, ferryB, ferryC]) {
      raised = actOk(raised, { type: 'MORTGAGE', squareId }, 'ada');
    }

    expect(raised.players['ada']?.cash).toBe(160);
    const tooSoon = act(raised, { type: 'SETTLE_DEBT' }, 'ada');
    expect(tooSoon.ok).toBe(false);
    if (!tooSoon.ok) expect(tooSoon.error.code).toBe('DEBT_NOT_SETTLED');

    // One more lot takes them over the line.
    const enough = actOk(raised, { type: 'MORTGAGE', squareId: tanneryA }, 'ada');
    expect(enough.players['ada']?.cash).toBe(190);

    const settled = actOk(enough, { type: 'SETTLE_DEBT' }, 'ada');
    expect(settled.phase.kind).toBe('awaiting_end_turn');
    expect(settled.players['ada']?.cash).toBe(10);
    expect(settled.players['bo']?.cash).toBe(1180);
  });

  it('works through obligations queued behind the one that halted the game', () => {
    const state = buildState({
      playerIds: ['ada', 'bo', 'cy'],
      players: { ada: { cash: 500 }, bo: { cash: 100 }, cy: { cash: 100 } },
      phase: {
        kind: 'awaiting_debt',
        debtorId: 'ada',
        creditorId: 'bo',
        amount: 50,
        interrupted: { kind: 'awaiting_end_turn' },
        remaining: [{ debtorId: 'ada', creditorId: 'cy', amount: 50 }],
      },
    });

    const settled = actOk(state, { type: 'SETTLE_DEBT' }, 'ada');
    expect(settled.players['ada']?.cash).toBe(400);
    expect(settled.players['bo']?.cash).toBe(150);
    expect(settled.players['cy']?.cash).toBe(150);
    expect(settled.phase.kind).toBe('awaiting_end_turn');
  });

  it('halts again when a queued obligation cannot be met', () => {
    const state = buildState({
      playerIds: ['ada', 'bo', 'cy'],
      players: { ada: { cash: 60 } },
      phase: {
        kind: 'awaiting_debt',
        debtorId: 'ada',
        creditorId: 'bo',
        amount: 50,
        interrupted: { kind: 'awaiting_end_turn' },
        remaining: [{ debtorId: 'ada', creditorId: 'cy', amount: 50 }],
      },
    });

    const after = actOk(state, { type: 'SETTLE_DEBT' }, 'ada');
    expect(after.phase).toMatchObject({
      kind: 'awaiting_debt',
      debtorId: 'ada',
      creditorId: 'cy',
      amount: 50,
    });
  });
});

describe('bankruptcy to a player', () => {
  /** PRD F14 — the creditor receives cash, building proceeds and every deed. */
  it('hands the creditor everything, with buildings sold first', () => {
    const state = owing(2000, 'bo', {
      players: { ada: { cash: 120 }, bo: { cash: 1000 } },
      deeds: ownGroup('group-1', 'ada', { houses: 2 }),
    });

    const done = actOk(state, { type: 'DECLARE_BANKRUPTCY' }, 'ada');

    // Four houses at 50 sell back at half: 100, on top of the 120 in hand.
    expect(done.players['bo']?.cash).toBe(1000 + 120 + 100);
    expect(done.players['ada']?.cash).toBe(0);
    expect(done.players['ada']?.bankrupt).toBe(true);
    expect(done.deeds[tanneryA]).toMatchObject({ ownerId: 'bo', houses: 0, hotels: 0 });
    expect(done.deeds[tanneryB]).toMatchObject({ ownerId: 'bo', houses: 0, hotels: 0 });
  });

  it('returns the buildings to the bank', () => {
    const state = owing(2000, 'bo', {
      bank: { houses: 20, hotels: 12 },
      deeds: ownGroup('group-1', 'ada', { houses: 2 }),
    });
    expect(actOk(state, { type: 'DECLARE_BANKRUPTCY' }, 'ada').bank.houses).toBe(24);
  });

  it('passes on held release cards', () => {
    const state = owing(2000, 'bo', { players: { ada: { heldJailCards: ['chance'] } } });
    const done = actOk(state, { type: 'DECLARE_BANKRUPTCY' }, 'ada');
    expect(done.players['bo']?.heldJailCards).toEqual(['chance']);
    expect(done.players['ada']?.heldJailCards).toEqual([]);
  });

  it('passes mortgaged lots on still mortgaged', () => {
    const state = owing(2000, 'bo', {
      deeds: { [tanneryA]: { ownerId: 'ada', mortgaged: true } },
    });
    expect(actOk(state, { type: 'DECLARE_BANKRUPTCY' }, 'ada').deeds[tanneryA]).toMatchObject({
      ownerId: 'bo',
      mortgaged: true,
    });
  });
});

describe('bankruptcy to the bank', () => {
  /** PRD F14 — the estate is auctioned, lot by lot, in board order. */
  it('opens an auction on the first lot and queues the rest', () => {
    const state = owing(2000, null, {
      playerIds: ['ada', 'bo', 'cy'],
      deeds: {
        [tanneryB]: { ownerId: 'ada' },
        [tanneryA]: { ownerId: 'ada' },
        5: { ownerId: 'ada' },
      },
    });

    const done = actOk(state, { type: 'DECLARE_BANKRUPTCY' }, 'ada');

    expect(done.phase).toMatchObject({
      kind: 'auction',
      squareId: tanneryA,
      estateRemainingIds: [tanneryB, 5],
    });
    // The lots are back with the bank until somebody buys them.
    expect(done.deeds[tanneryA]?.ownerId).toBeNull();
  });

  it('returns lots unmortgaged, so the next owner buys them clean', () => {
    const state = owing(2000, null, {
      playerIds: ['ada', 'bo', 'cy'],
      deeds: { [tanneryA]: { ownerId: 'ada', mortgaged: true } },
    });
    expect(actOk(state, { type: 'DECLARE_BANKRUPTCY' }, 'ada').deeds[tanneryA]).toMatchObject({
      ownerId: null,
      mortgaged: false,
    });
  });

  it('puts held release cards back at the bottom of their own decks', () => {
    const state = owing(2000, null, {
      playerIds: ['ada', 'bo', 'cy'],
      players: { ada: { heldJailCards: ['chance'] } },
      decks: { chance: ['chance-01', 'chance-02'] },
    });
    const done = actOk(state, { type: 'DECLARE_BANKRUPTCY' }, 'ada');
    const order = done.decks.chance.order;
    expect(order[order.length - 1]).toBe('chance-08');
  });

  it('moves straight on when the estate holds nothing to auction', () => {
    const state = owing(2000, null, { playerIds: ['ada', 'bo', 'cy'] });
    const done = actOk(state, { type: 'DECLARE_BANKRUPTCY' }, 'ada');
    expect(done.phase.kind).not.toBe('auction');
    expect(done.players['ada']?.bankrupt).toBe(true);
  });
});

describe('victory', () => {
  /** PRD F14 — one solvent player left ends the game. */
  it('ends the game when the last opponent goes out', () => {
    const state = owing(2000, 'bo');
    const done = actOk(state, { type: 'DECLARE_BANKRUPTCY' }, 'ada');

    expect(done.phase).toEqual({ kind: 'game_over', winnerId: 'bo' });
  });

  it('reports the winner', () => {
    const result = expectOk(
      act(owing(2000, 'bo'), { type: 'DECLARE_BANKRUPTCY' }, 'ada'),
      'declaring should be legal',
    );
    expect(result.events.at(-1)).toEqual({ type: 'GAME_OVER', winnerId: 'bo' });
  });

  it('does not auction an estate when there is nobody left to bid', () => {
    const state = owing(2000, null, { deeds: { [tanneryA]: { ownerId: 'ada' } } });
    expect(actOk(state, { type: 'DECLARE_BANKRUPTCY' }, 'ada').phase).toEqual({
      kind: 'game_over',
      winnerId: 'bo',
    });
  });

  it('offers nothing to anyone once it is over', () => {
    const done = actOk(owing(2000, 'bo'), { type: 'DECLARE_BANKRUPTCY' }, 'ada');
    for (const id of done.turnOrder) {
      expect(getLegalActions(done, id)).toEqual([]);
    }
  });

  it('carries on with three players when only one goes out', () => {
    const state = owing(2000, 'bo', { playerIds: ['ada', 'bo', 'cy'] });
    const done = actOk(state, { type: 'DECLARE_BANKRUPTCY' }, 'ada');
    expect(done.phase.kind).not.toBe('game_over');
    expect(done.players['ada']?.bankrupt).toBe(true);
  });

  it('passes the turn on when the player who went out was taking it', () => {
    const state = owing(2000, 'bo', { playerIds: ['ada', 'bo', 'cy'], activeIndex: 0 });
    const done = actOk(state, { type: 'DECLARE_BANKRUPTCY' }, 'ada');
    // Ada was active and is now out, so play moves to Bo rather than stopping.
    expect(done.turnOrder[done.activeIndex]).toBe('bo');
    expect(done.turnOrder).toEqual(['ada', 'bo', 'cy']);
  });
});

describe('conceding', () => {
  it('is treated as bankruptcy to the bank', () => {
    const state = buildState({
      playerIds: ['ada', 'bo', 'cy'],
      deeds: { [tanneryA]: { ownerId: 'ada' } },
    });
    const done = actOk(state, { type: 'CONCEDE' }, 'ada');

    expect(done.players['ada']?.bankrupt).toBe(true);
    expect(done.phase).toMatchObject({ kind: 'auction', squareId: tanneryA });
  });

  it('is available on somebody else turn', () => {
    const state = buildState({ playerIds: ['ada', 'bo', 'cy'], activeIndex: 1 });
    expect(act(state, { type: 'CONCEDE' }, 'ada').ok).toBe(true);
  });

  it('ends the game when it leaves one player standing', () => {
    expect(actOk(buildState(), { type: 'CONCEDE' }, 'ada').phase).toEqual({
      kind: 'game_over',
      winnerId: 'bo',
    });
  });

  it('is refused during an auction', () => {
    const state = buildState({
      playerIds: ['ada', 'bo', 'cy'],
      phase: {
        kind: 'auction',
        squareId: 1,
        highBid: 0,
        highBidderId: null,
        activeBidderIds: ['ada', 'bo', 'cy'],
        deadlineAt: 1000,
        estateRemainingIds: [],
      },
    });
    const result = act(state, { type: 'CONCEDE' }, 'ada');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('AUCTION_IN_PROGRESS');
  });

  it('is refused while somebody else owes money', () => {
    // Conceding here would have to replace the debt phase, quietly forgiving it.
    const state = owing(200, null, { playerIds: ['ada', 'bo', 'cy'] });
    const result = act(state, { type: 'CONCEDE' }, 'bo');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('DEBT_OUTSTANDING');
  });

  it('is allowed to the debtor, as another way of giving up', () => {
    const state = owing(200, null, { playerIds: ['ada', 'bo', 'cy'] });
    expect(act(state, { type: 'CONCEDE' }, 'ada').ok).toBe(true);
  });
});
