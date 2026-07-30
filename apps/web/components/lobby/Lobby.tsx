'use client';

import type { Action } from '@parkway/engine';
import type { ApiFailure, GamePayload } from '@/lib/apiClient';
import { Button } from '@/components/ui/Button';

/**
 * The waiting room.
 *
 * The start button appears because the server said `START_GAME` is legal for this
 * viewer, not because this component checked whether they are the host or counted
 * the players. Everyone else sees why they are waiting.
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
  const canStart = game.legalActions.some((action) => action.type === 'START_GAME');
  const seatsLeft = 6 - game.players.length;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-lg flex-col justify-center gap-6 p-6">
      <div className="rounded-lg border border-border bg-surface p-6 text-center">
        <p className="text-xs uppercase tracking-[0.04em] text-text-muted">Room code</p>
        <p className="mt-2 font-mono text-2xl font-semibold tracking-[0.04em] text-text tabular-nums">
          {game.roomCode}
        </p>
        <p className="mt-3 text-sm text-text-faint">
          Share this with your friends. They join from the front page.
        </p>
      </div>

      <div className="rounded-lg border border-border bg-surface p-6">
        <h2 className="text-md font-semibold">
          {game.players.length} {game.players.length === 1 ? 'player' : 'players'}
          {seatsLeft > 0 && (
            <span className="font-normal text-text-faint"> · {seatsLeft} seats free</span>
          )}
        </h2>

        <ul className="mt-4 flex flex-col gap-2">
          {game.players.map((player) => (
            <li key={player.id} className="flex items-center gap-2 text-base">
              <span
                aria-hidden="true"
                className="size-2 rounded-full"
                style={{ backgroundColor: `var(--color-player-${player.colour})` }}
              />
              <span className="text-text">{player.name}</span>
              {player.id === game.you.playerId && <span className="text-text-faint">you</span>}
              {game.players[0]?.id === player.id && (
                <span className="ml-auto text-sm text-text-faint">host</span>
              )}
            </li>
          ))}
        </ul>
      </div>

      {refusal !== null && (
        <p role="alert" className="text-sm text-danger">
          {refusal.message}
        </p>
      )}

      {canStart ? (
        <Button
          variant="primary"
          size="bar"
          pending={pending === 'START_GAME'}
          onClick={() => onAct({ type: 'START_GAME' })}
        >
          Start the game
        </Button>
      ) : (
        <p className="text-center text-base text-text-muted">
          {game.you.isHost
            ? 'Waiting for one more player.'
            : 'Waiting for the host to start the game.'}
        </p>
      )}
    </main>
  );
}
