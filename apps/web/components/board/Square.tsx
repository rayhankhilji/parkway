'use client';

import type { DeedState, PublicGameState, Square as BoardSquare } from '@parkway/engine';
import { cn } from '@/lib/cn';
import { formatMoney } from '@/lib/format';
import { groupBarClass, labelRotationClass, type Placement } from './layout';
import { Token } from './Token';

/**
 * One square.
 *
 * Everything here is presentation. The component is handed a square from the
 * board pack, its deed if it has one, and whoever is standing on it — it works
 * nothing out for itself. No rent, no affordability, no whose-turn-is-it. Those
 * are rules, and rules live in the engine.
 *
 * The group colour is a bar on the outward edge rather than a fill, because a
 * filled square is unreadable behind a token and reads cheap (→ DESIGN).
 */

export type SquareProps = {
  readonly square: BoardSquare;
  readonly placement: Placement;
  readonly deed: DeedState | undefined;
  readonly occupants: readonly { readonly playerId: string; readonly colour: string }[];
  readonly currency: string;
  readonly ownerColour: string | null;
  readonly isActive: boolean;
};

export function Square({
  square,
  placement,
  deed,
  occupants,
  currency,
  ownerColour,
  isActive,
}: SquareProps) {
  const group = square.kind === 'property' ? square.group : null;
  const barColour =
    group !== null
      ? `var(--color-${group})`
      : square.kind === 'transit'
        ? 'var(--color-group-rail)'
        : square.kind === 'utility'
          ? 'var(--color-group-utility)'
          : null;

  const price = 'price' in square ? square.price : null;
  const mortgaged = deed?.mortgaged === true;

  return (
    <div
      style={{ gridColumn: placement.column, gridRow: placement.row }}
      className={cn(
        'relative flex min-w-0 flex-col items-center justify-center overflow-hidden',
        'rounded-sm border border-border bg-surface p-1',
        isActive && 'bg-surface-raised',
      )}
      data-square={square.id}
    >
      {barColour !== null && (
        <span
          aria-hidden="true"
          className={cn('absolute', groupBarClass[placement.edge])}
          style={{ backgroundColor: barColour }}
        />
      )}

      {/* Ownership reads as a ring in the owner's colour, not a fill. */}
      {ownerColour !== null && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 rounded-sm ring-2 ring-inset"
          style={{
            color: `var(--color-player-${ownerColour})`,
            boxShadow: 'inset 0 0 0 2px currentColor',
          }}
        />
      )}

      {mortgaged && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage:
              'repeating-linear-gradient(45deg, rgb(255 255 255 / 0.12) 0 2px, transparent 2px 6px)',
          }}
        />
      )}

      <div
        className={cn(
          'flex min-w-0 flex-col items-center gap-1 text-center',
          labelRotationClass[placement.edge],
        )}
      >
        <span
          className={cn(
            'text-xs uppercase tracking-[0.04em]',
            mortgaged ? 'text-text-faint' : 'text-text-muted',
          )}
        >
          {square.name}
        </span>
        {price !== null && (
          <span className="font-mono text-xs text-money tabular-nums">
            {formatMoney(price, currency)}
          </span>
        )}
      </div>

      {deed !== undefined && <Buildings deed={deed} edge={placement.edge} />}

      {occupants.length > 0 && (
        <div className="absolute inset-x-0 bottom-1 flex flex-wrap items-center justify-center gap-1">
          {occupants.map((occupant) => (
            <Token key={occupant.playerId} colour={occupant.colour} />
          ))}
        </div>
      )}
    </div>
  );
}

/** Up to four houses along the group bar; a hotel replaces them with one bar. */
function Buildings({ deed, edge }: { deed: DeedState; edge: Placement['edge'] }) {
  if (deed.hotels === 0 && deed.houses === 0) return null;

  const vertical = edge === 'left' || edge === 'right';

  return (
    <div
      aria-hidden="true"
      className={cn(
        'absolute flex items-center justify-center gap-[2px]',
        vertical ? 'inset-y-0 flex-col' : 'inset-x-0',
        edge === 'bottom' && 'bottom-[6px]',
        edge === 'top' && 'top-[6px]',
        edge === 'left' && 'left-[6px]',
        edge === 'right' && 'right-[6px]',
      )}
    >
      {deed.hotels > 0 ? (
        <span className="h-[6px] w-[14px] rounded-[1px] bg-success" />
      ) : (
        Array.from({ length: deed.houses }, (_, index) => (
          <span key={index} className="size-[6px] rounded-[1px] bg-success" />
        ))
      )}
    </div>
  );
}

/** Reads the deed for a square out of public state, or undefined if unownable. */
export function deedOf(state: PublicGameState, squareId: number): DeedState | undefined {
  return state.deeds[squareId];
}
