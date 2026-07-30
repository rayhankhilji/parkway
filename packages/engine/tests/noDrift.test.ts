import { describe, expect, it } from 'vitest';
import type { Action, LegalAction } from '../src/actions/types';
import { getLegalActions } from '../src/legalActions';
import { reduce } from '../src/reduce';
import type { GameState } from '../src/state/types';
import { buildState, ownGroup } from './helpers/buildState';

/**
 * The property that keeps the UI and the server in step.
 *
 * The reducer no longer gates every action through getLegalActions, because doing
 * so cost the precise refusal message — an unaffordable purchase answered "wrong
 * phase" instead of "you cannot afford that". What replaced that gate is this
 * one-directional guarantee, asserted rather than assumed:
 *
 *   everything getLegalActions offers a player, reduce accepts from them.
 *
 * A button that appears and then fails is the failure mode worth preventing. The
 * converse — an action reduce accepts but the UI does not offer — is fine and
 * sometimes deliberate, since the UI hides choices a player cannot use.
 */

/** Builds the action a legal-action entry describes, for the ones with no arguments. */
function actionFor(legal: LegalAction): Action | null {
  switch (legal.type) {
    case 'ROLL_DICE':
      return { type: 'ROLL_DICE' };
    case 'ROLL_FOR_JAIL':
      return { type: 'ROLL_FOR_JAIL' };
    case 'END_TURN':
      return { type: 'END_TURN' };
    case 'BUY_PROPERTY':
      return { type: 'BUY_PROPERTY' };
    case 'DECLINE_PURCHASE':
      return { type: 'DECLINE_PURCHASE' };
    case 'PAY_JAIL_FINE':
      return { type: 'PAY_JAIL_FINE' };
    case 'USE_JAIL_CARD':
      return { type: 'USE_JAIL_CARD' };
    case 'PASS_BID':
      return { type: 'PASS_BID' };

    // These advertise the squares they apply to, so every one of them can be
    // checked rather than taken on trust. If getLegalActions lists a lot as
    // buildable, building on it must be accepted.
    case 'BUILD_HOUSE':
      return firstSquare(legal.squareIds, 'BUILD_HOUSE');
    case 'SELL_HOUSE':
      return firstSquare(legal.squareIds, 'SELL_HOUSE');
    case 'MORTGAGE':
      return firstSquare(legal.squareIds, 'MORTGAGE');
    case 'UNMORTGAGE':
      return firstSquare(legal.squareIds, 'UNMORTGAGE');

    default:
      // Entries that carry a free-form choice — a bid amount, a composed trade —
      // are covered by the tests for the rules that produce them.
      return null;
  }
}

function firstSquare(
  squareIds: readonly number[],
  type: 'BUILD_HOUSE' | 'SELL_HOUSE' | 'MORTGAGE' | 'UNMORTGAGE',
): Action | null {
  const squareId = squareIds[0];
  return squareId === undefined ? null : { type, squareId };
}

/** Every square an offered management action names, not just the first. */
function allSquareActions(legal: LegalAction): readonly Action[] {
  switch (legal.type) {
    case 'BUILD_HOUSE':
    case 'SELL_HOUSE':
    case 'MORTGAGE':
    case 'UNMORTGAGE':
      return legal.squareIds.map((squareId) => ({ type: legal.type, squareId }));
    default:
      return [];
  }
}

const positions: ReadonlyArray<{ readonly name: string; readonly state: GameState }> = [
  { name: 'awaiting a roll', state: buildState() },
  {
    name: 'deciding on a purchase they can afford',
    state: buildState({
      players: { ada: { position: 1 } },
      phase: { kind: 'awaiting_purchase', squareId: 1 },
    }),
  },
  {
    name: 'deciding on a purchase they cannot afford',
    state: buildState({
      players: { ada: { position: 39, cash: 10 } },
      phase: { kind: 'awaiting_purchase', squareId: 39 },
    }),
  },
  {
    name: 'in the gaol',
    state: buildState({
      players: { ada: { inJail: true, position: 10 } },
      phase: { kind: 'awaiting_jail_decision' },
    }),
  },
  {
    name: 'on the last gaol attempt',
    state: buildState({
      players: { ada: { inJail: true, position: 10, jailAttempts: 2 } },
      phase: { kind: 'awaiting_jail_decision' },
    }),
  },
  { name: 'ready to end the turn', state: buildState({ phase: { kind: 'awaiting_end_turn' } }) },
  {
    name: 'holding a complete group they can build on',
    state: buildState({ deeds: ownGroup('group-1', 'ada') }),
  },
  {
    name: 'holding a developed group they can sell from',
    state: buildState({ deeds: ownGroup('group-1', 'ada', { houses: 2 }) }),
  },
  {
    name: 'holding a mortgaged lot they can redeem',
    state: buildState({ deeds: { 1: { ownerId: 'ada', mortgaged: true } } }),
  },
  {
    name: 'holding a lot on somebody else turn',
    state: buildState({ activeIndex: 1, deeds: ownGroup('group-2', 'ada') }),
  },
];

