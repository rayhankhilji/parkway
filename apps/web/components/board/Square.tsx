'use client';

import type { DeedState, Square as BoardSquare } from '@parkway/engine';
import { cn } from '@/lib/cn';
import { formatMoney } from '@/lib/format';
import type { Placement } from './layout';
import {
  ArrowIcon,
  BarsIcon,
  BoltIcon,
  ChestIcon,
  CoinIcon,
  DropIcon,
  GavelIcon,
  GemIcon,
  HouseIcon,
  QuestionIcon,
  TrainIcon,
  TreeIcon,
} from './icons';

/**
 * One square, printed on the board.
 *
 * Each edge square is drawn once, upright, as if it sat on the bottom edge —
 * colour band towards the centre, owner's strip at the outer edge — and then
 * rotated into place. That keeps one layout for forty squares, and it is how a
 * printed board works: every name reads from the edge you would sit at.
 *
 * The top row is the exception. Rotating it a half turn would put its names
 * upside down for everyone on a screen, so it is mirrored instead.
 *
 * Everything here is presentation. No rent, no affordability, no whose turn —
 * those are rules, and rules live in the engine.
 */

export type SquareProps = {
  readonly square: BoardSquare;
  readonly placement: Placement;
  readonly deed: DeedState | undefined;
  readonly currency: string;
  readonly ownerColour: string | null;
  readonly landed: boolean;
  readonly stampKey: number | undefined;
  readonly dimmed: boolean;
  readonly onSelect: (squareId: number) => void;
};

export function Square({
  square,
  placement,
  deed,
  currency,
  ownerColour,
  landed,
  stampKey,
  dimmed,
  onSelect,
}: SquareProps) {
  const label = `${square.name}${deed?.ownerId != null ? ', owned' : ''}${deed?.mortgaged === true ? ', mortgaged' : ''}`;

  return (
    <button
      type="button"
      onClick={() => onSelect(square.id)}
      aria-label={label}
      style={{ gridColumn: placement.column, gridRow: placement.row }}
      className={cn(
        'group/sq relative min-h-0 min-w-0 overflow-hidden text-ink outline-none',
        'transition-[filter,opacity] duration-200',
        'hover:z-10 hover:brightness-[1.04] focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-gold',
        dimmed && 'opacity-45 saturate-50',
      )}
      data-square={square.id}
    >
      {placement.isCorner ? (
        <Corner square={square} placement={placement} currency={currency} />
      ) : (
        <Upright edge={placement.edge}>
          <EdgeContent
            square={square}
            deed={deed}
            currency={currency}
            ownerColour={ownerColour}
            stampKey={stampKey}
            mirrored={placement.edge === 'top'}
          />
        </Upright>
      )}

      {landed && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-10 animate-pulse-ring rounded-[2px] ring-2 ring-inset ring-gold"
        />
      )}
    </button>
  );
}

/** Lays out content as a bottom-edge square and turns it to face its edge. */
function Upright({
  edge,
  children,
}: {
  readonly edge: Placement['edge'];
  readonly children: React.ReactNode;
}) {
  if (edge === 'bottom' || edge === 'top') {
    return <div className="absolute inset-0">{children}</div>;
  }
  // Side squares are twice as wide as tall, so the upright frame is the
  // transposed box, centred and turned a quarter.
  return (
    <div
      className="absolute left-1/4 top-[-50%] h-[200%] w-1/2"
      style={{ transform: edge === 'left' ? 'rotate(90deg)' : 'rotate(-90deg)' }}
    >
      {children}
    </div>
  );
}

