'use client';

import { useState } from 'react';
import type { Action } from '@parkway/engine';
import { Token } from '@/components/board/TokenLayer';
import { Button } from '@/components/ui/Button';
import type { ApiFailure, GamePayload } from '@/lib/apiClient';

/**
 * The waiting room.
 *
 * The start button appears because the server said `START_GAME` is legal for
 * this viewer, not because this component checked whether they are the host or
 * counted the players. Everyone else sees why they are waiting.
 */
export function Lobby({
  game,
  pending,
  refusal,
  onAct,
}: {
  readonly game: GamePayload;
  readonly pending: Action['type'] | null;
  readonly refusal: ApiFailure | null;
  readonly onAct: (action: Action) => void;
}) {
  const [copied, setCopied] = useState(false);
  const canStart = game.legalActions.some((action) => action.type === 'START_GAME');
  const seats = 6;

  const share = async () => {
    const url = `${window.location.origin}/?join=${game.roomCode}`;
    try {
      if (navigator.share !== undefined) {
        await navigator.share({
          title: 'Play Parkway with me',
          text: `Room code ${game.roomCode}`,
          url,
        });
        return;
      }
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Dismissed share sheet — nothing to do.
    }
  };

  return (
    <main className="mx-auto flex w-full max-w-lg flex-col gap-5 px-4 pb-10 pt-6">
      <section className="glass animate-fade-up rounded-3xl p-7 text-center shadow-dialog">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-text-faint">
          Room code
        </p>
        <p className="mt-3 flex justify-center gap-1.5 font-mono text-4xl font-semibold">
          {game.roomCode.split('').map((char, index) => (
            <span
              key={index}
              className="paper flex h-14 w-11 items-center justify-center rounded-xl text-ink shadow-card"
            >
              {char}
            </span>
          ))}
        </p>
        <Button variant="secondary" className="mt-5" onClick={() => void share()}>
          {copied ? 'Link copied!' : 'Share invite link'}
        </Button>
      </section>

      <section className="glass animate-fade-up rounded-3xl p-6 [animation-delay:80ms]">
        <h2 className="flex items-baseline justify-between font-display text-xl font-bold">
          At the table
          <span className="font-sans text-sm font-normal text-text-faint">
            {game.players.length} of {seats}
          </span>
        </h2>
        <ul className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {Array.from({ length: seats }, (_, index) => {
            const player = game.players[index];
            return player === undefined ? (
              <li
                key={index}
                className="flex h-24 flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 text-xs text-text-faint"
              >
                Open seat
              </li>
            ) : (
              <li
                key={player.id}
                className="flex h-24 animate-pop-in flex-col items-center justify-center gap-2 rounded-2xl bg-black/30 ring-1 ring-inset ring-white/5"
              >
                <span className="size-10">
                  <Token colour={player.colour} initial={player.name} labelClassName="text-lg" />
                </span>
                <span className="max-w-full truncate px-2 text-sm font-semibold">
                  {player.name}
                  {player.id === game.you.playerId && (
                    <span className="text-text-faint"> (you)</span>
                  )}
                </span>
                {index === 0 && (
                  <span className="-mt-1.5 text-[10px] font-bold uppercase tracking-wider text-gold">
                    Host
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      {refusal !== null && (
        <p role="alert" className="rounded-xl bg-bad/10 px-4 py-2 text-sm text-[#ffc2ba]">
          {refusal.message}
        </p>
      )}

      {canStart ? (
        <Button
          variant="primary"
          size="xl"
          pending={pending === 'START_GAME'}
          onClick={() => onAct({ type: 'START_GAME' })}
        >
          Start the game
        </Button>
      ) : (
        <p className="flex items-center justify-center gap-2 text-center text-text-muted">
          <span className="size-2 animate-pulse rounded-full bg-gold" />
          {game.you.isHost
            ? 'Waiting for at least one more player…'
            : 'Waiting for the host to start…'}
        </p>
      )}
    </main>
  );
}