describe('everything offered is accepted', () => {
  for (const { name, state } of positions) {
    it(`holds for a player ${name}`, () => {
      for (const id of state.turnOrder) {
        for (const legal of getLegalActions(state, id)) {
          // Every square a management action names is checked, not just the
          // first: a selector that offers four lots and means three is exactly
          // the drift this test exists to catch.
          const candidates = [...allSquareActions(legal)];
          const single = allSquareActions(legal).length === 0 ? actionFor(legal) : null;
          if (single !== null) candidates.push(single);

          for (const action of candidates) {
            const result = reduce(state, action, { playerId: id, now: 0 });
            if (!result.ok) {
              throw new Error(
                `getLegalActions offered ${legal.type} to ${id} but reduce refused it: ` +
                  `${result.error.code} — ${result.error.message}`,
              );
            }
          }
        }
      }
    });
  }

  it('holds across a long played-out game', () => {
    // The positions above are hand-built. This one walks a real game and checks
    // the property at every step, which reaches states nobody thought to write
    // down.
    let state = buildState({ playerIds: ['ada', 'bo', 'cy'], seed: 616161 });

    for (let step = 0; step < 300; step += 1) {
      if (state.phase.kind === 'game_over') break;

      // Every offer is checked against the same snapshot. Advancing mid-loop
      // would test a later player's offer against a state that had already moved
      // on, which is a different and much weaker claim.
      const snapshot = state;
      let next: GameState | null = null;

      for (const id of snapshot.turnOrder) {
        for (const legal of getLegalActions(snapshot, id)) {
          const action = actionFor(legal);
          if (action === null) continue;

          const result = reduce(snapshot, action, { playerId: id, now: 0 });
          if (!result.ok) {
            throw new Error(
              `At step ${step}, ${legal.type} was offered to ${id} and refused: ${result.error.code}`,
            );
          }
          next ??= result.value.state;
        }
      }

      if (next === null) break;
      state = next;
    }

    expect(state.phase.kind).toBeTruthy();
  });
});

describe('nothing is offered to someone who cannot act', () => {
  it('offers nothing to a player who is out', () => {
    const state = buildState({ players: { ada: { bankrupt: true } } });
    expect(getLegalActions(state, 'ada')).toEqual([]);
  });

  it('offers nothing once the game is over', () => {
    const state = buildState({ phase: { kind: 'game_over', winnerId: 'ada' } });
    for (const id of state.turnOrder) {
      expect(getLegalActions(state, id)).toEqual([]);
    }
  });

  it('offers a debtor only the ways to raise money, and everyone else nothing', () => {
    // PRD F12: a debt blocks the debtor's ordinary play but not their ability to
    // sell, mortgage and trade — that is the whole point of the phase. Everyone
    // else waits.
    const state = buildState({
      players: { ada: { cash: 10 } },
      deeds: { 1: { ownerId: 'ada' }, 3: { ownerId: 'ada' } },
      phase: {
        kind: 'awaiting_debt',
        debtorId: 'ada',
        creditorId: 'bo',
        amount: 50,
        interrupted: { kind: 'awaiting_end_turn' },
        remaining: [],
      },
    });

    expect(getLegalActions(state, 'ada').map((action) => action.type)).toEqual([
      'MORTGAGE',
      'OFFER_TRADE',
    ]);
    expect(getLegalActions(state, 'bo')).toEqual([]);
  });
});