function EdgeContent({
  square,
  deed,
  currency,
  ownerColour,
  stampKey,
  mirrored,
}: {
  readonly square: BoardSquare;
  readonly deed: DeedState | undefined;
  readonly currency: string;
  readonly ownerColour: string | null;
  readonly stampKey: number | undefined;
  readonly mirrored: boolean;
}) {
  const mortgaged = deed?.mortgaged === true;
  const band = square.kind === 'property' ? `var(--color-${square.group})` : null;

  const price = 'price' in square ? square.price : null;

  return (
    <div className={cn('paper absolute inset-0 flex', mirrored ? 'flex-col-reverse' : 'flex-col')}>
      {band !== null ? (
        <div
          className={cn(
            'relative flex h-[22%] shrink-0 items-center justify-center gap-[3%]',
            mirrored ? 'border-t' : 'border-b',
            'border-ink/40',
          )}
          style={{
            background: `linear-gradient(${mirrored ? '0deg' : '180deg'}, color-mix(in oklab, ${band} 88%, white), ${band})`,
          }}
        >
          <Buildings deed={deed} />
        </div>
      ) : null}

      <div
        className={cn(
          'flex min-h-0 flex-1 flex-col items-center px-[6%] text-center',
          'justify-between',
          // Keep the outer edge clear for the owner's strip.
          mirrored ? 'flex-col-reverse pb-[8%] pt-[14%]' : 'pb-[14%] pt-[8%]',
        )}
      >
        <span
          className={cn(
            'block w-full text-[0.98cqw] font-semibold uppercase leading-[1.1] tracking-[0.02em] text-balance',
            '@max-[620px]/board:hidden',
            mortgaged && 'text-ink-muted line-through decoration-ink/30',
          )}
        >
          {square.name}
        </span>

        <SquareIcon square={square} />

        {price !== null ? (
          <span className="text-[0.95cqw] font-medium tabular-nums text-ink-muted @max-[620px]/board:hidden">
            {formatMoney(price, currency)}
          </span>
        ) : square.kind === 'tax' ? (
          <span className="text-[0.95cqw] font-medium tabular-nums text-ink-muted @max-[620px]/board:hidden">
            Pay {formatMoney(square.flatAmount, currency)}
          </span>
        ) : (
          <span />
        )}
      </div>

      {/* The owner's strip along the outer edge. */}
      <div
        className={cn(
          'absolute inset-x-0 h-[11%] transition-opacity duration-300',
          mirrored ? 'top-0' : 'bottom-0',
          ownerColour === null ? 'opacity-0' : 'opacity-100',
        )}
      >
        {ownerColour !== null && (
          <span
            key={stampKey}
            className="block h-full w-full animate-stamp"
            style={{
              background: `linear-gradient(${mirrored ? '180deg' : '0deg'}, color-mix(in oklab, var(--color-player-${ownerColour}) 80%, black), var(--color-player-${ownerColour}))`,
              boxShadow: '0 0 0 0.5px rgb(0 0 0 / 0.25)',
            }}
          />
        )}
      </div>

      {mortgaged && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 flex items-center justify-center"
          style={{
            backgroundImage:
              'repeating-linear-gradient(-45deg, rgb(35 29 22 / 0.13) 0 1.5px, transparent 1.5px 6px)',
          }}
        >
          <span className="rotate-[-60deg] rounded-[2px] bg-bad/90 px-[6%] text-[0.8cqw] font-bold uppercase tracking-wider text-white @max-[620px]/board:hidden">
            Mortgaged
          </span>
        </span>
      )}
    </div>
  );
}

function SquareIcon({ square }: { readonly square: BoardSquare }) {
  const size = 'w-[2.6cqw] h-[2.6cqw] @max-[620px]/board:w-[3.6cqw] @max-[620px]/board:h-[3.6cqw]';
  switch (square.kind) {
    case 'transit':
      return <TrainIcon className={size} />;
    case 'utility':
      return /water/i.test(square.name) ? (
        <DropIcon className={cn(size, 'text-group-8')} />
      ) : (
        <BoltIcon className={cn(size, 'text-group-4')} />
      );
    case 'card':
      return square.deck === 'chance' ? (
        <QuestionIcon className={cn(size, 'text-gold-deep scale-125')} />
      ) : (
        <ChestIcon className={cn(size, 'text-group-8')} />
      );
    case 'tax':
      return square.percentageRate !== null ? (
        <CoinIcon className={cn(size, 'text-gold-deep')} />
      ) : (
        <GemIcon className={cn(size, 'text-group-8')} />
      );
    default:
      return <span />;
  }
}

