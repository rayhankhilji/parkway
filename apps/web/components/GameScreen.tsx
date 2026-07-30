'use client';

import { useEffect, useState } from 'react';
import { getBoardPack } from '@parkway/engine';
import { Board } from '@/components/board/Board';
import { Lobby } from '@/components/lobby/Lobby';
import { ActionBar } from '@/components/panels/ActionBar';
import { ConnectionStrip } from '@/components/panels/ConnectionStrip';
import { Feed } from '@/components/panels/Feed';
import { PlayerList } from '@/components/panels/PlayerList';
import { SmallScreenNotice } from '@/components/SmallScreenNotice';
import { Button } from '@/components/ui/Button';
import { loadSession } from '@/lib/session';
import { useGameStore } from '@/store/useGameStore';

/**
 * The game screen: lobby or board, switched on status.
 *
 * All four required states are here — loading, empty, error, populated — because
 * the interesting ones are not the happy path. A player whose token is gone needs
 * to be told that plainly, and a player mid-reconnect needs to know the board may
 * be stale.
 */
export function GameScreen({ gameId }: { readonly gameId: string }) {
  const {
    game,
    connection,
    feed,
    pending,
    refusal,
    loadError,
    loading,
    connect,
    disconnect,
    send,
  } = useGameStore();
  const [noSession, setNoSession] = useState(false);

  useEffect(() => {
    const session = loadSession(gameId);
    if (session === null) {
      setNoSession(true);
      return;
    }
    void connect(gameId, session.token);
    return () => disconnect();
  }, [gameId, connect, disconnect]);

  if (noSession) {
    return (
      <Centred title="You have no seat in this game on this device">
        <p className="text-base text-text-muted">
          A seat lives in the browser that joined. If you cleared your storage, or this is a
          different browser, you will need the room code to join again.
        </p>
        <Button variant="primary" onClick={() => window.location.assign('/')}>
          Back to the start
        </Button>
      </Centred>
    );
  }

  if (loadError !== null) {
    return (
      <Centred title="Could not load this game">
        <p className="text-base text-text-muted">{loadError.message}</p>
        <Button
          variant="primary"
          onClick={() => {
            const session = loadSession(gameId);
            if (session !== null) void connect(gameId, session.token);
          }}
        >
          Try again
        </Button>
      </Centred>
    );
  }

  if (loading || game === null) {
    return <Skeleton />;
  }

  if (game.status === 'lobby') {
    return (
      <>
        <SmallScreenNotice />
        <div className="hidden md:block">
          <ConnectionStrip status={connection} />
          <Lobby game={game} pending={pending} refusal={refusal} onAct={send} />
        </div>
      </>
    );
  }

  const state = game.publicState;
  if (state === null) {
    return <Skeleton />;
  }

  const currency = getBoardPack(state.boardPackId).currencySymbol;
  const activePlayerId = state.turnOrder[state.activeIndex] ?? null;

  return (
    <>
      <SmallScreenNotice />

      <div className="hidden min-h-screen flex-col md:flex">
        <ConnectionStrip status={connection} />

        <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[280px_1fr] xl:grid-cols-[280px_1fr_320px]">
          <aside className="min-h-0 overflow-y-auto border-r border-border p-4">
            <h2 className="mb-3 text-xs uppercase tracking-[0.04em] text-text-faint">
              Players · room {game.roomCode}
            </h2>
            <PlayerList
              state={state}
              players={game.players}
              currency={currency}
              youId={game.you.playerId}
            />
          </aside>

          <div className="flex min-h-0 flex-col">
            <div className="flex min-h-0 flex-1 items-center justify-center p-4">
              <Board state={state} players={game.players} currency={currency} />
            </div>
            <ActionBar
              legalActions={game.legalActions}
              players={game.players}
              activePlayerId={activePlayerId}
              currency={currency}
              pending={pending}
              refusal={refusal}
              onAct={send}
            />
          </div>

          <aside className="hidden min-h-0 border-l border-border xl:block">
            <h2 className="border-b border-border p-3 text-xs uppercase tracking-[0.04em] text-text-faint">
              Feed
            </h2>
            <div className="h-[calc(100%-41px)]">
              <Feed lines={feed} state={state} players={game.players} currency={currency} />
            </div>
          </aside>
        </div>
      </div>
    </>
  );
}

function Centred({
  title,
  children,
}: {
  readonly title: string;
  readonly children: React.ReactNode;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="flex max-w-sm flex-col items-start gap-4 rounded-lg border border-border bg-surface p-6">
        <h1 className="text-lg font-semibold">{title}</h1>
        {children}
      </div>
    </main>
  );
}

/** Skeleton blocks rather than a full-page spinner (→ DESIGN, loading state). */
function Skeleton() {
  return (
    <div className="grid min-h-screen grid-cols-1 gap-4 p-4 xl:grid-cols-[280px_1fr_320px]">
      <div className="hidden flex-col gap-2 xl:flex" aria-hidden="true">
        {Array.from({ length: 4 }, (_, index) => (
          <div key={index} className="h-16 rounded-md bg-surface-raised" />
        ))}
      </div>
      <div className="flex items-center justify-center">
        <div
          className="aspect-square w-full max-w-[820px] rounded-lg bg-surface-raised"
          aria-hidden="true"
        />
      </div>
      <div className="hidden rounded-md bg-surface-raised xl:block" aria-hidden="true" />
      <p className="sr-only" role="status">
        Loading the game
      </p>
    </div>
  );
}
