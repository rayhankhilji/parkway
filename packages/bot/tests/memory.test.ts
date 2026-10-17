import { describe, expect, it } from 'vitest';
import {
  createGame,
  defaultBoardPackId,
  getBoardPack,
  getLegalActions,
  reduce,
  toPublicState,
  type Action,
  type GameState,
} from '@parkway/engine';
import { createBot } from '../src';

/**
 * What the bot remembers between decisions.
 *
 * Callers are allowed to ask for a move and then not play it — the solo driver
 * does whenever someone else moves during the bot's thinking pause. Nothing the
 * bot remembers may depend on a move it chose actually having been made.
 */

const bot = 'bot';
const human = 'human';

/** The bot's turn, rolled already, one lot short of a group the human completes. */
function wantingATrade(): GameState {
  const created = createGame({
    playerIds: [bot, human],
    boardPackId: defaultBoardPackId,
    seed: 1,
    config: {
      startingCash: 1500,
      salary: 200,
      freeParkingPot: false,
      incomeTaxMode: 'flat',
      auctionOnDecline: true,
      auctionSeconds: 10,
    },
  });
  if (!created.ok) throw new Error(created.error.message);

  const group = getBoardPack(defaultBoardPackId).groups.find((g) => g.memberIds.length === 2);
  if (group === undefined) throw new Error('no two-lot group');
  const [mine, theirs] = group.memberIds;
  if (mine === undefined || theirs === undefined) throw new Error('bad group');

  const state = created.value;
  const deeds = { ...state.deeds };
  for (const [id, owner] of [
    [mine, bot],
    [theirs, human],
  ] as const) {
    const deed = deeds[id];
    if (deed !== undefined) deeds[id] = { ...deed, ownerId: owner };
  }

  return {
    ...state,
    deeds,
    turnOrder: [bot, human],
    activeIndex: 0,
    phase: { kind: 'awaiting_end_turn' },
    turn: { ...state.turn, hasRolled: true },
  };
}

function ask(decider: ReturnType<typeof createBot>, state: GameState): Action | null {
  return decider.decide({
    state: toPublicState(state),
    playerId: bot,
    legalActions: getLegalActions(state, bot),
    now: 0,
  });
}

function play(state: GameState, playerId: string, action: Action): GameState {
  const result = reduce(state, action, { playerId, now: 0 });
  if (!result.ok) throw new Error(result.error.message);
  return result.value.state;
}

describe('trade memory', () => {
  it('does not re-offer a refused deal after choosing an end of turn that was never played', () => {
    const decider = createBot(bot, 'steady', 1);
    let state = wantingATrade();

    const offer = ask(decider, state);
    expect(offer?.type).toBe('OFFER_TRADE');
    if (offer === null) return;
    state = play(state, bot, offer);

    // With its offer open the bot would end its turn, but the human answers
    // first and that decision is thrown away unplayed.
    expect(ask(decider, state)?.type).toBe('END_TURN');
    state = play(state, human, { type: 'DECLINE_TRADE' });

    expect(ask(decider, state)?.type).toBe('END_TURN');
  });

  it('may try again once the turn has moved on', () => {
    const decider = createBot(bot, 'steady', 1);
    let state = wantingATrade();

    const offer = ask(decider, state);
    if (offer === null) throw new Error('expected an offer');
    state = play(state, bot, offer);
    state = play(state, human, { type: 'DECLINE_TRADE' });
    expect(ask(decider, state)?.type).toBe('END_TURN');

    // The human's turn, seen by the bot, then the bot's own again.
    ask(decider, { ...state, activeIndex: 1, phase: { kind: 'awaiting_roll' } });
    expect(ask(decider, state)?.type).toBe('OFFER_TRADE');
  });
});
