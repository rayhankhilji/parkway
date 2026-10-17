'use client';

import { useMemo, useState } from 'react';
import {
  getBoardPack,
  getSquare,
  type Action,
  type PublicGameState,
  type SquareId,
  type TradeSide,
} from '@parkway/engine';
import { KeyIcon, SwapIcon } from '@/components/board/icons';
import { Token } from '@/components/board/TokenLayer';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import type { GamePayload, PlayerSummary } from '@/lib/apiClient';
import { cn } from '@/lib/cn';
import { formatMoney } from '@/lib/format';

/**
 * Making a deal, and answering one.
 *
 * The composer lets you put anything you hold on the table; the engine is the
 * one that says whether the deal stands. The only thing greyed out ahead of
 * time is a lot with buildings on it, because the reason is visible on the
 * board and a refusal after composing the whole deal would just be unkind.
 */

const empty: TradeSide = { cash: 0, deedIds: [], jailCards: 0 };

export function TradeComposer({
  open,
  onClose,
  game,
  onAct,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly game: GamePayload;
  readonly onAct: (action: Action) => void;
}) {
  const state = game.publicState;
  const offer = game.legalActions.find((action) => action.type === 'OFFER_TRADE');
  const candidates = offer !== undefined && offer.type === 'OFFER_TRADE' ? offer.candidateIds : [];
  const [partnerId, setPartnerId] = useState<string | null>(null);
  const [give, setGive] = useState<TradeSide>(empty);
  const [get, setGet] = useState<TradeSide>(empty);

  const partner = partnerId ?? candidates[0] ?? null;
  const you = game.you.playerId;

  const reset = () => {
    setGive(empty);
    setGet(empty);
  };

  if (state === null) return null;
  const pack = getBoardPack(state.boardPackId);
  const money = (amount: number) => formatMoney(amount, pack.currencySymbol);

  const isEmpty =
    give.cash === 0 &&
    give.deedIds.length === 0 &&
    give.jailCards === 0 &&
    get.cash === 0 &&
    get.deedIds.length === 0 &&
    get.jailCards === 0;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Propose a trade"
      subtitle="Pick what changes hands. They can accept or turn it down."
      className="sm:max-w-3xl"
      footer={
        <>
          <Button variant="ghost" onClick={reset} disabled={isEmpty}>
            Clear
          </Button>
          <Button
            variant="primary"
            disabled={partner === null || isEmpty}
            onClick={() => {
              if (partner === null) return;
              onAct({ type: 'OFFER_TRADE', toId: partner, offered: give, requested: get });
              reset();
              onClose();
            }}
          >
            <SwapIcon className="size-4" /> Send offer
          </Button>
        </>
      }
    >
      <div className="mb-4 flex flex-wrap gap-2">
        {candidates.map((id) => {
          const player = game.players.find((p) => p.id === id);
          if (player === undefined) return null;
          const selected = id === partner;
          return (
            <button
              key={id}
              type="button"
              onClick={() => {
                setPartnerId(id);
                setGet(empty);
              }}
              className={cn(
                'flex items-center gap-2 rounded-full py-1.5 pl-1.5 pr-3.5 text-sm font-semibold transition active:scale-95',
                selected
                  ? 'bg-gold/15 text-gold-bright ring-1 ring-gold/60'
                  : 'bg-white/5 text-text-muted ring-1 ring-white/10 hover:text-text',
              )}
            >
              <span className="size-6">
                <Token colour={player.colour} initial={player.name} labelClassName="text-xs" />
              </span>
              {player.name}
            </button>
          );
        })}
      </div>

      {partner !== null && (
        <div className="grid gap-3 md:grid-cols-2">
          <SidePicker
            title="You give"
            state={state}
            ownerId={you}
            side={give}
            onChange={setGive}
            money={money}
          />
          <SidePicker
            title={`You get from ${game.players.find((p) => p.id === partner)?.name ?? 'them'}`}
            state={state}
            ownerId={partner}
            side={get}
            onChange={setGet}
            money={money}
          />
        </div>
      )}
    </Dialog>
  );
}

