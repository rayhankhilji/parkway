'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Table } from '@/components/game/Table';
import { TopBar } from '@/components/game/TopBar';
import { Lobby } from '@/components/lobby/Lobby';
import { Button } from '@/components/ui/Button';
import { loadSession } from '@/lib/session';
import { useGameStore } from '@/store/useGameStore';
import { useStage } from '@/store/useStage';

/**
 * An online game: lobby or table, switched on status.
 *
 * All four states are here — loading, empty, error, populated — because the
 * interesting ones are not the happy path. A player whose token is gone needs to
 * be told that plainly, and a player mid-reconnect needs to know the board may
 * be stale.
 */
export function GameScreen({ gameId }: { readonly gameId: string }) {
  const router = useRouter();
  const { game, connection, pending, refusal, loadError, loading, connect, disconnect, send } =
    useGameStore();
  const shown = useStage((s) => s.shown);
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
      <Centred title="No seat on this device">
        <p className="text-text-muted">
          A seat lives in the browser that joined. If you cleared your storage or switched browser,
          join again with the room code.
        </p>
        <Button variant="primary" size="lg" onClick={() => router.push('/')}>
          Back to the start
        </Button>
      </Centred>
    );
  }

  if (loadError !== null) {
    return (
      <Centred title="Could not load this game">
        <p className="text-text-muted">{loadError.message}</p>
        <Button
          variant="primary"
          size="lg"
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
    return <Loading />;
  }

  if (game.status === 'lobby') {
    return (
      <div className="felt min-h-dvh">
        <TopBar label="Waiting room" />
        <Lobby game={game} pending={pending} refusal={refusal} onAct={send} />
      </div>
    );
  }

  if (shown === null || shown.publicState === null) return <Loading />;

  return (
    <Table
      label={
        <span>
          Room{' '}
          <span className="font-mono font-semibold tracking-wider text-text">{game.roomCode}</span>
        </span>
      }
      pending={pending}
      refusal={refusal}
      connection={connection}
      onAct={(action) => void send(action)}
      firesAuctionTimeout
      onHome={() => router.push('/')}
    />
  );
}

export function Centred({
  title,
  children,
}: {
  readonly title: string;
  readonly children: React.ReactNode;
}) {
  return (
    <main className="felt flex min-h-dvh items-center justify-center p-6">
      <div className="glass flex max-w-sm animate-pop-in flex-col items-start gap-4 rounded-3xl p-7 shadow-dialog">
        <h1 className="font-display text-2xl font-bold">{title}</h1>
        {children}
      </div>
    </main>
  );
}

export function Loading() {
  return (
    <div className="felt flex min-h-dvh flex-col items-center justify-center gap-6">
      <div className="aspect-square w-[min(80vw,70vh)] animate-pulse rounded-[2%] bg-ivory/10 shadow-board" />
      <p className="text-sm text-text-muted" role="status">
        Setting up the table…
      </p>
    </div>
  );
}
