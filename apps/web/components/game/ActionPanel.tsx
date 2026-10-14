'use client';

import { useEffect, useState } from 'react';
import { getBoardPack, getSquare, type Action, type LegalAction } from '@parkway/engine';
import { BarsIcon, KeyIcon, StackIcon, SwapIcon } from '@/components/board/icons';
import { Button } from '@/components/ui/Button';
import type { ApiFailure, GamePayload } from '@/lib/apiClient';
import { cn } from '@/lib/cn';
import { formatMoney } from '@/lib/format';
import { sfx } from '@/lib/sound';
import { AuctionPanel } from './AuctionPanel';

/**
 * What you can do right now, and nothing else.
 *
 * Every control is built from `legalActions`. There is no condition in this
 * file of the form "if it is my turn and I can afford it" — the engine already
 * answered that, and a second copy of the answer here is the failure the whole
 * architecture is arranged to prevent. What this file adds is *emphasis*: one
 * big obvious thing to press, with everything else around it.
 */

export type ActionPanelProps = {
  readonly game: GamePayload;
  readonly busy: boolean;
  readonly pending: Action['type'] | null;
  readonly refusal: ApiFailure | null;
  readonly onAct: (action: Action) => void;
  readonly onOpenPortfolio: () => void;
  readonly onOpenTrade: () => void;
  readonly onReviewTrade: () => void;
  /** Online clients fire the auction deadline themselves (→ D5). */
  readonly firesAuctionTimeout: boolean;
  /** Only one copy on the page listens to the keyboard. */
  readonly hotkeys?: boolean;
  readonly variant: 'centre' | 'dock';
};

type Legal<T extends LegalAction['type']> = Extract<LegalAction, { type: T }>;

function find<T extends LegalAction['type']>(
  legal: readonly LegalAction[],
  type: T,
): Legal<T> | undefined {
  return legal.find((action): action is Legal<T> => action.type === type);
}

