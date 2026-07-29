import { getSquare } from '../board/lookup';
import type { SquareId } from '../board/types';
import type { GameEvent } from '../events/types';
import type { GameState, PlayerId } from '../state/types';
import { boardOf, getPlayer } from '../state/selectors';
import { credit } from './payment';

/**
 * Moving a token, and the one thing that hangs off it: passing the start square.
 *
 * Salary is paid for passing *or* landing on the start square, and only when
 * travelling forwards. A card that sends a player backwards past it pays nothing
 * (→ PRD F10), which is why direction is a parameter here rather than something
 * inferred from the distance travelled.
 */

export type MoveResult = {
  readonly state: GameState;
  readonly events: readonly GameEvent[];
};

/** Where a player ends up after travelling `steps` squares forward. */
export function squareAfter(state: GameState, from: SquareId, steps: number): SquareId {
  const size = boardOf(state).squares.length;
  return (((from + steps) % size) + size) % size;
}

/**
 * Advances a token a number of squares, paying salary if it passes the start.
 *
 * `steps` may be negative, in which case no salary is paid however far back the
 * token travels.
 */
export function advanceBy(state: GameState, playerId: PlayerId, steps: number): MoveResult {
  const from = getPlayer(state, playerId).position;
  const size = boardOf(state).squares.length;
  // Travelling forward passes the start square exactly when the unwrapped
  // destination runs off the end of the board. Going backwards never does.
  const collectSalary = steps > 0 && from + steps >= size;
  return moveToSquare(state, playerId, squareAfter(state, from, steps), { collectSalary });
}

export type MoveOptions = {
  /** Whether passing or landing on the start square pays this move's salary. */
  readonly collectSalary: boolean;
};

/** Puts a token on a specific square, optionally paying the salary for the trip. */
export function moveToSquare(
  state: GameState,
  playerId: PlayerId,
  to: SquareId,
  options: MoveOptions,
): MoveResult {
  const pack = boardOf(state);
  const from = getPlayer(state, playerId).position;
  const events: GameEvent[] = [];

  let next: GameState = {
    ...state,
    players: {
      ...state.players,
      [playerId]: { ...getPlayer(state, playerId), position: to },
    },
  };

  events.push({ type: 'TOKEN_MOVED', playerId, from, to, passedStart: options.collectSalary });

  if (options.collectSalary) {
    next = credit(next, playerId, state.config.salary);
    events.push({ type: 'SALARY_PAID', playerId, amount: state.config.salary });
  }

  // Landing on the start square itself is covered by collectSalary, so nothing
  // extra happens here. The square is checked only to keep the pack honest.
  getSquare(pack, to);

  return { state: next, events };
}

/**
 * Sends a player to the gaol: no movement past it, no salary, no resolution of
 * whatever square they would otherwise have reached.
 */
export function sendToJail(
  state: GameState,
  playerId: PlayerId,
  reason: 'square' | 'card' | 'three_doubles',
): MoveResult {
  const pack = boardOf(state);
  const player = getPlayer(state, playerId);

  return {
    state: {
      ...state,
      players: {
        ...state.players,
        [playerId]: {
          ...player,
          position: pack.jail.squareId,
          inJail: true,
          jailAttempts: 0,
        },
      },
    },
    events: [{ type: 'SENT_TO_JAIL', playerId, reason }],
  };
}
