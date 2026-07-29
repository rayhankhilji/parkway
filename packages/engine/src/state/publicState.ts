import type { GameState, PublicGameState } from './types.js';

/**
 * The secret boundary. Every payload leaving the server passes through here.
 *
 * Two fields must never reach a client. `rng` is the whole state of the
 * generator, so anyone holding it can compute every future roll in the game.
 * `decks` is the order of both decks, which gives away every card before it is
 * drawn. Neither is recoverable once leaked, and a leak is invisible — the game
 * carries on looking correct while one player quietly knows everything.
 *
 * The projection is written as an explicit list of permitted fields rather than
 * a spread with the secrets deleted. That choice is the point of this file: with
 * a spread, adding a field to GameState silently publishes it, and the mistake
 * only shows up in a payload capture. Written this way, adding a field breaks
 * the build here until someone decides whether it is public.
 */
export function toPublicState(state: GameState): PublicGameState {
  return {
    version: state.version,
    boardPackId: state.boardPackId,
    config: state.config,
    phase: state.phase,
    players: state.players,
    turnOrder: state.turnOrder,
    activeIndex: state.activeIndex,
    deeds: state.deeds,
    bank: state.bank,
    pot: state.pot,
    openTrade: state.openTrade,
    turn: state.turn,
    decks: {
      chance: state.decks.chance.order.length,
      chest: state.decks.chest.order.length,
    },
  };
}
