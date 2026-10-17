'use client';

import { useEffect, useRef } from 'react';
import { getBoardPack, type PublicGameState } from '@parkway/engine';
import { BarsIcon, KeyIcon } from '@/components/board/icons';
import { Token } from '@/components/board/TokenLayer';
import type { PlayerSummary } from '@/lib/apiClient';
import { cn } from '@/lib/cn';
import { formatMoney } from '@/lib/format';
import { useStage } from '@/store/useStage';
import { Money } from './Money';

/**
 * Who is playing, what they hold, and whose turn it is.
 *
 * Money changes float off the card as it happens — the clearest way to see
 * who just paid whom. Bankrupt players stay in the list, greyed, because
 * turn order does not change when someone goes out (→ PRD F14).
 */
export function PlayerList({
  state,
  players,
  youId,
  variant,
}: {
  readonly state: PublicGameState;
  readonly players: readonly PlayerSummary[];
  readonly youId: string;
  readonly variant: 'rail' | 'strip';
}) {
  const pack = getBoardPack(state.boardPackId);
  const floaters = useStage((s) => s.floaters);
  const list = useRef<HTMLUListElement>(null);
  const activeKey = state.turnOrder[state.activeIndex];

  // On a phone the strip scrolls sideways; keep whoever is playing in view.
  useEffect(() => {
    const element = list.current;
    if (variant !== 'strip' || element === null || activeKey === undefined) return;
    const card = element.querySelector<HTMLElement>(`[data-player="${activeKey}"]`);
    if (card === null) return;
    element.scrollTo({
      left: card.offsetLeft - element.clientWidth / 2 + card.clientWidth / 2,
      behavior: 'smooth',
    });
  }, [variant, activeKey]);
  const activeId = state.turnOrder[state.activeIndex];

  const ordered = [...players].sort((a, b) => {
    const aOut = state.players[a.id]?.bankrupt === true ? 1 : 0;
    const bOut = state.players[b.id]?.bankrupt === true ? 1 : 0;
    if (aOut !== bOut) return aOut - bOut;
    return state.turnOrder.indexOf(a.id) - state.turnOrder.indexOf(b.id);
  });

  return (
    <ul
      ref={list}
      className={cn(
        variant === 'rail'
          ? 'flex flex-col gap-2'
          : 'scrollbar-thin -mx-4 flex snap-x gap-2 overflow-x-auto px-4 pb-1',
      )}
    >
      {ordered.map((player) => {
        const engine = state.players[player.id];
        const isOut = engine?.bankrupt === true;
        const isActive = activeId === player.id && state.phase.kind !== 'game_over';
        const holdings = pack.squares.filter(
          (square) => state.deeds[square.id]?.ownerId === player.id,
        );
        const mine = floaters.filter((floater) => floater.playerId === player.id);

        return (
          <li
            key={player.id}
            data-player={player.id}
            className={cn(
              'relative shrink-0 snap-start rounded-2xl transition-all duration-300',
              variant === 'rail' ? 'p-3' : 'w-[148px] p-2',
              isActive
                ? 'bg-[linear-gradient(135deg,rgb(230_188_95/0.16),rgb(230_188_95/0.04))] shadow-gold'
                : 'bg-black/30 ring-1 ring-inset ring-white/5',
              isOut && 'opacity-40 grayscale',
            )}
          >
            <div className="flex items-center gap-2.5">
              <span className={cn('shrink-0', variant === 'rail' ? 'size-9' : 'size-7')}>
                <Token
                  colour={player.colour}
                  initial={player.name}
                  labelClassName={variant === 'rail' ? 'text-base' : 'text-sm'}
                />
              </span>
              {variant === 'strip' ? (
                <div className="min-w-0 flex-1">
                  <p
                    className={cn(
                      'truncate text-[13px] font-semibold leading-tight',
                      isOut && 'line-through',
                    )}
                  >
                    {player.id === youId ? 'You' : player.name}
                    {engine?.inJail === true && (
                      <BarsIcon className="ml-1 inline size-3 text-warn" />
                    )}
                  </p>
                  {engine !== undefined && (
                    <Money
                      amount={engine.cash}
                      currency={pack.currencySymbol}
                      className="font-display text-[15px] font-bold leading-tight text-gold-bright"
                    />
                  )}
                </div>
              ) : (
                <div className="min-w-0 flex-1">
                  <p
                    className={cn(
                      'flex items-center gap-1.5 truncate font-semibold',
                      variant === 'rail' ? 'text-[15px]' : 'text-sm',
                      isOut && 'line-through',
                    )}
                  >
                    <span className="truncate">
                      {player.id === youId ? `${player.name} (you)` : player.name}
                    </span>
                    {player.isBot === true && (
                      <span className="rounded bg-white/10 px-1 py-px text-[9px] font-bold uppercase tracking-wider text-text-faint">
                        bot
                      </span>
                    )}
                  </p>
                  <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-text-faint">
                    {isOut ? (
                      'Bankrupt'
                    ) : isActive ? (
                      <span className="text-gold">Playing now</span>
                    ) : engine?.inJail === true ? (
                      <span className="flex items-center gap-1 text-warn">
                        <BarsIcon className="size-3" /> In the Gaol
                      </span>
                    ) : !player.isConnected ? (
                      <span className="text-warn">Disconnected</span>
                    ) : (
                      `${holdings.length} ${holdings.length === 1 ? 'property' : 'properties'}`
                    )}
                    {(engine?.heldJailCards.length ?? 0) > 0 && (
                      <KeyIcon className="size-3 text-gold" aria-label="Holds a release card" />
                    )}
                  </p>
                </div>
              )}
              {variant === 'rail' && engine !== undefined && (
                <Money
                  amount={engine.cash}
                  currency={pack.currencySymbol}
                  className={cn(
                    'font-display font-bold text-gold-bright',
                    variant === 'rail' ? 'text-lg' : 'text-base',
                  )}
                />
              )}
            </div>

            {variant === 'rail' && holdings.length > 0 && (
              <div className="mt-2.5 flex flex-wrap gap-[3px]">
                {holdings.map((square) => {
                  const deed = state.deeds[square.id];
                  return (
                    <span
                      key={square.id}
                      title={square.name}
                      className={cn(
                        'h-3 w-2.5 rounded-[2px] ring-1 ring-black/40',
                        deed?.mortgaged === true && 'opacity-30',
                      )}
                      style={{
                        background:
                          square.kind === 'property'
                            ? `var(--color-${square.group})`
                            : square.kind === 'transit'
                              ? '#5d5246'
                              : 'var(--color-group-utility)',
                      }}
                    />
                  );
                })}
              </div>
            )}

            {/* Money changes float off the card. */}
            <div className="pointer-events-none absolute right-3 top-0 flex flex-col items-end">
              {mine.map((floater) => (
                <span
                  key={floater.id}
                  className={cn(
                    'animate-float-up rounded-full px-2 py-0.5 font-display text-sm font-bold tabular-nums shadow-popover',
                    floater.amount > 0 ? 'bg-good text-[#0c2615]' : 'bg-bad text-white',
                  )}
                >
                  {floater.amount > 0 ? '+' : '−'}
                  {formatMoney(Math.abs(floater.amount), pack.currencySymbol)}
                </span>
              ))}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
