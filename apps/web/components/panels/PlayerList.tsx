'use client';

import { getBoardPack, getSquare } from '@parkway/engine';
import type { PublicGameState } from '@parkway/engine';
import type { PlayerSummary } from '@/lib/apiClient';
import { cn } from '@/lib/cn';
import { formatMoney } from '@/lib/format';

/**
 * Who is playing, what they hold, and how they are doing.
 *
 * Bankrupt players stay in the list rather than disappearing — turn order does
 * not change when someone goes out, and a player who vanished from the sidebar
 * would make the game look like it had lost track of them (→ PRD F14).
 */
export function PlayerList({
  state,
  players,
  currency,
  youId,
}: {
  readonly state: PublicGameState | null;
  readonly players: readonly PlayerSummary[];
  readonly currency: string;
  readonly youId: string;
}) {
  const pack = state === null ? null : getBoardPack(state.boardPackId);
  const activeId = state === null ? null : (state.turnOrder[state.activeIndex] ?? null);

  // Bankrupt players sort to the bottom; everyone else keeps turn order.
  const ordered = [...players].sort((a, b) => {
    const aOut = state?.players[a.id]?.bankrupt === true ? 1 : 0;
    const bOut = state?.players[b.id]?.bankrupt === true ? 1 : 0;
    if (aOut !== bOut) return aOut - bOut;
    if (state === null) return a.seat - b.seat;
    return state.turnOrder.indexOf(a.id) - state.turnOrder.indexOf(b.id);
  });

  return (
    <ul className="flex flex-col gap-2">
      {ordered.map((player) => {
        const engine = state?.players[player.id];
        const isOut = engine?.bankrupt === true;
        const holdings =
          state === null || pack === null
            ? []
            : pack.squares.filter((square) => state.deeds[square.id]?.ownerId === player.id);

        return (
          <li
            key={player.id}
            className={cn(
              'rounded-md border border-border bg-surface p-3',
              activeId === player.id && 'border-accent',
              isOut && 'opacity-40',
            )}
          >
            <div className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className="size-2 shrink-0 rounded-full"
                style={{ backgroundColor: `var(--color-player-${player.colour})` }}
              />
              <span
                className={cn(
                  'min-w-0 flex-1 truncate text-base',
                  activeId === player.id ? 'text-text' : 'text-text-muted',
                  isOut && 'line-through',
                )}
              >
                {player.name}
                {player.id === youId && <span className="text-text-faint"> · you</span>}
              </span>
              {engine !== undefined && (
                <span className="font-mono text-md font-semibold text-money tabular-nums">
                  {formatMoney(engine.cash, currency)}
                </span>
              )}
            </div>

            {engine?.inJail === true && (
              <p className="mt-1 text-sm text-text-faint">
                In the gaol · attempt {engine.jailAttempts + 1}/{pack?.jail.maxTurns ?? 3}
              </p>
            )}

            {!player.isConnected && !isOut && (
              <p className="mt-1 text-sm text-warning">Disconnected</p>
            )}

            {state !== null && pack !== null && (
              <div className="mt-2 flex flex-wrap gap-1">
                {holdings.length === 0 ? (
                  <span className="text-sm text-text-faint">No properties yet</span>
                ) : (
                  holdings.map((square) => (
                    <span
                      key={square.id}
                      title={getSquare(pack, square.id).name}
                      className="h-1 w-4 rounded-[1px]"
                      style={{ backgroundColor: chipColour(square) }}
                    />
                  ))
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function chipColour(square: ReturnType<typeof getSquare>): string {
  if (square.kind === 'property') return `var(--color-${square.group})`;
  if (square.kind === 'transit') return 'var(--color-group-rail)';
  return 'var(--color-group-utility)';
}
