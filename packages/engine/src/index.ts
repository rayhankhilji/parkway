/**
 * The entire public surface of @parkway/engine.
 *
 * Everything the server and the client may use is re-exported here. Reaching into
 * a deep path is not supported — the package has one entry point so that the
 * boundary between "the rules" and "everything else" stays a single, reviewable
 * list.
 */

export { ok, err, isOk, isErr, expectOk, type Ok, type Err, type Result } from './result';

export {
  violation,
  malformed,
  type RuleViolation,
  type RuleViolationCode,
  type MalformedAction,
} from './errors';

export { createRng, nextUint32, nextInt, rollDie, shuffle, type RngState } from './rng/mulberry32';

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
} from './board/types';

export { getBoardPack, listBoardPackIds, defaultBoardPackId } from './board/registry';

export {
  countSquaresOfKind,
  findNextSquareOfKind,
  getGroup,
  getOwnableSquare,
  getSquare,
  isOwnable,
  listOwnableSquares,
} from './board/lookup';

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
} from './state/types';

export { createGame, minPlayers, maxPlayers, type CreateGameInput } from './state/createGame';

export { toPublicState } from './state/publicState';

export {
  activePlayerId,
  boardOf,
  buildingCostOf,
  buildingsOn,
  canPayInCash,
  countOwnedOfKind,
  diceTotal,
  findPlayer,
  getDeed,
  getPlayer,
  groupIsUnmortgaged,
  isActivePlayer,
  isDouble,
  isSolvent,
  liquidatableValue,
  netWorth,
  ownedSquares,
  ownsFullGroup,
  priceOf,
  solventPlayerIds,
  squareNameOf,
} from './state/selectors';

export type { GameEvent, GameEventType } from './events/types';

export type { Action, ActionMeta, ActionType, LegalAction } from './actions/types';

export { parseAction, parseGameConfig } from './actions/parse';

export { reduce, type ReduceResult } from './reduce';

export { rentFor, type RentBasis } from './rules/rent';

export { resolveSquare, taxDue } from './rules/resolveSquare';

export { credit, payOrEnterDebt, paySequence, type Obligation } from './rules/payment';

export { advanceBy, moveToSquare, sendToJail, squareAfter } from './rules/movement';

export { drawCard, cardById, deckOf, returnCardToBottom, takeCardOutOfCycle } from './cards/deck';

export { applyCardEffect } from './cards/effects';

export { maxCardDepth, type Landing, type LandingContext } from './rules/landing';

export { getLegalActions, isActionLegal } from './legalActions';

export { minimumBid, openAuction, auctionInProgress } from './phases/auction';

export { isFinished, currentPlayerId } from './phases/debt';

export { winnerOf, sellAllBuildings } from './rules/bankruptcy';

export {
  handleOfferTrade,
  handleAcceptTrade,
  handleDeclineTrade,
  handleWithdrawTrade,
} from './phases/trade';

export {
  buildHouse,
  sellBuilding,
  buildableSquares,
  sellableSquares,
  developmentLevel,
} from './rules/building';

export {
  mortgage,
  unmortgage,
  mortgageableSquares,
  unmortgageableSquares,
  unmortgageCost,
  transferInterest,
} from './rules/mortgage';

export { canManage, managementBlockedBy } from './rules/management';
