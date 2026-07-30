'use client';

import type { Action, LegalAction } from '@parkway/engine';
import type { ApiFailure, PlayerSummary } from '@/lib/apiClient';
import { Button } from '@/components/ui/Button';
import { formatMoney } from '@/lib/format';

/**
 * The only place turn actions live.
 *
 * It renders one button per entry in `legalActions` and renders nothing else.
 * There is no condition in this file of the form "if it is my turn and I can
 * afford it" — the server already answered that, and a second copy of the answer
 * here is the failure the whole architecture is arranged to prevent.
 *
 * An empty set is not an error state. It means it is somebody else's move, and it
 * says so.
 */
export function ActionBar({
  legalActions,
  players,
  activePlayerId,
  currency,
  pending,
  refusal,
  onAct,
}: {
  readonly legalActions: readonly LegalAction[];
  readonly players: readonly PlayerSummary[];
  readonly activePlayerId: string | null;
  readonly currency: string;
  readonly pending: Action['type'] | null;
  readonly refusal: ApiFailure | null;
  readonly onAct: (action: Action) => void;
}) {
  const waitingFor = players.find((player) => player.id === activePlayerId);

  return (
    <div className="flex h-[72px] items-center gap-3 border-t border-border px-4">
      {legalActions.length === 0 ? (
        <p className="text-base text-text-muted">
          {waitingFor === undefined ? 'Waiting' : `Waiting for ${waitingFor.name}`}
        </p>
      ) : (
        legalActions.map((legal) => {
          const action = toAction(legal);
          if (action === null) return null;

          return (
            <Button
              key={legal.type}
              size="bar"
              variant={primaryTypes.has(legal.type) ? 'primary' : 'secondary'}
              pending={pending === action.type}
              disabled={pending !== null}
              onClick={() => onAct(action)}
            >
              {label(legal, currency)}
            </Button>
          );
        })
      )}

      {/* A refusal shows next to the control that caused it, never as a toast. */}
      {refusal !== null && (
        <p role="status" className="ml-auto text-sm text-danger">
          {refusal.message}
        </p>
      )}
    </div>
  );
}

const primaryTypes = new Set<LegalAction['type']>([
  'ROLL_DICE',
  'ROLL_FOR_JAIL',
  'START_GAME',
  'BUY_PROPERTY',
  'END_TURN',
]);

function label(legal: LegalAction, currency: string): string {
  switch (legal.type) {
    case 'START_GAME':
      return 'Start the game';
    case 'ROLL_DICE':
      return 'Roll';
    case 'ROLL_FOR_JAIL':
      return `Roll for a double (${legal.attemptsRemaining} left)`;
    case 'BUY_PROPERTY':
      return `Buy for ${formatMoney(legal.price, currency)}`;
    case 'DECLINE_PURCHASE':
      return 'Decline';
    case 'PLACE_BID':
      return 'Bid';
    case 'PASS_BID':
      return 'Pass';
    case 'AUCTION_TIMEOUT':
      return 'Close the auction';
    case 'PAY_JAIL_FINE':
      return `Pay the fine (${formatMoney(legal.fine, currency)})`;
    case 'USE_JAIL_CARD':
      return 'Use release card';
    case 'BUILD_HOUSE':
      return 'Build';
    case 'SELL_HOUSE':
      return 'Sell buildings';
    case 'MORTGAGE':
      return 'Mortgage';
    case 'UNMORTGAGE':
      return 'Clear mortgage';
    case 'OFFER_TRADE':
      return 'Offer a trade';
    case 'ACCEPT_TRADE':
      return 'Accept';
    case 'DECLINE_TRADE':
      return 'Decline';
    case 'WITHDRAW_TRADE':
      return 'Withdraw';
    case 'SETTLE_DEBT':
      return `Settle ${formatMoney(legal.amount, currency)}`;
    case 'DECLARE_BANKRUPTCY':
      return 'Declare bankruptcy';
    case 'CONCEDE':
      return 'Concede';
    case 'END_TURN':
      return 'End turn';
  }
}

/**
 * The actions that need no further input, turned into something postable.
 *
 * The rest — bidding an amount, choosing a lot to build on, composing a trade —
 * open a dialog and arrive with the rules that introduce them. Returning null
 * here means the bar shows no button for them yet, which is honest: there is
 * nothing behind it.
 */
function toAction(legal: LegalAction): Action | null {
  switch (legal.type) {
    case 'START_GAME':
      return { type: 'START_GAME' };
    case 'ROLL_DICE':
      return { type: 'ROLL_DICE' };
    case 'ROLL_FOR_JAIL':
      return { type: 'ROLL_FOR_JAIL' };
    case 'END_TURN':
      return { type: 'END_TURN' };
    default:
      return null;
  }
}
