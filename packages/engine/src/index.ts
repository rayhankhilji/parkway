/**
 * The entire public surface of @parkway/engine.
 *
 * Everything the server and the client may use is re-exported here. Reaching into
 * a deep path is not supported — the package has one entry point so that the
 * boundary between "the rules" and "everything else" stays a single, reviewable
 * list.
 */

export { ok, err, isOk, isErr, expectOk, type Ok, type Err, type Result } from './result.js';

export {
  violation,
  malformed,
  type RuleViolation,
  type RuleViolationCode,
  type MalformedAction,
} from './errors.js';

export {
  createRng,
  nextUint32,
  nextInt,
  rollDie,
  shuffle,
  type RngState,
} from './rng/mulberry32.js';

export type {
  BoardPack,
  Card,
  CardEffect,
  DeckId,
  GroupDefinition,
  GroupId,
  OwnableSquare,
  RentTable,
  Square,
  SquareId,
} from './board/types.js';

export { getBoardPack, listBoardPackIds, defaultBoardPackId } from './board/registry.js';

export {
  countSquaresOfKind,
  findNextSquareOfKind,
  getGroup,
  getOwnableSquare,
  getSquare,
  isOwnable,
  listOwnableSquares,
} from './board/lookup.js';

export type {
  DeckState,
  DeedState,
  DiceRoll,
  GameConfig,
  GameState,
  Phase,
  PlayerId,
  PlayerState,
  PublicGameState,
  TradeOffer,
  TradeSide,
  TurnPhase,
} from './state/types.js';

export type { GameEvent, GameEventType } from './events/types.js';

export type { Action, ActionMeta, ActionType, LegalAction } from './actions/types.js';
