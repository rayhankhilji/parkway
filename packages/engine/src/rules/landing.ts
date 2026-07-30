import type { GameEvent } from '../events/types';
import type { DiceRoll, GameState, PlayerId } from '../state/types';

/**
 * The result of a token coming to rest, and the context a square needs to resolve
 * itself.
 *
 * Shared by square resolution and card effects, which are mutually recursive — a
 * card can move a player onto another card square — so the shapes they pass
 * between each other live here rather than in either of them.
 */

export type Landing = {
  readonly state: GameState;
  readonly events: readonly GameEvent[];
  /**
   * True when the square left the game waiting on somebody: a purchase decision,
   * an auction, a debt, or a trip to the gaol. The phase is already set, and the
   * caller must not overwrite it with an end-of-turn.
   */
  readonly halted: boolean;
};

export type LandingContext = {
  /**
   * The roll that produced this landing, which utility rent multiplies. Null only
   * where no roll was involved.
   */
  readonly causingRoll: DiceRoll | null;
  /**
   * How many cards deep this resolution is. A card can send a player to a square
   * that draws another card, which is legitimate and terminates on any sane board
   * — but a pack could describe a loop, and a stack overflow is a worse way to
   * find that out than an error naming the pack.
   */
  readonly depth: number;
  /**
   * Set when a card sent the player here, so stations and utilities charge the
   * pack's penalty rate instead of the standard one (→ PRD F10).
   */
  readonly viaCard: boolean;
};

export const maxCardDepth = 8;

export type Resolver = (state: GameState, playerId: PlayerId, context: LandingContext) => Landing;
