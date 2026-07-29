import { violation, type RuleViolation } from '../errors.js';
import type { GameEvent } from '../events/types.js';
import { err, ok, type Result } from '../result.js';
import type { GameState } from '../state/types.js';
import { activePlayerId, boardOf, diceTotal, getPlayer, isDouble } from '../state/selectors.js';
import { advanceBy } from '../rules/movement.js';
import { payOrEnterDebt } from '../rules/payment.js';
import { drawDice, resolveLanding, type PhaseResult } from './roll.js';

/**
 * Trying to roll your way out of the gaol.
 *
 * Two details separate this from a normal roll. Doubles release the player and
 * move them that many squares, but grant no extra roll — the turn ends after the
 * square resolves (→ PRD F9). And on the final failed attempt the fine stops
 * being optional: it is deducted and the player moves on that same roll rather
 * than sitting out another turn.
 *
 * Paying the fine voluntarily and spending a held release card are separate
 * actions that arrive with the rest of F9.
 */
export function handleRollForJail(state: GameState): Result<PhaseResult, RuleViolation> {
  if (state.phase.kind !== 'awaiting_jail_decision') {
    return err(violation('WRONG_PHASE', 'You are not deciding how to leave the gaol.'));
  }

  const playerId = activePlayerId(state);
  const player = getPlayer(state, playerId);
  if (!player.inJail) {
    return err(violation('NOT_IN_JAIL', 'You are not in the gaol.'));
  }

  const pack = boardOf(state);
  const { roll, rng } = drawDice(state);
  const events: GameEvent[] = [
    { type: 'DICE_ROLLED', playerId, dice: roll, isDouble: isDouble(roll) },
  ];

  const rolled: GameState = {
    ...state,
    rng,
    // Doubles rolled in the gaol never grant another roll, so the counter that
    // tracks them on a normal turn stays at zero.
    turn: { doublesCount: 0, hasRolled: true, lastRoll: roll },
  };

  if (isDouble(roll)) {
    const released = releaseFromJail(rolled, playerId, 'doubles');
    const moved = advanceBy(released.state, playerId, diceTotal(roll));
    return ok(
      resolveLanding(moved.state, playerId, [...events, ...released.events, ...moved.events], {
        grantsAnotherRoll: false,
      }),
    );
  }

  const attempts = player.jailAttempts + 1;
  const failed: GameState = {
    ...rolled,
    players: { ...rolled.players, [playerId]: { ...player, jailAttempts: attempts } },
  };
  events.push({ type: 'JAIL_ATTEMPT_FAILED', playerId, attempt: attempts });

  if (attempts < pack.jail.maxTurns) {
    return ok({ state: { ...failed, phase: { kind: 'awaiting_end_turn' } }, events });
  }

  // Out of attempts. The fine is now compulsory, and the player moves on the
  // roll that just failed.
  const payment = payOrEnterDebt(failed, playerId, null, pack.jail.fine, {
    kind: 'awaiting_end_turn',
  });
  events.push(...payment.events);

  if (payment.enteredDebt) {
    // The fine is owed but unpaid, so the player is still inside. Settling the
    // debt releases them; that is the debt handler's job.
    return ok({ state: payment.state, events });
  }

  const released = releaseFromJail(payment.state, playerId, 'forced_fine');
  const moved = advanceBy(released.state, playerId, diceTotal(roll));
  return ok(
    resolveLanding(moved.state, playerId, [...events, ...released.events, ...moved.events], {
      grantsAnotherRoll: false,
    }),
  );
}

export function releaseFromJail(
  state: GameState,
  playerId: string,
  method: 'fine' | 'card' | 'doubles' | 'forced_fine',
): { state: GameState; events: readonly GameEvent[] } {
  const player = getPlayer(state, playerId);
  return {
    state: {
      ...state,
      players: {
        ...state.players,
        [playerId]: { ...player, inJail: false, jailAttempts: 0 },
      },
    },
    events: [{ type: 'LEFT_JAIL', playerId, method }],
  };
}
