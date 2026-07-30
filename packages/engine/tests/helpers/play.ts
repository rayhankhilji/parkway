import type { Action } from '../../src/actions/types';
import type { RuleViolation } from '../../src/errors';
import type { GameEvent } from '../../src/events/types';
import { getLegalActions } from '../../src/legalActions';
import { reduce } from '../../src/reduce';
import type { GameState, PlayerId } from '../../src/state/types';
import { activePlayerId } from '../../src/state/selectors';

/**
 * Playing a sequence of actions in a test.
 *
 * Multi-action rules are the ones that break — a debt opened by a card and
 * settled two actions later, an auction that outlives the turn that started it.
 * Asserting those one reduce() call at a time buries the interesting line in
 * plumbing, so this runs a script and hands back the end state.
 *
 * It refuses by default. A step that the engine rejects fails the test on the
 * spot, naming the step and the violation, because a script that silently
 * stopped applying halfway through would otherwise pass its final assertion
 * against a state nobody intended.
 */

export type Step = {
  readonly action: Action;
  /** Defaults to whoever's turn it is. */
  readonly by?: PlayerId;
  /** Server-stamped time for this action. Only deadlines read it. */
  readonly now?: number;
};

export type PlayResult = {
  readonly state: GameState;
  readonly events: readonly GameEvent[];
  /** Events grouped by the step that produced them, for order-sensitive checks. */
  readonly byStep: readonly (readonly GameEvent[])[];
};

export class ScriptFailure extends Error {
  constructor(
    readonly index: number,
    readonly step: Step,
    readonly violation: RuleViolation,
  ) {
    super(
      `Step ${index} (${step.action.type}) was refused: ${violation.code} — ${violation.message}`,
    );
    this.name = 'ScriptFailure';
  }
}

export function play(state: GameState, steps: readonly Step[]): PlayResult {
  let current = state;
  const events: GameEvent[] = [];
  const byStep: GameEvent[][] = [];

  steps.forEach((step, index) => {
    const playerId = step.by ?? activePlayerId(current);
    const result = reduce(current, step.action, { playerId, now: step.now ?? 0 });

    if (!result.ok) {
      throw new ScriptFailure(index, step, result.error);
    }

    current = result.value.state;
    events.push(...result.value.events);
    byStep.push([...result.value.events]);
  });

  return { state: current, events, byStep };
}

/** A script step, written so tests read as a sequence of moves. */
export function step(action: Action, options: Omit<Step, 'action'> = {}): Step {
  return { action, ...options };
}

/**
 * Plays until the game can go no further, taking the first legal action offered
 * to whoever is due to act.
 *
 * Used to drive long scripted runs without hand-writing hundreds of steps. It is
 * not a bot: it makes no choices, it takes what it is given, which is exactly
 * what makes it useful for asserting that the loop never stalls.
 */
export type ForwardResult = {
  readonly state: GameState;
  readonly events: readonly GameEvent[];
  readonly actions: number;
  /**
   * Why it stopped. `blocked` means the active player was offered nothing, which
   * during the build means the game reached a phase whose actions do not exist
   * yet — worth reporting rather than silently treating as a finished run.
   */
  readonly stopped: 'limit' | 'game_over' | 'blocked';
};

export function playForward(state: GameState, maxActions: number): ForwardResult {
  let current = state;
  const events: GameEvent[] = [];

  for (let count = 0; count < maxActions; count += 1) {
    if (current.phase.kind === 'game_over') {
      return { state: current, events, actions: count, stopped: 'game_over' };
    }

    const playerId = activePlayerId(current);
    const legal = getLegalActions(current, playerId);
    const next = legal[0];
    if (next === undefined) {
      return { state: current, events, actions: count, stopped: 'blocked' };
    }

    const result = reduce(current, toAction(next.type), { playerId, now: 0 });
    if (!result.ok) {
      throw new Error(
        `playForward was offered ${next.type} but the reducer refused it: ${result.error.code}`,
      );
    }

    current = result.value.state;
    events.push(...result.value.events);
  }

  return { state: current, events, actions: maxActions, stopped: 'limit' };
}

/**
 * Clears any purchase decision by declining it, so a test about turn flow is not
 * derailed by landing on something for sale.
 *
 * Declining rather than buying keeps the board empty, which means no rent is
 * charged either — the point is to isolate movement and phase handling from
 * everything a square might do.
 */
export function declineAnyPurchase(state: GameState): GameState {
  let current = state;
  for (let guard = 0; guard < 8; guard += 1) {
    if (current.phase.kind !== 'awaiting_purchase') return current;
    const result = reduce(
      current,
      { type: 'DECLINE_PURCHASE' },
      { playerId: activePlayerId(current), now: 0 },
    );
    if (!result.ok) {
      throw new Error(`Declining a purchase was refused: ${result.error.code}`);
    }
    current = result.value.state;
  }
  throw new Error('Purchases kept appearing; something is not advancing');
}

/** Rolls, then clears whatever the landing asked for. Returns the settled state. */
export function rollAndSettle(state: GameState, playerId?: PlayerId): GameState {
  const actor = playerId ?? activePlayerId(state);
  const action: Action =
    state.phase.kind === 'awaiting_jail_decision'
      ? { type: 'ROLL_FOR_JAIL' }
      : { type: 'ROLL_DICE' };

  const result = reduce(state, action, { playerId: actor, now: 0 });
  if (!result.ok) {
    throw new Error(`${action.type} was refused: ${result.error.code}`);
  }
  return declineAnyPurchase(result.value.state);
}

function toAction(type: string): Action {
  switch (type) {
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
    default:
      throw new Error(`playForward does not know how to build a ${type} action`);
  }
}
