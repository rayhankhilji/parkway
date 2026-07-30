import type { Action, LegalAction } from '../../src/actions/types';
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

    // During an auction the player who can act is not the turn holder, so the
    // whole roster is asked rather than assuming whose move it is.
    const candidates =
      current.phase.kind === 'auction' ? current.turnOrder : [activePlayerId(current)];

    let playerId: PlayerId | null = null;
    let next: LegalAction | undefined;
    for (const candidate of candidates) {
      const offered = getLegalActions(current, candidate);
      if (offered.length > 0) {
        playerId = candidate;
        next = offered[0];
        break;
      }
    }

    if (playerId === null || next === undefined) {
      return { state: current, events, actions: count, stopped: 'blocked' };
    }

    const action = toAction(next);
    if (action === null) {
      return { state: current, events, actions: count, stopped: 'blocked' };
    }

    const result = reduce(current, action, { playerId, now: 0 });
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
 * Clears whatever a landing asked for, so a test about turn flow is not derailed
 * by what happened to be on the square.
 *
 * Purchases are declined and the resulting auction is passed out by everybody, so
 * the board stays empty and no rent is charged either. The point is to isolate
 * movement and phase handling from everything a square might do.
 */
export function declineAnyPurchase(state: GameState): GameState {
  let current = state;

  for (let guard = 0; guard < 40; guard += 1) {
    if (current.phase.kind === 'awaiting_purchase') {
      current = apply(current, { type: 'DECLINE_PURCHASE' }, activePlayerId(current));
      continue;
    }

    if (current.phase.kind === 'auction') {
      const phase = current.phase;
      const next = phase.activeBidderIds.find((id) => id !== phase.highBidderId);
      if (next === undefined) {
        throw new Error('An auction is stuck with nobody able to pass');
      }
      current = apply(current, { type: 'PASS_BID' }, next);
      continue;
    }

    return current;
  }

  throw new Error('Obligations kept appearing; something is not advancing');
}

function apply(state: GameState, action: Action, playerId: PlayerId): GameState {
  const result = reduce(state, action, { playerId, now: 0 });
  if (!result.ok) {
    throw new Error(`${action.type} was refused: ${result.error.code} — ${result.error.message}`);
  }
  return result.value.state;
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

/**
 * Turns an offered action into a postable one.
 *
 * Where a choice is involved it takes the least committal option — the minimum
 * bid — because the point of forward play is to keep the loop moving, not to play
 * well.
 */
function toAction(legal: LegalAction): Action | null {
  switch (legal.type) {
    case 'ROLL_DICE':
      return { type: 'ROLL_DICE' };
    case 'ROLL_FOR_JAIL':
      return { type: 'ROLL_FOR_JAIL' };
    case 'PAY_JAIL_FINE':
      return { type: 'PAY_JAIL_FINE' };
    case 'USE_JAIL_CARD':
      return { type: 'USE_JAIL_CARD' };
    case 'END_TURN':
      return { type: 'END_TURN' };
    case 'BUY_PROPERTY':
      return { type: 'BUY_PROPERTY' };
    case 'DECLINE_PURCHASE':
      return { type: 'DECLINE_PURCHASE' };
    case 'PLACE_BID':
      return { type: 'PLACE_BID', amount: legal.minimum };
    case 'PASS_BID':
      return { type: 'PASS_BID' };
    default:
      return null;
  }
}
