import { findNextSquareOfKind } from '../board/lookup';
import type { Card } from '../board/types';
import type { GameEvent } from '../events/types';
import type { GameState, PlayerId } from '../state/types';
import { boardOf, getDeed, getPlayer, ownedSquares, solventPlayerIds } from '../state/selectors';
import { advanceBy, moveToSquare, sendToJail } from '../rules/movement';
import { credit, paySequence, payOrEnterDebt, type Obligation } from '../rules/payment';
import type { Landing, LandingContext, Resolver } from '../rules/landing';
import { takeCardOutOfCycle } from './deck';

/**
 * The closed set of things a card can do.
 *
 * Closed is the point. Card text is data, but its *effects* are a fixed
 * vocabulary the engine knows how to apply, so a board pack cannot introduce a new
 * rule by writing a sentence — it can only compose effects that already have
 * tested behaviour.
 *
 * Every movement effect re-enters full square resolution at the destination, which
 * is what makes "advance to the station and then pay rent on it" work without the
 * card knowing anything about rent. The resolver is passed in rather than imported
 * because resolution and card effects are mutually recursive.
 */
export function applyCardEffect(
  state: GameState,
  playerId: PlayerId,
  card: Card,
  context: LandingContext,
  resolve: Resolver,
): Landing {
  const pack = boardOf(state);
  const effect = card.effect;
  const events: GameEvent[] = [];

  /** Re-resolves wherever the player has ended up, one card deeper. */
  const land = (next: GameState, viaCard: boolean, before: readonly GameEvent[]): Landing => {
    const result = resolve(next, playerId, {
      causingRoll: context.causingRoll,
      depth: context.depth + 1,
      viaCard,
      now: context.now,
    });
    return {
      state: result.state,
      events: [...events, ...before, ...result.events],
      halted: result.halted,
    };
  };

  switch (effect.kind) {
    case 'collect':
      return {
        state: credit(state, playerId, effect.amount),
        events,
        halted: false,
      };

    case 'pay': {
      const payment = payOrEnterDebt(state, playerId, null, effect.amount, {
        kind: 'awaiting_end_turn',
      });
      return {
        state: payment.state,
        events: [...events, ...payment.events],
        halted: payment.enteredDebt,
      };
    }

    case 'move_to': {
      const from = getPlayer(state, playerId).position;
      // "Advance to" always travels forwards, so a lower destination means the
      // token wrapped the board and collected the salary on the way.
      const moved = moveToSquare(state, playerId, effect.squareId, {
        collectSalary: effect.squareId < from,
      });
      return land(moved.state, false, moved.events);
    }

    case 'move_relative': {
      // Going backwards past the start square pays nothing, which advanceBy
      // already knows (→ PRD F10).
      const moved = advanceBy(state, playerId, effect.offset);
      return land(moved.state, false, moved.events);
    }

    case 'move_to_nearest': {
      const from = getPlayer(state, playerId).position;
      const target = findNextSquareOfKind(pack, from, effect.target);
      const moved = moveToSquare(state, playerId, target, { collectSalary: target < from });
      // viaCard, so the destination charges the pack's penalty rate.
      return land(moved.state, true, moved.events);
    }

    case 'go_to_jail': {
      const jailed = sendToJail(state, playerId, 'card');
      return {
        state: { ...jailed.state, phase: { kind: 'awaiting_end_turn' } },
        events: [...events, ...jailed.events],
        halted: true,
      };
    }

    case 'get_out_of_jail': {
      // The card leaves its deck entirely while it is held, and only returns to
      // the bottom when it is spent or traded away (→ PRD F10).
      const player = getPlayer(state, playerId);
      const held = takeCardOutOfCycle(state, card.deck, card.id);
      return {
        state: {
          ...held,
          players: {
            ...held.players,
            [playerId]: { ...player, heldJailCards: [...player.heldJailCards, card.deck] },
          },
        },
        events: [...events, { type: 'CARD_KEPT', playerId, deck: card.deck, cardId: card.id }],
        halted: false,
      };
    }

    case 'repairs': {
      let owed = 0;
      for (const square of ownedSquares(state, playerId)) {
        if (square.kind !== 'property') continue;
        const deed = getDeed(state, square.id);
        owed += deed.houses * effect.perHouse + deed.hotels * effect.perHotel;
      }
      const payment = payOrEnterDebt(state, playerId, null, owed, { kind: 'awaiting_end_turn' });
      return {
        state: payment.state,
        events: [...events, ...payment.events],
        halted: payment.enteredDebt,
      };
    }

    case 'pay_each_player': {
      const obligations: readonly Obligation[] = others(state, playerId).map((creditorId) => ({
        debtorId: playerId,
        creditorId,
        amount: effect.amount,
      }));
      const payment = paySequence(state, obligations, { kind: 'awaiting_end_turn' });
      return {
        state: payment.state,
        events: [...events, ...payment.events],
        halted: payment.enteredDebt,
      };
    }

    case 'collect_from_each_player': {
      // Each other player owes the drawer separately, so any one of them can be
      // the player who cannot cover it.
      const obligations: readonly Obligation[] = others(state, playerId).map((debtorId) => ({
        debtorId,
        creditorId: playerId,
        amount: effect.amount,
      }));
      const payment = paySequence(state, obligations, { kind: 'awaiting_end_turn' });
      return {
        state: payment.state,
        events: [...events, ...payment.events],
        halted: payment.enteredDebt,
      };
    }
  }
}

/** Everyone still in the game apart from this player, in turn order. */
function others(state: GameState, playerId: PlayerId): readonly PlayerId[] {
  return solventPlayerIds(state).filter((id) => id !== playerId);
}
