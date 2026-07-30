import { violation, type RuleViolation } from '../errors';
import type { GameEvent } from '../events/types';
import { err, ok, type Result } from '../result';
import type { GameState, PlayerId, TurnPhase } from '../state/types';
import { activePlayerId, getPlayer, solventPlayerIds } from '../state/selectors';
import { bankruptToBank, bankruptToPlayer, winnerOf, type Estate } from '../rules/bankruptcy';
import { paySequence, type Obligation } from '../rules/payment';
import { openAuction } from './auction';
import { nextActiveIndex, openingPhaseFor } from './endTurn';
import type { PhaseResult } from './turnFlow';

/**
 * Owing more than you hold.
 *
 * A debt halts the game for the debtor alone (→ PRD F12). They can still sell,
 * mortgage and trade — that is the entire point of the phase — but nothing else
 * moves, including other players' turns, until it resolves one way or the other.
 *
 * It resolves in exactly two ways: settled in cash, or declared. There is no
 * partial payment, because a creditor owed £500 and handed £300 has not been paid
 * and the game would need a second debt to describe what is left.
 */

export function handleSettleDebt(
  state: GameState,
  playerId: PlayerId,
): Result<PhaseResult, RuleViolation> {
  const phase = state.phase;
  if (phase.kind !== 'awaiting_debt') {
    return err(violation('NO_DEBT', 'You do not owe anything.'));
  }
  if (phase.debtorId !== playerId) {
    return err(violation('NO_DEBT', 'That debt is not yours.'));
  }

  if (getPlayer(state, playerId).cash < phase.amount) {
    return err(violation('DEBT_NOT_SETTLED', 'You still cannot cover it. Raise more, or declare.'));
  }

  const events: GameEvent[] = [];

  // The debt that halted the game, plus anything queued behind it — one card can
  // create several obligations at once, and settling the first must not cancel
  // the rest (→ the `remaining` queue on the phase).
  const queue: readonly Obligation[] = [
    { debtorId: phase.debtorId, creditorId: phase.creditorId, amount: phase.amount },
    ...phase.remaining,
  ];

  const restored: GameState = { ...state, phase: phase.interrupted };
  const payment = paySequence(restored, queue, phase.interrupted);
  events.push(
    {
      type: 'DEBT_SETTLED',
      debtorId: phase.debtorId,
      creditorId: phase.creditorId,
      amount: phase.amount,
    },
    ...payment.events,
  );

  if (payment.enteredDebt) {
    // Someone further down the queue cannot pay. The game halts again on them.
    return ok({ state: payment.state, events });
  }

  return ok(resume(payment.state, events, phase.interrupted));
}

/**
 * Giving up on a debt.
 *
 * Everything goes to whoever is owed. To a player, that is a direct transfer; to
 * the bank, the estate is auctioned lot by lot in board order.
 */
export function handleDeclareBankruptcy(
  state: GameState,
  playerId: PlayerId,
  now: number,
): Result<PhaseResult, RuleViolation> {
  const phase = state.phase;
  if (phase.kind !== 'awaiting_debt') {
    return err(violation('NO_DEBT', 'You do not owe anything to declare against.'));
  }
  if (phase.debtorId !== playerId) {
    return err(violation('NO_DEBT', 'That debt is not yours.'));
  }

  const estate =
    phase.creditorId === null
      ? bankruptToBank(state, playerId)
      : bankruptToPlayer(state, playerId, phase.creditorId);

  return ok(settleEstate(estate, playerId, phase.interrupted, now));
}

/**
 * Walking away, with nothing owed.
 *
 * Handled as bankruptcy to the bank (→ PRD F14), so a conceding player's
 * properties go back under the hammer rather than to whoever happens to be next.
 */
