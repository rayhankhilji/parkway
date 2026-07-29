import { getSquare } from '../board/lookup.js';
import { violation, type RuleViolation } from '../errors.js';
import type { GameEvent } from '../events/types.js';
import { err, ok, type Result } from '../result.js';
import { rollDie, type RngState } from '../rng/mulberry32.js';
import type { DiceRoll, GameState, PlayerId } from '../state/types.js';
import { activePlayerId, boardOf, diceTotal, getPlayer, isDouble } from '../state/selectors.js';
import { advanceBy, sendToJail } from '../rules/movement.js';

export type PhaseResult = {
  readonly state: GameState;
  readonly events: readonly GameEvent[];
};

/**
 * Rolls the dice from the state's own generator and returns the new state.
 *
 * Shared with the jail handler, which rolls under different rules but from the
 * same generator — the sequence of numbers a game produces must not depend on
 * why a player was rolling.
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
 * on — the roll is counted, and then discarded (→ PRD F4). Implementations get
 * this wrong by moving first and jailing afterwards, which changes the game
 * whenever the third roll would have landed somewhere consequential.
 */
export function handleRollDice(state: GameState): Result<PhaseResult, RuleViolation> {
  if (state.phase.kind !== 'awaiting_roll') {
    return err(violation('WRONG_PHASE', 'You cannot roll right now.'));
  }

  const playerId = activePlayerId(state);
  const { roll, rng } = drawDice(state);
  const double = isDouble(roll);
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

  return ok(resolveLanding(moved.state, playerId, events, { grantsAnotherRoll: double }));
}

/**
 * What happens once a token has come to rest.
 *
 * Only the go-to-gaol square acts at this stage; purchases, rent, tax and cards
 * arrive with the rules that own them. The square's effect is applied first,
 * because being jailed cancels an extra roll that doubles would otherwise have
 * granted.
 */
export function resolveLanding(
  state: GameState,
  playerId: PlayerId,
  events: readonly GameEvent[],
  options: { readonly grantsAnotherRoll: boolean },
): PhaseResult {
  const pack = boardOf(state);
  const square = getSquare(pack, getPlayer(state, playerId).position);

  if (square.kind === 'go_to_jail') {
    const jailed = sendToJail(state, playerId, 'square');
    return {
      state: { ...jailed.state, phase: { kind: 'awaiting_end_turn' } },
      events: [...events, ...jailed.events],
    };
  }

  return {
    state: {
      ...state,
      phase: options.grantsAnotherRoll ? { kind: 'awaiting_roll' } : { kind: 'awaiting_end_turn' },
    },
    events,
  };
}