export function ActionPanel(props: ActionPanelProps) {
  const { game, busy, pending, refusal, onAct, variant } = props;
  const state = game.publicState;
  if (state === null) return null;

  const pack = getBoardPack(state.boardPackId);
  const money = (amount: number) => formatMoney(amount, pack.currencySymbol);
  const legal = game.legalActions;
  const you = game.you.playerId;
  const activeId = state.turnOrder[state.activeIndex];
  const active = game.players.find((player) => player.id === activeId);
  const locked = busy || pending !== null;

  const act = (action: Action) => {
    sfx.click();
    onAct(action);
  };

  const roll = find(legal, 'ROLL_DICE');
  const endTurn = find(legal, 'END_TURN');
  const buy = find(legal, 'BUY_PROPERTY');
  const decline = find(legal, 'DECLINE_PURCHASE');
  const rollForJail = find(legal, 'ROLL_FOR_JAIL');
  const payFine = find(legal, 'PAY_JAIL_FINE');
  const useCard = find(legal, 'USE_JAIL_CARD');
  const settle = find(legal, 'SETTLE_DEBT');
  const bankrupt = find(legal, 'DECLARE_BANKRUPTCY');
  const offerTrade = find(legal, 'OFFER_TRADE');
  const accept = find(legal, 'ACCEPT_TRADE');
  const withdraw = find(legal, 'WITHDRAW_TRADE');
  const canManage = legal.some((action) =>
    ['BUILD_HOUSE', 'SELL_HOUSE', 'MORTGAGE', 'UNMORTGAGE'].includes(action.type),
  );

  const primary: Action | null =
    roll !== undefined
      ? { type: 'ROLL_DICE' }
      : rollForJail !== undefined && useCard === undefined && payFine === undefined
        ? { type: 'ROLL_FOR_JAIL' }
        : buy !== undefined
          ? { type: 'BUY_PROPERTY' }
          : endTurn !== undefined
            ? { type: 'END_TURN' }
            : settle !== undefined
              ? { type: 'SETTLE_DEBT' }
              : null;

  return (
    <div
      className={cn(
        'glass w-full rounded-2xl p-4 shadow-popover',
        variant === 'centre' ? 'max-w-[min(94%,400px)] @max-[500px]/board:hidden' : '',
      )}
    >
      {props.hotkeys === true && primary !== null && (
        <Hotkey disabled={locked} onPress={() => act(primary)} />
      )}

      {renderBody()}

      {(canManage || offerTrade !== undefined || withdraw !== undefined) &&
        state.phase.kind !== 'game_over' && (
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-white/5 pt-3">
            {canManage && (
              <Button size="sm" variant="ghost" onClick={props.onOpenPortfolio}>
                <StackIcon className="size-4" /> Build &amp; mortgage
              </Button>
            )}
            {offerTrade !== undefined && (
              <Button size="sm" variant="ghost" onClick={props.onOpenTrade}>
                <SwapIcon className="size-4" /> Trade
              </Button>
            )}
            {withdraw !== undefined && (
              <Button size="sm" variant="ghost" onClick={props.onReviewTrade}>
                <SwapIcon className="size-4" /> Your offer is out
              </Button>
            )}
          </div>
        )}

      {refusal !== null && (
        <p role="alert" className="mt-3 rounded-lg bg-bad/10 px-3 py-2 text-sm text-[#ffc2ba]">
          {refusal.message}
        </p>
      )}
    </div>
  );

  function renderBody() {
    if (state === null) return null;

    if (state.phase.kind === 'game_over') {
      return <Headline title="Game over" detail="Thanks for playing." />;
    }

    if (accept !== undefined && state.openTrade !== null) {
      const from = game.players.find((p) => p.id === state.openTrade?.fromId);
      return (
        <div className="flex flex-col gap-3">
          <Headline
            title={`${from?.name ?? 'Someone'} wants to trade`}
            detail="Take a look at the offer."
          />
          <Button variant="primary" size="lg" onClick={props.onReviewTrade}>
            <SwapIcon className="size-5" /> Review the offer
          </Button>
        </div>
      );
    }

    if (state.phase.kind === 'auction') {
      return (
        <AuctionPanel
          game={game}
          pending={pending}
          onAct={act}
          firesTimeout={props.firesAuctionTimeout}
        />
      );
    }

    if (state.phase.kind === 'awaiting_debt' && state.phase.debtorId === you) {
      const creditorId = state.phase.creditorId;
      const creditor =
        creditorId === null
          ? 'the bank'
          : (game.players.find((p) => p.id === creditorId)?.name ?? 'another player');
      const cash = state.players[you]?.cash ?? 0;
      const owed = state.phase.amount;
      return (
        <div className="flex flex-col gap-3">
          <Headline
            tone="bad"
            title={`You owe ${money(owed)}`}
            detail={`To ${creditor}. You have ${money(cash)} in hand — sell buildings or mortgage to raise the rest.`}
          />
          <div className="h-2 overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-gradient-to-r from-bad to-warn transition-[width] duration-500"
              style={{ width: `${Math.min(100, (cash / owed) * 100)}%` }}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            {settle !== undefined && (
              <Button
                variant="good"
                size="lg"
                className="flex-1"
                disabled={locked}
                onClick={() => act({ type: 'SETTLE_DEBT' })}
              >
                Pay {money(settle.amount)}
              </Button>
            )}
            {canManage && (
              <Button
                variant={settle === undefined ? 'primary' : 'secondary'}
                size="lg"
                className="flex-1"
                onClick={props.onOpenPortfolio}
              >
                Raise money
              </Button>
            )}
          </div>
          {bankrupt !== undefined && (
            <BankruptButton
              disabled={locked}
              onConfirm={() => act({ type: 'DECLARE_BANKRUPTCY' })}
            />
          )}
        </div>
      );
    }

    if (state.phase.kind === 'awaiting_debt') {
      const debtorId = state.phase.debtorId;
      const debtor = game.players.find((p) => p.id === debtorId);
      return <Waiting text={`${debtor?.name ?? 'Someone'} is raising money…`} />;
    }

    if (decline !== undefined) {
      const square = getSquare(pack, decline.squareId);
      const band =
        square.kind === 'property' ? `var(--color-${square.group})` : 'var(--color-group-rail)';
      const price = 'price' in square ? square.price : 0;
      const cash = state.players[you]?.cash ?? 0;
      return (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <span className="h-10 w-2 shrink-0 rounded-full" style={{ background: band }} />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold uppercase tracking-wider text-text-faint">
                For sale
              </p>
              <p className="truncate font-display text-xl font-bold leading-tight">{square.name}</p>
            </div>
            <p className="font-display text-2xl font-bold text-gold-bright">{money(price)}</p>
          </div>
          {buy === undefined && (
            <p className="text-sm text-text-muted">
              You have {money(cash)} — not enough to buy outright.
            </p>
          )}
          <div className="flex gap-2">
            {buy !== undefined && (
              <Button
                variant="primary"
                size="lg"
                className="flex-1"
                disabled={locked}
                onClick={() => act({ type: 'BUY_PROPERTY' })}
              >
                Buy for {money(buy.price)}
              </Button>
            )}
            <Button
              variant="secondary"
              size="lg"
              className={buy === undefined ? 'flex-1' : ''}
              disabled={locked}
              onClick={() => act({ type: 'DECLINE_PURCHASE' })}
            >
              {state.config.auctionOnDecline ? 'Auction it' : 'Pass'}
            </Button>
          </div>
        </div>
      );
    }

    if (rollForJail !== undefined) {
      return (
        <div className="flex flex-col gap-3">
          <Headline
            icon={<BarsIcon className="size-5" />}
            title="You're in the Gaol"
            detail={`Roll a double to walk free — ${rollForJail.attemptsRemaining} ${rollForJail.attemptsRemaining === 1 ? 'try' : 'tries'} left.`}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              variant="primary"
              size="lg"
              className="flex-1"
              disabled={locked}
              onClick={() => act({ type: 'ROLL_FOR_JAIL' })}
            >
              Roll for doubles
            </Button>
            {useCard !== undefined && (
              <Button
                variant="good"
                size="lg"
                disabled={locked}
                onClick={() => act({ type: 'USE_JAIL_CARD' })}
              >
                <KeyIcon className="size-4" /> Use card
              </Button>
            )}
            {payFine !== undefined && (
              <Button
                variant="secondary"
                size="lg"
                disabled={locked}
                onClick={() => act({ type: 'PAY_JAIL_FINE' })}
              >
                Pay {money(payFine.fine)}
              </Button>
            )}
          </div>
        </div>
      );
    }

    if (roll !== undefined) {
      return (
        <div className="flex flex-col items-stretch gap-2">
          <Button
            variant="primary"
            size="xl"
            disabled={locked}
            onClick={() => act({ type: 'ROLL_DICE' })}
            className={cn('w-full text-xl', !locked && 'animate-pulse-ring')}
          >
            Roll the dice
          </Button>
          {props.hotkeys === true && variant === 'centre' && (
            <p className="text-center text-xs text-text-faint">
              or press <kbd className="rounded bg-white/10 px-1.5 py-0.5 font-sans">Space</kbd>
            </p>
          )}
        </div>
      );
    }

    if (endTurn !== undefined) {
      return (
        <div className="flex flex-col gap-2">
          <Button
            variant="primary"
            size="lg"
            disabled={locked}
            onClick={() => act({ type: 'END_TURN' })}
            className="w-full"
          >
            End turn
          </Button>
          {canManage && (
            <p className="text-center text-xs text-text-faint">
              You can build or mortgage before you finish.
            </p>
          )}
        </div>
      );
    }

    return <Waiting text={active === undefined ? 'Waiting…' : `${active.name} is playing…`} />;
  }
}

