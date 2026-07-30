import type { Card, DeckId } from '../board/types';
import type { GameState } from '../state/types';
import { boardOf } from '../state/selectors';

/**
 * The decks, as rotating queues.
 *
 * Drawing takes the top card and returns it to the bottom, so a deck cycles
 * forever in a fixed order rather than being reshuffled. That is what makes
 * "draw every card and one more, and the first comes back" a testable property
 * (→ PRD F10).
 *
 * A release card is the exception: it leaves the cycle entirely while a player
 * holds it, and only returns to the bottom when it is used or traded away. So the
 * cycle length is not constant, and a deck can legitimately be one card shorter
 * than the pack declares.
 */

export function deckOf(state: GameState, deck: DeckId): readonly string[] {
  return state.decks[deck].order;
}

export function cardById(state: GameState, id: string): Card {
  const pack = boardOf(state);
  const card = [...pack.decks.chance, ...pack.decks.chest].find((candidate) => candidate.id === id);
  if (card === undefined) {
    throw new Error(`Card ${id} is not in board pack ${pack.id}`);
  }
  return card;
}

export type Draw = {
  readonly card: Card;
  /** The deck already rotated: the drawn card is at the bottom. */
  readonly state: GameState;
};

/**
 * Takes the top card and moves it to the bottom.
 *
 * The rotation happens here rather than at the call site so that a handler which
 * forgets to write the state back cannot leave the same card on top forever.
 */
export function drawCard(state: GameState, deck: DeckId): Draw {
  const order = state.decks[deck].order;
  const topId = order[0];

  if (topId === undefined) {
    // Every card is in someone's hand, which cannot happen: only release cards
    // leave the cycle and each deck holds exactly one.
    throw new Error(`The ${deck} deck is empty`);
  }

  return {
    card: cardById(state, topId),
    state: withDeck(state, deck, [...order.slice(1), topId]),
  };
}

/** Removes a card from its cycle, for a player to hold. */
export function takeCardOutOfCycle(state: GameState, deck: DeckId, cardId: string): GameState {
  return withDeck(
    state,
    deck,
    state.decks[deck].order.filter((id) => id !== cardId),
  );
}

/** Puts a held card back at the bottom of its own deck. */
export function returnCardToBottom(state: GameState, deck: DeckId, cardId: string): GameState {
  const order = state.decks[deck].order;
  if (order.includes(cardId)) {
    throw new Error(`Card ${cardId} is already in the ${deck} deck`);
  }
  return withDeck(state, deck, [...order, cardId]);
}

function withDeck(state: GameState, deck: DeckId, order: readonly string[]): GameState {
  return { ...state, decks: { ...state.decks, [deck]: { order } } };
}
