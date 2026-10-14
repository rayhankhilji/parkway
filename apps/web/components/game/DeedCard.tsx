'use client';

import {
  getBoardPack,
  getSquare,
  rentFor,
  unmortgageCost,
  type PublicGameState,
  type SquareId,
} from '@parkway/engine';
import { BoltIcon, DropIcon, TrainIcon } from '@/components/board/icons';
import type { PlayerSummary } from '@/lib/apiClient';
import { cn } from '@/lib/cn';
import { formatMoney } from '@/lib/format';
import { rulesView } from '@/lib/rulesView';

/**
 * A title deed, printed like the card you would hold in your hand.
 *
 * The figures are the board pack's own and the "rent now" line is the engine's
 * `rentFor`, asked directly — a deed card that computed its own rent would be a
 * second copy of the rule that most often goes subtly wrong.
 */
export function DeedCard({
  state,
  squareId,
  players,
  youId,
  className,
}: {
  readonly state: PublicGameState;
  readonly squareId: SquareId;
  readonly players: readonly PlayerSummary[];
  readonly youId: string;
  readonly className?: string;
}) {
  const pack = getBoardPack(state.boardPackId);
  const square = getSquare(pack, squareId);
  const money = (amount: number) => formatMoney(amount, pack.currencySymbol);
  const deed = state.deeds[squareId];
  const owner = deed?.ownerId == null ? null : players.find((p) => p.id === deed.ownerId);

  const shell = cn(
    'paper w-full overflow-hidden rounded-2xl text-ink shadow-popover ring-1 ring-black/20',
    className,
  );

  if (square.kind !== 'property' && square.kind !== 'transit' && square.kind !== 'utility') {
    return (
      <div className={cn(shell, 'p-5 text-center')}>
        <p className="font-display text-xl font-bold italic">{square.name}</p>
        <p className="mt-2 text-sm text-ink-muted">
          {describeSpecial(square, money, pack.jail.fine)}
        </p>
      </div>
    );
  }

  const view = rulesView(state);
  const rentNow =
    deed?.ownerId != null && square.kind !== 'utility'
      ? rentFor(view, squareId, '\u0000', null)
      : null;
  const level = deed === undefined ? 0 : deed.hotels > 0 ? 5 : deed.houses;
  const doubled =
    square.kind === 'property' && level === 0 && rentNow !== null && rentNow > square.rent[0];

  return (
    <div className={shell}>
      {square.kind === 'property' ? (
        <div
          className="m-2 rounded-xl px-4 py-3 text-center ring-1 ring-black/20"
          style={{ background: `var(--color-${square.group})` }}
        >
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-black/55">
            Title deed
          </p>
          <p className="font-display text-xl font-black leading-tight text-black/85 [text-shadow:0_1px_0_rgb(255_255_255/0.25)]">
            {square.name}
          </p>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-1 px-4 pb-1 pt-4">
          {square.kind === 'transit' ? (
            <TrainIcon className="size-8" />
          ) : /water/i.test(square.name) ? (
            <DropIcon className="size-8 text-group-8" />
          ) : (
            <BoltIcon className="size-8 text-group-4" />
          )}
          <p className="font-display text-xl font-black leading-tight">{square.name}</p>
        </div>
      )}

      <div className="px-5 pb-4 pt-2 text-sm">
        {square.kind === 'property' && (
          <table className="w-full">
            <tbody>
              {(
                [
                  'Rent',
                  'With 1 house',
                  'With 2 houses',
                  'With 3 houses',
                  'With 4 houses',
                  'With a hotel',
                ] as const
              ).map((label, index) => (
                <tr
                  key={label}
                  className={cn(
                    'transition-colors',
                    deed?.ownerId != null && index === level && 'bg-gold/25 font-bold',
                  )}
                >
                  <td className="rounded-l-md py-0.5 pl-2">{label}</td>
                  <td className="rounded-r-md py-0.5 pr-2 text-right tabular-nums">
                    {money(square.rent[index] ?? 0)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {square.kind === 'transit' && (
          <table className="w-full">
            <tbody>
              {pack.transit.rentByCount.map((rent, index) => (
                <tr key={index}>
                  <td className="py-0.5 pl-2">
                    {index === 0 ? 'Rent' : `If ${index + 1} stations are owned`}
                  </td>
                  <td className="py-0.5 pr-2 text-right tabular-nums">{money(rent)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {square.kind === 'utility' && (
          <div className="space-y-1.5 px-2 text-center text-[13px] leading-snug">
            {pack.utility.multiplierByCount.map((multiplier, index) => (
              <p key={index}>
                {index === 0 ? 'With one utility owned' : 'With both owned'}, rent is{' '}
                <b>{multiplier}×</b> the dice roll.
              </p>
            ))}
          </div>
        )}

        <div className="mt-3 space-y-0.5 border-t border-ink/15 pt-2 text-[13px]">
          <Row label="Price" value={money(square.price)} />
          {square.kind === 'property' && (
            <Row label="Each house or hotel" value={money(square.buildCost)} />
          )}
          <Row label="Mortgage value" value={money(square.mortgageValue)} />
          {deed?.mortgaged === true && (
            <Row label="Clear the mortgage" value={money(unmortgageCost(view, squareId))} />
          )}
        </div>

        {square.kind === 'property' && (
          <p className="mt-2 text-center text-[11px] text-ink-muted">
            Rent doubles on unimproved lots when one player owns the whole set.
          </p>
        )}
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-ink/10 bg-ink/[0.04] px-5 py-2.5 text-[13px]">
        {owner == null ? (
          <span className="font-semibold text-ink-muted">Unowned · the bank holds it</span>
        ) : (
          <span className="flex items-center gap-2 font-semibold">
            <span
              className="size-3 rounded-full ring-1 ring-black/30"
              style={{ background: `var(--color-player-${owner.colour})` }}
            />
            {owner.id === youId ? 'Yours' : owner.name}
            {deed?.mortgaged === true && <span className="text-bad">· mortgaged</span>}
          </span>
        )}
        {rentNow !== null && (
          <span className="font-semibold">
            Rent now <b className="tabular-nums">{money(rentNow)}</b>
            {doubled && <span className="ml-1 text-good">×2</span>}
          </span>
        )}
      </div>
    </div>
  );
}

function Row({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="flex justify-between px-2">
      <span className="text-ink-muted">{label}</span>
      <span className="font-semibold tabular-nums">{value}</span>
    </div>
  );
}

function describeSpecial(
  square: ReturnType<typeof getSquare>,
  money: (amount: number) => string,
  fine: number,
): string {
  switch (square.kind) {
    case 'start':
      return 'Collect your salary every time you pass or land here.';
    case 'card':
      return square.deck === 'chance'
        ? 'Draw a Fortune card. Anything can happen.'
        : 'Draw a Civic Fund card. Usually good news.';
    case 'tax':
      return square.percentageRate === null
        ? `Pay ${money(square.flatAmount)} to the bank.`
        : `Pay ${money(square.flatAmount)} — or a share of your net worth, if the house rules say so.`;
    case 'jail':
      return `Just visiting, unless you were sent here. Get out with a double, a release card, or a ${money(fine)} fine.`;
    case 'free_parking':
      return 'A free rest. Nothing happens here — unless you play with the pot.';
    case 'go_to_jail':
      return 'Go directly to the Gaol. Do not pass the start, do not collect a salary.';
    default:
      return '';
  }
}
