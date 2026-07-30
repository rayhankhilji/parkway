import { violation, type RuleViolation } from '../errors';
import type { GameState, PlayerId } from '../state/types';

/**
 * When a player may reshape their holdings.
 *
 * Building, selling, mortgaging and trading are not phases (→ D10). The real rules
 * let them happen at almost any moment, including on somebody else's turn, so they
 * are gated by this predicate rather than by the phase machine.
 *
 * There are exactly two exclusions, and both are load-bearing rather than
 * conveniences.
 */
export function managementBlockedBy(state: GameState, playerId: PlayerId): RuleViolation | null {
  if (state.phase.kind === 'auction') {
    // Nothing may change ownership or bank supply while a lot is under the
    // hammer, or a bidder could mortgage the very thing being bid on and change
    // what everyone is bidding for mid-auction.
    return violation('AUCTION_IN_PROGRESS', 'You cannot do that during an auction.');
  }

  if (state.phase.kind === 'awaiting_debt' && state.phase.debtorId !== playerId) {
    // A debt halts the game for everyone, not just the debtor (→ PRD F12). If
    // others could keep trading while somebody worked out whether they were
    // bankrupt, they would be reacting to information the debtor cannot act on.
    return violation('DEBT_OUTSTANDING', 'Someone owes money — the game is waiting on them.');
  }

  return null;
}

export function canManage(state: GameState, playerId: PlayerId): boolean {
  return managementBlockedBy(state, playerId) === null;
}
