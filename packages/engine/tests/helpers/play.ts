import type { Action } from '../../src/actions/types.js';
import type { RuleViolation } from '../../src/errors.js';
import type { GameEvent } from '../../src/events/types.js';
import { getLegalActions } from '../../src/legalActions.js';
import { reduce } from '../../src/reduce.js';
import type { GameState, PlayerId } from '../../src/state/types.js';
import { activePlayerId } from '../../src/state/selectors.js';

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
export function playForward(
  state: GameState,
  maxActions: number,
): { state: GameState; events: readonly GameEvent[]; actions: number } {
  let current = state;
  const events: GameEvent[] = [];

  for (let count = 0; count < maxActions; count += 1) {
    if (current.phase.kind === 'game_over') {
      return { state: current, events, actions: count };
    }

    const playerId = activePlayerId(current);
    const legal = getLegalActions(current, playerId);
    const next = legal[0];
    if (next === undefined) {
      return { state: current, events, actions: count };
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

  return { state: current, events, actions: maxActions };
}

function toAction(type: string): Action {
  switch (type) {
    case 'ROLL_DICE':
      return { type: 'ROLL_DICE' };
    case 'ROLL_FOR_JAIL':
      return { type: 'ROLL_FOR_JAIL' };
    case 'END_TURN':
      return { type: 'END_TURN' };
    default:
      throw new Error(`playForward does not know how to build a ${type} action`);
  }
}
