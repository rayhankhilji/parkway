import { describe, expect, it } from 'vitest';
import { getBoardPack } from '../../src/board/registry';
import { advanceBy, moveToSquare, sendToJail, squareAfter } from '../../src/rules/movement';
import { buildState } from '../helpers/buildState';

const pack = getBoardPack('parkway-classic');
const size = pack.squares.length;

/**
 * Movement, and the salary rule hanging off it.
 *
 * Salary is paid for passing or landing on the start square, and only when
 * travelling forwards. Direction is an explicit input rather than something
 * inferred from distance, because a card that sends a player backwards past the
 * start must pay nothing — and on this board no Fortune square sits close enough
 * to the start for the "go back three" card to reach it, so the rule can only be
 * exercised here.
 */

describe('squareAfter', () => {
  it('walks forwards', () => {
    expect(squareAfter(buildState(), 0, 7)).toBe(7);
  });

  it('wraps forwards past the end', () => {
    expect(squareAfter(buildState(), 38, 5)).toBe(3);
  });

  it('wraps backwards past the start', () => {
    expect(squareAfter(buildState(), 2, -5)).toBe(size - 3);
  });

  it('lands exactly on the start square', () => {
    expect(squareAfter(buildState(), 36, 4)).toBe(0);
  });
});

describe('advanceBy going forwards', () => {
  it('pays salary when it wraps the board', () => {
    const state = buildState({ players: { ada: { position: 38, cash: 0 } } });
    const moved = advanceBy(state, 'ada', 5);
    expect(moved.state.players['ada']?.position).toBe(3);
    expect(moved.state.players['ada']?.cash).toBe(200);
  });

  it('pays salary when it lands exactly on the start square', () => {
    const state = buildState({ players: { ada: { position: 36, cash: 0 } } });
    const moved = advanceBy(state, 'ada', 4);
    expect(moved.state.players['ada']?.position).toBe(0);
    expect(moved.state.players['ada']?.cash).toBe(200);
  });

  it('pays nothing when it stops short of the start', () => {
    const state = buildState({ players: { ada: { position: 30, cash: 0 } } });
    const moved = advanceBy(state, 'ada', 5);
    expect(moved.state.players['ada']?.position).toBe(35);
    expect(moved.state.players['ada']?.cash).toBe(0);
  });

  it('reports the crossing on the move event', () => {
    const state = buildState({ players: { ada: { position: 38, cash: 0 } } });
    const moved = advanceBy(state, 'ada', 5);
    expect(moved.events[0]).toEqual({
      type: 'TOKEN_MOVED',
      playerId: 'ada',
      from: 38,
      to: 3,
      passedStart: true,
    });
  });

  it('honours a configured salary of a different size', () => {
    const state = buildState({
      config: { salary: 400 },
      players: { ada: { position: 38, cash: 0 } },
    });
    expect(advanceBy(state, 'ada', 5).state.players['ada']?.cash).toBe(400);
  });
});

describe('advanceBy going backwards', () => {
  /** PRD F10 — a card sending a player backwards past the start pays nothing. */
  it('pays no salary when it wraps back past the start', () => {
    const state = buildState({ players: { ada: { position: 2, cash: 0 } } });
    const moved = advanceBy(state, 'ada', -5);
    expect(moved.state.players['ada']?.position).toBe(size - 3);
    expect(moved.state.players['ada']?.cash).toBe(0);
    expect(moved.events[0]).toMatchObject({ passedStart: false });
  });

  it('pays no salary when it lands on the start square from ahead of it', () => {
    const state = buildState({ players: { ada: { position: 3, cash: 0 } } });
    const moved = advanceBy(state, 'ada', -3);
    expect(moved.state.players['ada']?.position).toBe(0);
    expect(moved.state.players['ada']?.cash).toBe(0);
  });

  it('pays nothing for an ordinary step backwards', () => {
    const state = buildState({ players: { ada: { position: 20, cash: 0 } } });
    expect(advanceBy(state, 'ada', -3).state.players['ada']?.cash).toBe(0);
  });
});

describe('moveToSquare', () => {
  it('pays salary only when told to', () => {
    const state = buildState({ players: { ada: { position: 30, cash: 0 } } });
    expect(moveToSquare(state, 'ada', 5, { collectSalary: true }).state.players['ada']?.cash).toBe(
      200,
    );
    expect(moveToSquare(state, 'ada', 5, { collectSalary: false }).state.players['ada']?.cash).toBe(
      0,
    );
  });

  it('leaves every other player alone', () => {
    const state = buildState({ players: { ada: { position: 0 }, bo: { position: 12 } } });
    const moved = moveToSquare(state, 'ada', 20, { collectSalary: false });
    expect(moved.state.players['bo']?.position).toBe(12);
  });
});

describe('sendToJail', () => {
  it('puts the player on the gaol square and marks them inside', () => {
    const state = buildState({ players: { ada: { position: 25 } } });
    const jailed = sendToJail(state, 'ada', 'square');
    expect(jailed.state.players['ada']?.position).toBe(pack.jail.squareId);
    expect(jailed.state.players['ada']?.inJail).toBe(true);
    expect(jailed.state.players['ada']?.jailAttempts).toBe(0);
  });

  it('pays no salary however far the trip to the gaol is', () => {
    const state = buildState({ players: { ada: { position: 39, cash: 0 } } });
    expect(sendToJail(state, 'ada', 'card').state.players['ada']?.cash).toBe(0);
  });

  it('clears any attempts from a previous sentence', () => {
    const state = buildState({ players: { ada: { jailAttempts: 2 } } });
    expect(sendToJail(state, 'ada', 'three_doubles').state.players['ada']?.jailAttempts).toBe(0);
  });

  it('records why they were sent', () => {
    const state = buildState();
    expect(sendToJail(state, 'ada', 'three_doubles').events[0]).toEqual({
      type: 'SENT_TO_JAIL',
      playerId: 'ada',
      reason: 'three_doubles',
    });
  });
});