export function handleConcede(
  state: GameState,
  playerId: PlayerId,
  now: number,
): Result<PhaseResult, RuleViolation> {
  if (state.phase.kind === 'game_over') {
    return err(violation('GAME_OVER', 'This game has finished.'));
  }
  if (state.phase.kind === 'auction') {
    // Conceding mid-auction would remove a bidder from a lot already under the
    // hammer, and the estate would want auctioning on top of it.
    return err(violation('AUCTION_IN_PROGRESS', 'Wait for the auction to finish.'));
  }

  if (state.phase.kind === 'awaiting_debt' && state.phase.debtorId !== playerId) {
    /*
     * Somebody else owes money, and a debt halts the game for everyone (→ F12).
     *
     * Conceding here would settle this player's estate and then have to decide
     * what to do with the debt phase it replaced — and the obvious answer, keeping
     * the interrupted phase, silently forgives a debt that has nothing to do with
     * the player walking away.
     */
    return err(violation('DEBT_OUTSTANDING', 'Wait for the outstanding debt to be settled.'));
  }

  const interrupted: TurnPhase =
    state.phase.kind === 'awaiting_debt' ? state.phase.interrupted : state.phase;

  return ok(settleEstate(bankruptToBank(state, playerId), playerId, interrupted, now));
}

/**
 * What happens once a player is out.
 *
 * Victory is checked before the estate is auctioned: with one player left there is
 * nobody to bid, and the game is over whatever was about to happen next.
 */
function settleEstate(
  estate: Estate,
  playerId: PlayerId,
  interrupted: TurnPhase,
  now: number,
): PhaseResult {
  const winner = winnerOf(estate.state);
  if (winner !== null) {
    return {
      state: { ...estate.state, phase: { kind: 'game_over', winnerId: winner } },
      events: [...estate.events, { type: 'GAME_OVER', winnerId: winner }],
    };
  }

  if (estate.toAuction.length > 0) {
    const [first, ...rest] = estate.toAuction;
    if (first !== undefined) {
      const opened = openAuction(estate.state, first, now, rest);
      return { state: opened.state, events: [...estate.events, ...opened.events] };
    }
  }

  return resume(estate.state, estate.events, interrupted, playerId);
}

/**
 * Hands play back to whoever should have it.
 *
 * If the player who just left was the one taking their turn, the turn passes on —
 * a bankrupt player cannot roll, and leaving the game pointing at them would stop
 * it dead.
 */
function resume(
  state: GameState,
  events: readonly GameEvent[],
  interrupted: TurnPhase,
  departedId?: PlayerId,
): PhaseResult {
  const winner = winnerOf(state);
  if (winner !== null) {
    return {
      state: { ...state, phase: { kind: 'game_over', winnerId: winner } },
      events: [...events, { type: 'GAME_OVER', winnerId: winner }],
    };
  }

  const active = state.turnOrder[state.activeIndex];
  const activeIsOut = active !== undefined && getPlayer(state, active).bankrupt;

  if (departedId !== undefined && activeIsOut) {
    const activeIndex = nextActiveIndex(state, state.activeIndex);
    const nextId = state.turnOrder[activeIndex];
    if (nextId === undefined) {
      throw new Error(`Turn order has no player at index ${activeIndex}`);
    }
    return {
      state: {
        ...state,
        activeIndex,
        phase: openingPhaseFor(state, nextId),
        turn: { doublesCount: 0, hasRolled: false, lastRoll: null },
      },
      events: [...events, { type: 'TURN_ENDED', playerId: active, nextPlayerId: nextId }],
    };
  }

  return { state: { ...state, phase: interrupted }, events };
}

/** Whether the game has run out of opponents, for the callers that need to check. */
export function isFinished(state: GameState): boolean {
  return state.phase.kind === 'game_over' || solventPlayerIds(state).length <= 1;
}

/** The player whose turn it is, or null once the game is over. */
export function currentPlayerId(state: GameState): PlayerId | null {
  return state.phase.kind === 'game_over' ? null : activePlayerId(state);
}
