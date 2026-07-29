import type { GameEvent } from '../events/types.js';
import type { GameState, PlayerId, TurnPhase } from '../state/types.js';
import { getPlayer } from '../state/selectors.js';

/**
 * The single money path.
 *
 * Rent, tax, fines, card effects, auction settlements and trades all move cash
 * through here and nowhere else. That is a deliberate bottleneck: the rule that
 * a player who cannot pay enters debt rather than going straight to bankruptcy
 * (→ PRD F12) has to hold for every payment in the game, and the only way to be
 * sure of that is to have one function that can fail to pay.
 *
 * Cash never goes negative outside a debt. If a payment would take a player
 * below zero, the payment does not happen at all — the game stops and waits for
 * them to raise the money or declare.
 */

export type PaymentResult = {
  readonly state: GameState;
  readonly events: readonly GameEvent[];
  /** True when the payer could not cover it and the game is now waiting on them. */
  readonly enteredDebt: boolean;
};

export function credit(state: GameState, playerId: PlayerId, amount: number): GameState {
  if (amount < 0) {
    throw new Error(`credit received a negative amount: ${amount}`);
  }
  const player = getPlayer(state, playerId);
  return {
    ...state,
    players: { ...state.players, [playerId]: { ...player, cash: player.cash + amount } },
  };
}

function withdraw(state: GameState, playerId: PlayerId, amount: number): GameState {
  const player = getPlayer(state, playerId);
  if (player.cash < amount) {
    throw new Error(`withdraw would take ${playerId} below zero`);
  }
  return {
    ...state,
    players: { ...state.players, [playerId]: { ...player, cash: player.cash - amount } },
  };
}

/**
 * Takes money from a player, or parks the game in debt if they cannot cover it.
 *
 * `creditorId` is null when the money is owed to the bank. `interrupted` is the
 * phase to return to once the debt is settled, which the debt handler restores —
 * a debt can be incurred by a player whose turn it is not, and the active
 * player's turn has to survive it (→ PRD F12).
 */
export function payOrEnterDebt(
  state: GameState,
  payerId: PlayerId,
  creditorId: PlayerId | null,
  amount: number,
  interrupted: TurnPhase,
): PaymentResult {
  if (amount < 0) {
    throw new Error(`payOrEnterDebt received a negative amount: ${amount}`);
  }
  if (amount === 0) {
    return { state, events: [], enteredDebt: false };
  }

  const payer = getPlayer(state, payerId);

  if (payer.cash < amount) {
    return {
      state: {
        ...state,
        phase: { kind: 'awaiting_debt', debtorId: payerId, creditorId, amount, interrupted },
      },
      events: [{ type: 'DEBT_INCURRED', debtorId: payerId, creditorId, amount }],
      enteredDebt: true,
    };
  }

  let next = withdraw(state, payerId, amount);

  if (creditorId !== null) {
    next = credit(next, creditorId, amount);
  } else if (state.config.freeParkingPot) {
    // Money paid to the bank goes to the pot instead, when the variant is on
    // (→ PRD F15). Rent and other player-to-player payments never touch it.
    next = { ...next, pot: next.pot + amount };
  }

  return { state: next, events: [], enteredDebt: false };
}
