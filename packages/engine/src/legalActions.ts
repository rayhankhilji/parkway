import type { LegalAction } from './actions/types.js';
import type { GameState, PlayerId } from './state/types.js';
import { activePlayerId, boardOf, getPlayer, findPlayer } from './state/selectors.js';

/**
 * What this player may do, right now.
 *
 * The UI builds every button from this and from nothing else. A component that
 * decides for itself whether an action is available has copied a rule, and a
 * second copy of a rule is the failure this whole architecture exists to
 * prevent. The reducer checks against the same function, so a button that is
 * absent and an action that is refused can never disagree.
 *
 * Actions that are legal outside the phase machine — building, mortgaging,
 * trading — are added by the rules that own them (→ D10). Everything listed here
 * is turn flow.
 */
export function getLegalActions(state: GameState, playerId: PlayerId): readonly LegalAction[] {
  const player = findPlayer(state, playerId);
  if (player === undefined || player.bankrupt) {
    return [];
  }

  if (state.phase.kind === 'game_over') {
    return [];
  }

  const actions: LegalAction[] = [];
  const isActive = activePlayerId(state) === playerId;

  switch (state.phase.kind) {
    case 'awaiting_roll':
      if (isActive) actions.push({ type: 'ROLL_DICE' });
      break;

    case 'awaiting_jail_decision':
      if (isActive) {
        const pack = boardOf(state);
        actions.push({
          type: 'ROLL_FOR_JAIL',
          attemptsRemaining: pack.jail.maxTurns - getPlayer(state, playerId).jailAttempts,
        });
      }
      break;

    case 'awaiting_end_turn':
      if (isActive) actions.push({ type: 'END_TURN' });
      break;

    case 'awaiting_purchase':
    case 'auction':
    case 'awaiting_debt':
      // Handled by the rules that introduce these phases.
      break;
  }

  return actions;
}

export function isActionLegal(
  state: GameState,
  playerId: PlayerId,
  type: LegalAction['type'],
): boolean {
  return getLegalActions(state, playerId).some((action) => action.type === type);
}