function Headline({
  title,
  detail,
  tone,
  icon,
}: {
  readonly title: string;
  readonly detail?: string;
  readonly tone?: 'bad';
  readonly icon?: React.ReactNode;
}) {
  return (
    <div>
      <p
        className={cn(
          'flex items-center gap-2 font-display text-xl font-bold leading-tight',
          tone === 'bad' && 'text-[#ffb4aa]',
        )}
      >
        {icon}
        {title}
      </p>
      {detail !== undefined && <p className="mt-1 text-sm text-text-muted">{detail}</p>}
    </div>
  );
}

function Waiting({ text }: { readonly text: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-2 text-text-muted">
      <span className="flex gap-1" aria-hidden="true">
        {[0, 1, 2].map((dot) => (
          <span
            key={dot}
            className="size-1.5 animate-bounce rounded-full bg-gold/70"
            style={{ animationDelay: `${dot * 120}ms` }}
          />
        ))}
      </span>
      <span className="text-sm font-medium">{text}</span>
    </div>
  );
}

function BankruptButton({
  disabled,
  onConfirm,
}: {
  readonly disabled: boolean;
  readonly onConfirm: () => void;
}) {
  const [armed, setArmed] = useState(false);
  return armed ? (
    <div className="flex items-center gap-2 rounded-xl bg-bad/10 p-2">
      <p className="flex-1 pl-1 text-sm text-[#ffc2ba]">
        Everything you own goes to your creditor.
      </p>
      <Button size="sm" variant="ghost" onClick={() => setArmed(false)}>
        Cancel
      </Button>
      <Button size="sm" variant="danger" disabled={disabled} onClick={onConfirm}>
        Go bankrupt
      </Button>
    </div>
  ) : (
    <Button
      size="sm"
      variant="ghost"
      className="self-start text-[#ff9d92]"
      onClick={() => setArmed(true)}
    >
      Declare bankruptcy…
    </Button>
  );
}

/** Space or Enter presses the obvious button, unless you are typing. */
function Hotkey({
  disabled,
  onPress,
}: {
  readonly disabled: boolean;
  readonly onPress: () => void;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (disabled || event.repeat) return;
      if (event.key !== ' ' && event.key !== 'Enter') return;
      const target = event.target as HTMLElement | null;
      if (target !== null && /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(target.tagName)) return;
      if (document.querySelector('[role="dialog"]') !== null) return;
      event.preventDefault();
      onPress();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [disabled, onPress]);
  return null;
}
