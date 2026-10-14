'use client';

import { useEffect, useRef, useState } from 'react';
import { getBoardPack, getSquare, type Action, type LegalAction } from '@parkway/engine';
import { GavelIcon } from '@/components/board/icons';
import { Button } from '@/components/ui/Button';
import type { GamePayload } from '@/lib/apiClient';
import { cn } from '@/lib/cn';
import { formatMoney } from '@/lib/format';
import { sfx } from '@/lib/sound';

/**
 * The auction block: the lot, the standing bid, a draining clock, and bids
 * you can place with one tap.
 *
 * The bid range comes from the engine's PLACE_BID entry — minimum and maximum
 * both — so the quick-bid chips can never offer a bid the reducer would refuse.
 */
export function AuctionPanel({
  game,
  pending,
  onAct,
  firesTimeout,
}: {
  readonly game: GamePayload;
  readonly pending: Action['type'] | null;
  readonly onAct: (action: Action) => void;
  readonly firesTimeout: boolean;
}) {
  const state = game.publicState;
  const phase = state?.phase;
  const [remaining, now] = useCountdown(phase?.kind === 'auction' ? phase.deadlineAt : null);
  const [custom, setCustom] = useState('');
  const fired = useRef<{ deadline: number; at: number } | null>(null);

  const deadline = phase?.kind === 'auction' ? phase.deadlineAt : null;

  // Online, whichever client sees the deadline pass first closes the lot. A
  // client whose clock runs ahead of the server's is refused, so it retries.
  useEffect(() => {
    if (!firesTimeout || deadline === null || remaining > 0 || pending !== null) return;
    const last = fired.current;
    if (last !== null && last.deadline === deadline && now - last.at < 2000) return;
    fired.current = { deadline, at: now };
    onAct({ type: 'AUCTION_TIMEOUT' });
  }, [firesTimeout, deadline, remaining, now, pending, onAct]);

  // The last five seconds tick.
  const whole = Math.ceil(remaining / 1000);
  const lastTick = useRef<number | null>(null);
  useEffect(() => {
    if (whole > 0 && whole <= 5 && lastTick.current !== whole) {
      lastTick.current = whole;
      sfx.tick();
    }
  }, [whole]);

  if (state === null || phase?.kind !== 'auction') return null;

  const pack = getBoardPack(state.boardPackId);
  const money = (amount: number) => formatMoney(amount, pack.currencySymbol);
  const square = getSquare(pack, phase.squareId);
  const band =
    square.kind === 'property' ? `var(--color-${square.group})` : 'var(--color-group-rail)';
  const listPrice = 'price' in square ? square.price : 0;
  const you = game.you.playerId;

  const bid = game.legalActions.find(
    (action): action is Extract<LegalAction, { type: 'PLACE_BID' }> => action.type === 'PLACE_BID',
  );
  const canPass = game.legalActions.some((action) => action.type === 'PASS_BID');
  const leader = game.players.find((player) => player.id === phase.highBidderId);
  const leading = phase.highBidderId === you;
  const stillIn = phase.activeBidderIds.includes(you);

  const total = state.config.auctionSeconds * 1000;
  const fraction = Math.max(0, Math.min(1, remaining / total));

  const quick =
    bid === undefined
      ? []
      : [...new Set([bid.minimum, bid.minimum + 10, bid.minimum + 50, bid.minimum + 100])]
          .filter((amount) => amount <= bid.maximum)
          .slice(0, 4);

  const customAmount = Number.parseInt(custom, 10);
  const customValid =
    bid !== undefined &&
    Number.isFinite(customAmount) &&
    customAmount >= bid.minimum &&
    customAmount <= bid.maximum;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <span className="h-10 w-2 shrink-0 rounded-full" style={{ background: band }} />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-gold">
            <GavelIcon className="size-3.5" /> Auction · list {money(listPrice)}
          </p>
          <p className="truncate font-display text-xl font-bold leading-tight">{square.name}</p>
        </div>
        <Clock fraction={fraction} seconds={whole} />
      </div>

      <div
        className={cn(
          'flex items-center justify-between rounded-xl px-3 py-2.5 ring-1 ring-inset transition-colors',
          leading ? 'bg-good/10 ring-good/30' : 'bg-black/25 ring-white/5',
        )}
      >
        <span className="text-sm text-text-muted">
          {leader === undefined ? (
            'No bids yet'
          ) : (
            <span className="flex items-center gap-2">
              <span
                className="size-2.5 rounded-full"
                style={{ background: `var(--color-player-${leader.colour})` }}
              />
              {leading ? 'You lead' : `${leader.name} leads`}
            </span>
          )}
        </span>
        <span
          key={phase.highBid}
          className="animate-pop-in font-display text-2xl font-bold tabular-nums text-gold-bright"
        >
          {money(phase.highBid)}
        </span>
      </div>

      {bid !== undefined ? (
        <>
          <div className="grid grid-cols-4 gap-1.5">
            {quick.map((amount) => (
              <Button
                key={amount}
                size="md"
                variant={amount === bid.minimum ? 'primary' : 'secondary'}
                disabled={pending !== null}
                onClick={() => onAct({ type: 'PLACE_BID', amount })}
                className="px-1 tabular-nums"
              >
                {money(amount)}
              </Button>
            ))}
          </div>
          <form
            className="flex gap-1.5"
            onSubmit={(event) => {
              event.preventDefault();
              if (customValid) {
                onAct({ type: 'PLACE_BID', amount: customAmount });
                setCustom('');
              }
            }}
          >
            <label className="sr-only" htmlFor="custom-bid">
              Your bid
            </label>
            <input
              id="custom-bid"
              inputMode="numeric"
              value={custom}
              onChange={(event) => setCustom(event.target.value.replace(/[^0-9]/g, ''))}
              placeholder={`${money(bid.minimum)} – ${money(bid.maximum)}`}
              className="h-10 min-w-0 flex-1 rounded-xl border border-white/10 bg-black/30 px-3 text-sm tabular-nums text-text placeholder:text-text-faint focus:border-gold/60 focus:outline-none"
            />
            <Button
              type="submit"
              size="md"
              variant="secondary"
              disabled={!customValid || pending !== null}
            >
              Bid
            </Button>
            {canPass && (
              <Button
                size="md"
                variant="ghost"
                disabled={pending !== null}
                onClick={() => onAct({ type: 'PASS_BID' })}
              >
                Pass
              </Button>
            )}
          </form>
        </>
      ) : canPass ? (
        <Button
          variant="secondary"
          disabled={pending !== null}
          onClick={() => onAct({ type: 'PASS_BID' })}
        >
          Pass
        </Button>
      ) : (
        <p className="text-center text-sm text-text-muted">
          {leading
            ? 'Hold your nerve — the lot is yours if nobody beats you.'
            : stillIn
              ? 'Waiting…'
              : 'You are out of this auction.'}
        </p>
      )}
    </div>
  );
}

