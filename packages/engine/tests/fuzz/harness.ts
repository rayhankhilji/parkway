import type { Action, ActionMeta, LegalAction } from '../../src/actions/types';
import { getBoardPack } from '../../src/board/registry';
import { getLegalActions } from '../../src/legalActions';
import { reduce } from '../../src/reduce';
import { createRng, nextInt, type RngState } from '../../src/rng/mulberry32';
import type { GameState, PlayerId } from '../../src/state/types';
import { buildState } from '../helpers/buildState';

/**
 * A bot that plays badly, at random, forever.
 *
 * The point is not to play well — it is to reach positions nobody would think to
 * write a test for. A hand-written scenario tests what its author already
 * suspected; this reaches the third double on the turn a card would have sent you
 * to a mortgaged station, and it does so thousands of times.
 *
 * Choices come from a seeded generator of their own, kept entirely separate from
 * the game's. Mixing them would mean a bot's decision changed the dice, and a
 * failing run would be impossible to shrink: every replay from the same seed
 * must make the same choices *and* roll the same numbers.
 */

export type Move = {
  readonly playerId: PlayerId;
  readonly action: Action;
  readonly meta: ActionMeta;
};

export type FuzzRun = {
  readonly seed: number;
  readonly playerIds: readonly PlayerId[];
  readonly initial: GameState;
  readonly final: GameState;
  /** Every applied move, in order. Replaying these must reproduce `final`. */
  readonly log: readonly Move[];
  readonly finished: boolean;
  /** Set when an invariant broke, naming which and when. */
  readonly broken: string | null;
};

/** Picks one of the offered actions at random, and fills in any choice it needs. */
function chooseAction(
  offered: readonly LegalAction[],
  rng: RngState,
): { action: Action | null; rng: RngState } {
  const [index, afterPick] = nextInt(rng, offered.length);
  const legal = offered[index];
  if (legal === undefined) return { action: null, rng: afterPick };

  switch (legal.type) {
    case 'ROLL_DICE':
      return { action: { type: 'ROLL_DICE' }, rng: afterPick };
    case 'ROLL_FOR_JAIL':
      return { action: { type: 'ROLL_FOR_JAIL' }, rng: afterPick };
    case 'PAY_JAIL_FINE':
      return { action: { type: 'PAY_JAIL_FINE' }, rng: afterPick };
    case 'USE_JAIL_CARD':
      return { action: { type: 'USE_JAIL_CARD' }, rng: afterPick };
    case 'BUY_PROPERTY':
      return { action: { type: 'BUY_PROPERTY' }, rng: afterPick };
    case 'DECLINE_PURCHASE':
      return { action: { type: 'DECLINE_PURCHASE' }, rng: afterPick };
    case 'PASS_BID':
      return { action: { type: 'PASS_BID' }, rng: afterPick };
    case 'SETTLE_DEBT':
      return { action: { type: 'SETTLE_DEBT' }, rng: afterPick };
    case 'DECLARE_BANKRUPTCY':
      return { action: { type: 'DECLARE_BANKRUPTCY' }, rng: afterPick };
    case 'END_TURN':
      return { action: { type: 'END_TURN' }, rng: afterPick };

    case 'PLACE_BID': {
      // Somewhere between the minimum and everything they hold, so auctions
      // sometimes go for silly money and sometimes creep.
      const span = legal.maximum - legal.minimum + 1;
      const [offset, afterAmount] = nextInt(afterPick, span);
      return {
        action: { type: 'PLACE_BID', amount: legal.minimum + offset },
        rng: afterAmount,
      };
    }

    case 'BUILD_HOUSE':
    case 'SELL_HOUSE':
    case 'MORTGAGE':
    case 'UNMORTGAGE': {
      const [pick, afterSquare] = nextInt(afterPick, legal.squareIds.length);
      const squareId = legal.squareIds[pick];
      return {
        action: squareId === undefined ? null : { type: legal.type, squareId },
        rng: afterSquare,
      };
    }

    case 'CONCEDE':
      // Left out on purpose. A bot that concedes at random ends games by walking
      // away, which would make "every game finishes" prove nothing.
      return { action: null, rng: afterPick };

    default:
      // Trading needs a composed offer, which is a shape this bot has no way to
      // invent sensibly. Covered by its own tests.
      return { action: null, rng: afterPick };
  }
}

/**
 * Everything that must be true of any game state, at any moment.
 *
 * Returns the first failure, or null. These are the properties that would let a
 * game look plausible while being quietly broken — a house that exists in two
 * places, a bankrupt player still holding a deed, money appearing from nowhere.
 */
