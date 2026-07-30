import { violation, type RuleViolation } from '../errors';
import type { GameEvent } from '../events/types';
import { err, ok, type Result } from '../result';
import { rollDie, type RngState } from '../rng/mulberry32';
import type { ActionMeta } from '../actions/types';
import type { DiceRoll, GameState, PlayerId } from '../state/types';
import { activePlayerId, boardOf, diceTotal, isDouble } from '../state/selectors';
import { advanceBy, sendToJail } from '../rules/movement';
import { resolveSquare } from '../rules/resolveSquare';
import { phaseAfterObligations, type PhaseResult } from './turnFlow';

export type { PhaseResult };

/**
 * Rolls the dice from the state's own generator.
 *
 * Shared with the gaol handler, which rolls under different rules but from the
 * same generator — the sequence of numbers a game produces must not depend on why
 * a player happened to be rolling.
 */
export function drawDice(state: GameState): { roll: DiceRoll; rng: RngState } {
  const pack = boardOf(state);
  const [first, afterFirst] = rollDie(state.rng, pack.dice.faces);
  const [second, afterSecond] = rollDie(afterFirst, pack.dice.faces);
  return { roll: [first, second], rng: afterSecond };
}

/**
 * A normal roll on a player's own turn.
 *
 * The awkward rule is the third double. It sends the player to the gaol with no
 * movement at all and no resolution of whatever the third roll would have landed
 * on — the roll is counted, then discarded (→ PRD F4). Implementations get this
 * wrong by moving first and jailing afterwards, which produces the right final
 * square and the wrong everything else: salary collected on the way, and a square
 * resolved that should never have been reached.
 */
export function handleRollDice(
  state: GameState,
  meta: ActionMeta,
): Result<PhaseResult, RuleViolation> {
  if (state.phase.kind !== 'awaiting_roll') {
    return err(violation('WRONG_PHASE', 'You cannot roll right now.'));
  }

  const playerId = activePlayerId(state);
  const { roll, rng } = drawDice(state);
  const double = isDouble(roll);
  // Reset to zero on a plain roll. That is what lets a non-zero count mean "the
  // last roll was a double", which turnFlow reads to decide on the extra roll.
  const doublesCount = double ? state.turn.doublesCount + 1 : 0;

  const events: GameEvent[] = [{ type: 'DICE_ROLLED', playerId, dice: roll, isDouble: double }];

  const rolled: GameState = {
    ...state,
    rng,
    turn: { doublesCount, hasRolled: true, lastRoll: roll },
  };

  if (double && doublesCount >= 3) {
    const jailed = sendToJail(rolled, playerId, 'three_doubles');
    return ok({
      state: { ...jailed.state, phase: { kind: 'awaiting_end_turn' } },
      events: [...events, ...jailed.events],
    });
  }

  const moved = advanceBy(rolled, playerId, diceTotal(roll));
  events.push(...moved.events);

  return ok(landAndContinue(moved.state, playerId, events, roll, meta));
}

/**
 * Resolves the square a token has come to rest on, then decides where the turn
 * goes.
 *
 * If the square halted the game — a purchase to decide, a debt to settle, a trip
 * to the gaol — the phase it set is left alone. Otherwise the turn continues, and
 * whether that means another roll is turnFlow's call.
 */
export function landAndContinue(
  state: GameState,
  playerId: PlayerId,
  events: readonly GameEvent[],
  causingRoll: DiceRoll | null,
  meta: ActionMeta,
): PhaseResult {
  const landing = resolveSquare(state, playerId, {
    causingRoll,
    depth: 0,
    viaCard: false,
    now: meta.now,
  });
  const combined = [...events, ...landing.events];

  if (landing.halted) {
    return { state: landing.state, events: combined };
  }

  return {
    state: { ...landing.state, phase: phaseAfterObligations(landing.state) },
    events: combined,
  };
}