function SidePicker({
  title,
  state,
  ownerId,
  side,
  onChange,
  money,
}: {
  readonly title: string;
  readonly state: PublicGameState;
  readonly ownerId: string;
  readonly side: TradeSide;
  readonly onChange: (side: TradeSide) => void;
  readonly money: (amount: number) => string;
}) {
  const pack = getBoardPack(state.boardPackId);
  const player = state.players[ownerId];
  const cash = player?.cash ?? 0;
  const cards = player?.heldJailCards.length ?? 0;
  const deeds = useMemo(
    () => pack.squares.filter((square) => state.deeds[square.id]?.ownerId === ownerId),
    [pack, state.deeds, ownerId],
  );

  const toggle = (id: SquareId) =>
    onChange({
      ...side,
      deedIds: side.deedIds.includes(id)
        ? side.deedIds.filter((d) => d !== id)
        : [...side.deedIds, id],
    });

  return (
    <section className="flex flex-col gap-3 rounded-2xl bg-black/25 p-4 ring-1 ring-inset ring-white/5">
      <h3 className="text-sm font-semibold">{title}</h3>

      <div>
        <div className="mb-1 flex justify-between text-xs text-text-faint">
          <span>Cash</span>
          <span className="tabular-nums">
            <b className="text-gold-bright">{money(side.cash)}</b> of {money(cash)}
          </span>
        </div>
        <input
          type="range"
          min={0}
          max={cash}
          step={10}
          value={Math.min(side.cash, cash)}
          onChange={(event) => onChange({ ...side, cash: Number(event.target.value) })}
          className="w-full accent-gold"
          aria-label={`${title}: cash`}
        />
      </div>

      {deeds.length === 0 ? (
        <p className="text-xs text-text-faint">No property.</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {deeds.map((square) => {
            const full = getSquare(pack, square.id);
            const deed = state.deeds[square.id];
            const built = deed !== undefined && (deed.houses > 0 || deed.hotels > 0);
            const colour =
              full.kind === 'property'
                ? `var(--color-${full.group})`
                : full.kind === 'transit'
                  ? 'var(--color-group-rail)'
                  : 'var(--color-group-utility)';
            const selected = side.deedIds.includes(square.id);
            return (
              <button
                key={square.id}
                type="button"
                disabled={built}
                title={built ? 'Sell the buildings before trading this lot' : undefined}
                onClick={() => toggle(square.id)}
                className={cn(
                  'flex items-center gap-1.5 rounded-lg py-1 pl-1 pr-2.5 text-xs font-medium transition active:scale-95',
                  selected
                    ? 'bg-ivory text-ink ring-2 ring-gold'
                    : 'bg-white/5 text-text-muted ring-1 ring-white/10 hover:text-text',
                  built && 'cursor-not-allowed opacity-40',
                  deed?.mortgaged === true && 'italic',
                )}
              >
                <span className="h-4 w-1.5 rounded-sm" style={{ background: colour }} />
                {square.name}
              </button>
            );
          })}
        </div>
      )}

      {cards > 0 && (
        <label className="flex items-center gap-2 text-xs text-text-muted">
          <KeyIcon className="size-4" />
          Release cards
          <input
            type="number"
            min={0}
            max={cards}
            value={side.jailCards}
            onChange={(event) =>
              onChange({
                ...side,
                jailCards: Math.max(0, Math.min(cards, Number(event.target.value))),
              })
            }
            className="h-8 w-14 rounded-lg border border-white/10 bg-black/30 px-2 text-sm text-text"
          />
          <span>of {cards}</span>
        </label>
      )}
    </section>
  );
}