export function checkInvariants(state: GameState): string | null {
  const pack = getBoardPack(state.boardPackId);

  let housesOnBoard = 0;
  let hotelsOnBoard = 0;

  for (const square of pack.squares) {
    const deed = state.deeds[square.id];
    if (deed === undefined) continue;

    housesOnBoard += deed.houses;
    hotelsOnBoard += deed.hotels;

    if (deed.houses < 0 || deed.hotels < 0) {
      return `square ${square.id} has negative buildings`;
    }
    if (deed.hotels > 1) return `square ${square.id} has more than one hotel`;
    if (deed.houses > 4) return `square ${square.id} has more than four houses`;
    if (deed.hotels > 0 && deed.houses > 0) {
      return `square ${square.id} has a hotel and houses at once`;
    }
    if (deed.ownerId !== null && state.players[deed.ownerId] === undefined) {
      return `square ${square.id} is owned by ${deed.ownerId}, who is not in this game`;
    }
    if (deed.ownerId === null && (deed.houses > 0 || deed.hotels > 0)) {
      return `square ${square.id} is unowned but built on`;
    }
    if (deed.mortgaged && (deed.houses > 0 || deed.hotels > 0)) {
      return `square ${square.id} is mortgaged and built on`;
    }
  }

  // Buildings are conserved: every house is either on the board or in the bank.
  if (housesOnBoard + state.bank.houses !== pack.bank.houses) {
    return `houses do not add up: ${housesOnBoard} on the board and ${state.bank.houses} in the bank`;
  }
  if (hotelsOnBoard + state.bank.hotels !== pack.bank.hotels) {
    return `hotels do not add up: ${hotelsOnBoard} on the board and ${state.bank.hotels} in the bank`;
  }
  if (state.bank.houses < 0 || state.bank.hotels < 0) {
    return 'the bank holds a negative number of buildings';
  }

  for (const id of state.turnOrder) {
    const player = state.players[id];
    if (player === undefined) return `${id} is in the turn order but not in the game`;

    if (player.cash < 0) return `${id} holds negative cash`;
    if (player.position < 0 || player.position >= pack.squares.length) {
      return `${id} is on square ${player.position}, which is not on the board`;
    }
    if (player.jailAttempts < 0 || player.jailAttempts > pack.jail.maxTurns) {
      return `${id} has made ${player.jailAttempts} attempts to leave the gaol`;
    }

    if (player.bankrupt) {
      if (player.cash !== 0) return `${id} is out but still holds cash`;
      if (player.heldJailCards.length > 0) return `${id} is out but still holds a card`;
      const owned = pack.squares.filter((square) => state.deeds[square.id]?.ownerId === id);
      if (owned.length > 0) return `${id} is out but still owns ${owned.length} squares`;
    }
  }

  // Even build, within every group the rules apply to.
  for (const group of pack.groups) {
    const levels = group.memberIds.map((squareId) => {
      const deed = state.deeds[squareId];
      return deed === undefined ? 0 : deed.hotels > 0 ? 5 : deed.houses;
    });
    if (Math.max(...levels) - Math.min(...levels) > 1) {
      return `group ${group.id} is developed unevenly: ${levels.join(', ')}`;
    }
  }

  if (state.phase.kind === 'game_over') {
    const standing = state.turnOrder.filter((id) => state.players[id]?.bankrupt === false);
    if (standing.length !== 1) {
      return `the game is over with ${standing.length} players still in`;
    }
    if (standing[0] !== state.phase.winnerId) {
      return `the winner is ${state.phase.winnerId} but ${standing[0]} is the one still standing`;
    }
  }

  return null;
}

export function fuzzGame(seed: number, playerIds: readonly PlayerId[], limit = 4_000): FuzzRun {
  const initial = buildState({ playerIds, seed });
  let state = initial;
  let choices = createRng(seed ^ 0x5f3759df);
  const log: Move[] = [];

  const broken = checkInvariants(state);
  if (broken !== null) {
    return { seed, playerIds, initial, final: state, log, finished: false, broken };
  }

  for (let count = 0; count < limit; count += 1) {
    if (state.phase.kind === 'game_over') {
      return { seed, playerIds, initial, final: state, log, finished: true, broken: null };
    }

    // Ask everyone, because during an auction the player who can act is not the
    // one whose turn it is.
    const actors = state.turnOrder.filter((id) => getLegalActions(state, id).length > 0);
    if (actors.length === 0) break;

    const [pickActor, afterActor] = nextInt(choices, actors.length);
    choices = afterActor;
    const playerId = actors[pickActor];
    if (playerId === undefined) break;

    const offered = getLegalActions(state, playerId);
    const chosen = chooseAction(offered, choices);
    choices = chosen.rng;
    if (chosen.action === null) continue;

    const meta: ActionMeta = { playerId, now: count * 60_000 };
    const result = reduce(state, chosen.action, meta);

    if (!result.ok) {
      return {
        seed,
        playerIds,
        initial,
        final: state,
        log,
        finished: false,
        broken: `${chosen.action.type} was offered to ${playerId} and refused: ${result.error.code}`,
      };
    }

    state = result.value.state;
    log.push({ playerId, action: chosen.action, meta });

    const failure = checkInvariants(state);
    if (failure !== null) {
      return {
        seed,
        playerIds,
        initial,
        final: state,
        log,
        finished: false,
        broken: `after ${log.length} actions (${chosen.action.type}): ${failure}`,
      };
    }
  }

  return { seed, playerIds, initial, final: state, log, finished: false, broken: null };
}

/**
 * Folds a recorded log back over the opening position.
 *
 * This is the property the whole architecture rests on: the same actions applied
 * to the same starting state must produce the same ending state, byte for byte. If
 * it ever fails, the engine has non-determinism in it and every recorded game is
 * a work of fiction.
 */
export function replay(run: FuzzRun): { state: GameState; mismatchAt: number | null } {
  let state = run.initial;

  for (let index = 0; index < run.log.length; index += 1) {
    const move = run.log[index];
    if (move === undefined) continue;

    const result = reduce(state, move.action, move.meta);
    if (!result.ok) {
      return { state, mismatchAt: index };
    }
    state = result.value.state;
  }

  return { state, mismatchAt: null };
}
