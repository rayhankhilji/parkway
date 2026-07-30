import { violation, type RuleViolation } from '../errors';
import type { GameEvent } from '../events/types';
import { err, ok, type Result } from '../result';
import type { GameState } from '../state/types';
import { activePlayerId, boardOf, diceTotal, getPlayer, isDouble } from '../state/selectors';
import { advanceBy } from '../rules/movement';
import { payOrEnterDebt } from '../rules/payment';
import { returnCardToBottom } from '../cards/deck';
import type { ActionMeta } from '../actions/types';
import { drawDice, landAndContinue } from './roll';
import type { PhaseResult } from './turnFlow';

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
export function handleRollForJail(
  state: GameState,
  meta: ActionMeta,
): Result<PhaseResult, RuleViolation> {
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
      landAndContinue(
        moved.state,
        playerId,
        [...events, ...released.events, ...moved.events],
        roll,
        meta,
      ),
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
    landAndContinue(
      moved.state,
      playerId,
      [...events, ...released.events, ...moved.events],
      roll,
      meta,
    ),
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

/**
 * Paying the fine to get out.
 *
 * The player leaves immediately and then rolls as normal — this is not a roll, it
 * is the thing you do before one, so the phase goes back to awaiting a roll rather
 * than ending the turn.
 */
export function handlePayJailFine(state: GameState): Result<PhaseResult, RuleViolation> {
  if (state.phase.kind !== 'awaiting_jail_decision') {
    return err(violation('WRONG_PHASE', 'You are not deciding how to leave the gaol.'));
  }

  const playerId = activePlayerId(state);
  if (!getPlayer(state, playerId).inJail) {
    return err(violation('NOT_IN_JAIL', 'You are not in the gaol.'));
  }

  const pack = boardOf(state);
  if (getPlayer(state, playerId).cash < pack.jail.fine) {
    return err(violation('INSUFFICIENT_FUNDS', 'You cannot afford the fine.'));
  }

  const payment = payOrEnterDebt(state, playerId, null, pack.jail.fine, {
    kind: 'awaiting_jail_decision',
  });

  if (payment.enteredDebt) {
    throw new Error('A fine that passed the affordability check still entered debt');
  }

  const released = releaseFromJail(payment.state, playerId, 'fine');

  return ok({
    state: { ...released.state, phase: { kind: 'awaiting_roll' } },
    events: [...payment.events, ...released.events],
  });
}

/**
 * Spending a held release card.
 *
 * The card goes back to the bottom of the deck it came from, which is why a player
 * holds the deck rather than the card: there is nothing else about it worth
 * remembering, and the deck is the part that has to be right (→ PRD F10).
 */
export function handleUseJailCard(state: GameState): Result<PhaseResult, RuleViolation> {
  if (state.phase.kind !== 'awaiting_jail_decision') {
    return err(violation('WRONG_PHASE', 'You are not deciding how to leave the gaol.'));
  }

  const playerId = activePlayerId(state);
  const player = getPlayer(state, playerId);

  if (!player.inJail) {
    return err(violation('NOT_IN_JAIL', 'You are not in the gaol.'));
  }

  const [deck, ...rest] = player.heldJailCards;
  if (deck === undefined) {
    return err(violation('NO_JAIL_CARD', 'You have no release card to use.'));
  }

  const pack = boardOf(state);
  const cardId = pack.decks[deck].find((card) => card.effect.kind === 'get_out_of_jail')?.id;
  if (cardId === undefined) {
    throw new Error(`Board pack ${pack.id} has no release card in the ${deck} deck`);
  }

  const returned = returnCardToBottom(
    {
      ...state,
      players: { ...state.players, [playerId]: { ...player, heldJailCards: rest } },
    },
    deck,
    cardId,
  );

  const released = releaseFromJail(returned, playerId, 'card');

  return ok({
    state: { ...released.state, phase: { kind: 'awaiting_roll' } },
    events: released.events,
  });
}
