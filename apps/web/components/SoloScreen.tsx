'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Table } from '@/components/game/Table';
import { Button } from '@/components/ui/Button';
import { useGameStore } from '@/store/useGameStore';
import { useStage } from '@/store/useStage';
import { Centred, Loading } from './GameScreen';

/**
 * A solo game against the computer, running entirely in this browser.
 *
 * The game is saved after every move, so closing the tab and coming back
 * picks up exactly where you left off.
 */
export function SoloScreen() {
  const router = useRouter();
  const { mode, pending, refusal, resumeLocal, send, disconnect } = useGameStore();
  const shown = useStage((s) => s.shown);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    // Arriving from the setup screen, the game is already running.
    if (useGameStore.getState().mode === 'local') return;
    if (!resumeLocal()) setMissing(true);
  }, [resumeLocal]);

  useEffect(() => () => disconnect(), [disconnect]);

  if (missing) {
    return (
      <Centred title="No game in progress">
        <p className="text-text-muted">
          Set up a new game against the computer from the front page.
        </p>
        <Button variant="primary" size="lg" onClick={() => router.push('/')}>
          New game
        </Button>
      </Centred>
    );
  }

  if (mode !== 'local' || shown === null || shown.publicState === null) return <Loading />;

  const bots = shown.players.filter((player) => player.isBot === true).length;

  return (
    <Table
      label={`Solo · you vs ${bots} ${bots === 1 ? 'bot' : 'bots'}`}
      pending={pending}
      refusal={refusal}
      connection="live"
      onAct={(action) => void send(action)}
      firesAuctionTimeout={false}
      onPlayAgain={() => router.push('/?new=solo')}
      onHome={() => router.push('/')}
    />
  );
}
