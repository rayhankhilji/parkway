'use client';

import type { BoardPack, PublicGameState } from '@parkway/engine';
import type { PlayerSummary } from '@/lib/apiClient';
import { cn } from '@/lib/cn';
import { useStage } from '@/store/useStage';
import { squareCentre, type BoardGrid } from './layout';

/**
 * The tokens, floating above the board.
 *
 * They live in their own layer rather than inside squares so that a move is a
 * glide from one square to the next, with a little hop on each step, rather
 * than a token blinking out of one cell and into another. Positions come from
 * the stage while a walk is playing and from state the rest of the time.
 */
export function TokenLayer({
  state,
  players,
  grid,
  pack,
}: {
  readonly state: PublicGameState;
  readonly players: readonly PlayerSummary[];
  readonly grid: BoardGrid;
  readonly pack: BoardPack;
}) {
  const tokenAt = useStage((s) => s.tokenAt);
  const hopKey = useStage((s) => s.hopKey);
  const flying = useStage((s) => s.flying);
  const busy = useStage((s) => s.busy);

  const activeId = state.turnOrder[state.activeIndex];
  const placementOf = new Map(grid.placements.map((placement) => [placement.id, placement]));

  const live = state.turnOrder.filter((id) => state.players[id]?.bankrupt === false);
  const positionOf = (id: string): number => tokenAt[id] ?? state.players[id]?.position ?? 0;

  // Tokens sharing a square fan out around its centre.
  const bySquare = new Map<number, string[]>();
  for (const id of live) {
    const at = positionOf(id);
    bySquare.set(at, [...(bySquare.get(at) ?? []), id]);
  }

  return (
    <div className="pointer-events-none absolute inset-0 z-20" aria-hidden="true">
      {live.map((id) => {
        const at = positionOf(id);
        const placement = placementOf.get(at);
        if (placement === undefined) return null;

        const centre = squareCentre(placement, grid.tracks);
        const crowd = bySquare.get(at) ?? [id];
        const index = crowd.indexOf(id);
        const jailed =
          at === pack.jail.squareId &&
          state.players[id]?.inJail === true &&
          tokenAt[id] === undefined;

        let dx = 0;
        let dy = 0;
        if (crowd.length > 1) {
          const angle = (index / crowd.length) * Math.PI * 2 - Math.PI / 2;
          const radius = placement.isCorner ? 2.6 : 1.7;
          dx = Math.cos(angle) * radius;
          dy = Math.sin(angle) * radius;
        }
        if (at === pack.jail.squareId && tokenAt[id] === undefined) {
          // Inside the cell, or out on the "just visiting" strip.
          dx += jailed ? 2.6 : -3.4;
          dy += jailed ? -2.6 : 3.4;
        }

        const player = players.find((candidate) => candidate.id === id);
        const colour = player?.colour ?? 'slate';
        const isActive = id === activeId;

        return (
          <div
            key={id}
            className={cn(
              'absolute size-[4.6%] -translate-x-1/2 -translate-y-1/2',
              flying === id
                ? 'transition-[left,top] duration-[900ms] ease-[cubic-bezier(0.5,0,0.2,1)]'
                : 'transition-[left,top] duration-[150ms] ease-out',
              isActive ? 'z-10' : 'z-0',
            )}
            style={{ left: `${centre.x + dx}%`, top: `${centre.y + dy}%` }}
          >
            <div
              key={hopKey[id] ?? 0}
              className={cn('size-full', (hopKey[id] ?? 0) > 0 && 'animate-hop')}
            >
              <Token
                colour={colour}
                initial={player?.name ?? '?'}
                active={isActive && !busy}
                jailed={jailed}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * A glossy, weighted game piece seen from above: a lit dome, a darker rim, a
 * shadow on the board beneath it.
 */
export function Token({
  colour,
  initial,
  active = false,
  jailed = false,
  className,
  labelClassName = 'text-[2.3cqw]',
}: {
  readonly colour: string;
  readonly initial: string;
  readonly labelClassName?: string;
  readonly active?: boolean;
  readonly jailed?: boolean;
  readonly className?: string;
}) {
  const fill = `var(--color-player-${colour})`;
  return (
    <span
      className={cn(
        'relative flex size-full items-center justify-center rounded-full',
        active && 'animate-pulse-ring',
        className,
      )}
      style={{
        background: `radial-gradient(circle at 34% 28%, color-mix(in oklab, ${fill} 35%, white) 0%, ${fill} 42%, color-mix(in oklab, ${fill} 55%, black) 100%)`,
        boxShadow: `0 0 0 1.5px color-mix(in oklab, ${fill} 50%, black), 0 3px 6px rgb(0 0 0 / 0.45), inset 0 -2px 3px rgb(0 0 0 / 0.25)`,
      }}
    >
      <span
        className={cn(
          'select-none font-display font-black italic leading-none text-black/55',
          labelClassName,
        )}
      >
        {initial.slice(0, 1).toUpperCase()}
      </span>
      {jailed && (
        <span className="absolute inset-0 rounded-full bg-[repeating-linear-gradient(90deg,rgb(0_0_0/0.55)_0_12%,transparent_12%_30%)]" />
      )}
    </span>
  );
}