/** An open trade, from either end: the recipient answers, the proposer can withdraw. */
export function TradeReview({
  open,
  onClose,
  game,
  onAct,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly game: GamePayload;
  readonly onAct: (action: Action) => void;
}) {
  const state = game.publicState;
  const trade = state?.openTrade ?? null;
  if (state === null || trade === null) return null;

  const pack = getBoardPack(state.boardPackId);
  const money = (amount: number) => formatMoney(amount, pack.currencySymbol);
  const you = game.you.playerId;
  const name = (id: string) =>
    id === you
      ? 'You'
      : (game.players.find((player: PlayerSummary) => player.id === id)?.name ?? 'Someone');

  const canAnswer = game.legalActions.some((action) => action.type === 'ACCEPT_TRADE');
  const canWithdraw = game.legalActions.some((action) => action.type === 'WITHDRAW_TRADE');
  const incoming = trade.toId === you;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={
        incoming ? `${name(trade.fromId)} offers you a deal` : `Your offer to ${name(trade.toId)}`
      }
      subtitle={incoming ? 'Accept and it happens immediately.' : 'Waiting for an answer.'}
      footer={
        canAnswer ? (
          <>
            <Button
              variant="secondary"
              onClick={() => {
                onAct({ type: 'DECLINE_TRADE' });
                onClose();
              }}
            >
              Decline
            </Button>
            <Button
              variant="good"
              onClick={() => {
                onAct({ type: 'ACCEPT_TRADE' });
                onClose();
              }}
            >
              Accept the deal
            </Button>
          </>
        ) : canWithdraw ? (
          <Button
            variant="secondary"
            onClick={() => {
              onAct({ type: 'WITHDRAW_TRADE' });
              onClose();
            }}
          >
            Withdraw offer
          </Button>
        ) : (
          <Button onClick={onClose}>Close</Button>
        )
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <SideSummary
          title={incoming ? 'You get' : `${name(trade.toId)} gets`}
          side={trade.offered}
          state={state}
          money={money}
          tone="good"
        />
        <SideSummary
          title={incoming ? 'You give' : 'You get'}
          side={trade.requested}
          state={state}
          money={money}
          tone={incoming ? 'bad' : 'good'}
        />
      </div>
    </Dialog>
  );
}

function SideSummary({
  title,
  side,
  state,
  money,
  tone,
}: {
  readonly title: string;
  readonly side: TradeSide;
  readonly state: PublicGameState;
  readonly money: (amount: number) => string;
  readonly tone: 'good' | 'bad';
}) {
  const pack = getBoardPack(state.boardPackId);
  const nothing = side.cash === 0 && side.deedIds.length === 0 && side.jailCards === 0;
  return (
    <section
      className={cn(
        'rounded-2xl p-4 ring-1 ring-inset',
        tone === 'good' ? 'bg-good/5 ring-good/20' : 'bg-bad/5 ring-bad/20',
      )}
    >
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-muted">
        {title}
      </h3>
      {nothing ? (
        <p className="text-sm text-text-faint">Nothing</p>
      ) : (
        <ul className="flex flex-col gap-1.5 text-sm">
          {side.cash > 0 && (
            <li className="font-display text-xl font-bold text-gold-bright">{money(side.cash)}</li>
          )}
          {side.deedIds.map((id) => {
            const square = getSquare(pack, id);
            const colour =
              square.kind === 'property'
                ? `var(--color-${square.group})`
                : square.kind === 'transit'
                  ? 'var(--color-group-rail)'
                  : 'var(--color-group-utility)';
            return (
              <li key={id} className="flex items-center gap-2">
                <span className="h-4 w-1.5 rounded-sm" style={{ background: colour }} />
                {square.name}
                {state.deeds[id]?.mortgaged === true && (
                  <span className="text-xs text-text-faint">(mortgaged)</span>
                )}
              </li>
            );
          })}
          {side.jailCards > 0 && (
            <li className="flex items-center gap-2">
              <KeyIcon className="size-4" /> {side.jailCards} release{' '}
              {side.jailCards === 1 ? 'card' : 'cards'}
            </li>
          )}
        </ul>
      )}
    </section>
  );
}
