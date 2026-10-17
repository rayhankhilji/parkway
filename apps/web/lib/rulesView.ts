import type { GameState, PublicGameState } from '@parkway/engine';

/**
 * A public state shaped as a full one, for the engine's read-only selectors.
 *
 * Several selectors (`unmortgageCost`, `rentFor`, `netWorth`) take a GameState
 * but never touch the two secret fields. Asking the engine is always better than
 * re-deriving a number in a component, so this fills the secret fields with
 * inert placeholders. It must never be passed to `reduce`.
 */
export function rulesView(state: PublicGameState): GameState {
  return {
    ...state,
    decks: { chance: { order: [] }, chest: { order: [] } },
    rng: { seed: 0 },
  };
}
