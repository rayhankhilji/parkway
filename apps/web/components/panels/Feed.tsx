'use client';

import { useEffect, useRef } from 'react';
import { getBoardPack, getSquare } from '@parkway/engine';
import type { PublicGameState } from '@parkway/engine';
import type { PlayerSummary } from '@/lib/apiClient';
import { describeEvents } from '@/lib/format';
import type { FeedLine } from '@/store/useGameStore';

/**
 * The game so far, in sentences.
 *
 * Events arrive structured and are turned into English here, using the names this
 * client already holds — the engine never learns a name. Each action's events are
 * grouped under one separator, because "Ada rolled 5 and 3" and "Ada paid Bo £24
 * rent" are one thing that happened, not two.
 *
 * Auto-scrolls only when already at the bottom, so reading back through the game
 * does not get yanked away every time someone rolls.
 */
export function Feed({
  lines,
  state,
  players,
  currency,
}: {
  readonly lines: readonly FeedLine[];
  readonly state: PublicGameState | null;
  readonly players: readonly PlayerSummary[];
  readonly currency: string;
}) {
  const scroller = useRef<HTMLOListElement>(null);
  const wasAtBottom = useRef(true);

  useEffect(() => {
    const element = scroller.current;
    if (element === null || !wasAtBottom.current) return;
    element.scrollTop = element.scrollHeight;
  }, [lines]);

  if (lines.length === 0) {
    return <p className="p-3 text-sm text-text-faint">The game starts here.</p>;
  }

  const pack = state === null ? null : getBoardPack(state.boardPackId);
  const context = {
    currency,
    nameOf: (id: string | null): string =>
      id === null ? 'the bank' : (players.find((player) => player.id === id)?.name ?? 'Someone'),
    squareOf: (squareId: number): string =>
      pack === null ? `square ${squareId}` : getSquare(pack, squareId).name,
  };

  return (
    <ol
      ref={scroller}
      onScroll={(event) => {
        const element = event.currentTarget;
        wasAtBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < 24;
      }}
      className="flex h-full flex-col gap-2 overflow-y-auto p-3"
      aria-live="polite"
      aria-label="Game feed"
    >
      {lines.map((line) => {
        const sentences = describeEvents(line.events, context);
        if (sentences.length === 0) return null;

        return (
          <li key={line.seq} className="border-t border-border pt-2 first:border-t-0 first:pt-0">
            {sentences.map((sentence, index) => (
              <p key={index} className="text-sm text-text-muted">
                {sentence}
              </p>
            ))}
          </li>
        );
      })}
    </ol>
  );
}