/** Houses as little green roofs; a hotel replaces them with one red block. */
function Buildings({ deed }: { readonly deed: DeedState | undefined }) {
  if (deed === undefined || (deed.hotels === 0 && deed.houses === 0)) return null;

  if (deed.hotels > 0) {
    return (
      <span
        className="block h-[62%] w-[42%] animate-pop-in rounded-[1px] bg-[#c8262c] shadow-[0_1px_0_rgb(0_0_0/0.4)]"
        style={{ clipPath: 'polygon(0 30%, 50% 0, 100% 30%, 100% 100%, 0 100%)' }}
      />
    );
  }

  return (
    <>
      {Array.from({ length: deed.houses }, (_, index) => (
        <HouseIcon
          key={index}
          className="h-[70%] w-[18%] animate-pop-in text-[#1f8a4c] drop-shadow-[0_1px_0_rgb(0_0_0/0.45)]"
        />
      ))}
    </>
  );
}

function Corner({
  square,
  placement,
  currency,
}: {
  readonly square: BoardSquare;
  readonly placement: Placement;
  readonly currency: string;
}) {
  const shell =
    'paper absolute inset-0 flex flex-col items-center justify-center gap-[4%] p-[6%] text-center';

  switch (square.kind) {
    case 'start':
      return (
        <div className={shell}>
          <span className="text-[0.9cqw] font-semibold uppercase leading-tight tracking-wider text-ink-muted @max-[620px]/board:hidden">
            Collect salary as you pass
          </span>
          <span className="font-display text-[2.3cqw] font-black italic leading-none text-[#b3261e]">
            {square.name.replace(/^The /, '')}
          </span>
          <ArrowIcon className="h-[3.4cqw] w-[6cqw] text-[#b3261e]" strokeWidth={2.4} />
        </div>
      );

    case 'jail':
      return (
        <div className="paper absolute inset-0">
          <div className="absolute right-0 top-0 flex h-[66%] w-[66%] flex-col items-center justify-center gap-[6%] border-b-2 border-l-2 border-ink/50 bg-[#f1a640]">
            <BarsIcon className="h-[3cqw] w-[3cqw] text-ink" />
            <span className="text-[0.95cqw] font-bold uppercase tracking-wider @max-[620px]/board:hidden">
              In gaol
            </span>
          </div>
          <span className="absolute bottom-[6%] left-[38%] -translate-x-1/2 whitespace-nowrap text-[0.85cqw] font-semibold uppercase tracking-wider text-ink-muted @max-[620px]/board:hidden">
            Just visiting
          </span>
        </div>
      );

    case 'free_parking':
      return (
        <div className={shell}>
          <TreeIcon className="h-[4cqw] w-[4cqw] text-group-7" />
          <span className="font-display text-[1.35cqw] font-bold italic leading-tight @max-[620px]/board:hidden">
            {square.name}
          </span>
          <span className="text-[0.85cqw] font-semibold uppercase tracking-wider text-ink-muted @max-[620px]/board:hidden">
            Free rest
          </span>
        </div>
      );

    case 'go_to_jail':
      return (
        <div className={shell}>
          <GavelIcon className="h-[4cqw] w-[4cqw] text-[#b3261e]" />
          <span className="font-display text-[1.25cqw] font-bold italic leading-tight @max-[620px]/board:hidden">
            {square.name}
          </span>
          <span className="text-[0.85cqw] font-semibold uppercase tracking-wider text-[#b3261e] @max-[620px]/board:hidden">
            Go to gaol
          </span>
        </div>
      );

    default:
      return (
        <div className={shell} data-edge={placement.edge}>
          <span className="text-[1cqw]">{square.name}</span>
          <span className="hidden">{currency}</span>
        </div>
      );
  }
}