function Clock({ fraction, seconds }: { readonly fraction: number; readonly seconds: number }) {
  const radius = 17;
  const circumference = 2 * Math.PI * radius;
  const urgent = seconds <= 5;
  return (
    <div className="relative size-11 shrink-0" aria-label={`${seconds} seconds left`}>
      <svg viewBox="0 0 40 40" className="size-full -rotate-90">
        <circle
          cx="20"
          cy="20"
          r={radius}
          fill="none"
          stroke="rgb(255 255 255 / 0.1)"
          strokeWidth="3.5"
        />
        <circle
          cx="20"
          cy="20"
          r={radius}
          fill="none"
          stroke={urgent ? 'var(--color-bad)' : 'var(--color-gold)'}
          strokeWidth="3.5"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - fraction)}
          className="transition-[stroke-dashoffset] duration-200 ease-linear"
        />
      </svg>
      <span
        className={cn(
          'absolute inset-0 flex items-center justify-center text-sm font-bold tabular-nums',
          urgent ? 'text-bad' : 'text-text',
        )}
      >
        {Math.max(0, seconds)}
      </span>
    </div>
  );
}

function useCountdown(deadline: number | null): readonly [number, number] {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (deadline === null) return;
    const timer = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(timer);
  }, [deadline]);
  return [deadline === null ? 0 : Math.max(0, deadline - now), now];
}
