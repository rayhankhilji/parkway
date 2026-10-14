'use client';

import { useMemo } from 'react';
import {
  createGame,
  defaultBoardPackId,
  toPublicState,
  type PublicGameState,
} from '@parkway/engine';
import { Board } from '@/components/board/Board';
import type { PlayerSummary } from '@/lib/apiClient';

/**
 * A game in progress, for the front page: the real board component, fed a
 * hand-arranged position, tilted on the table.
 */

const players: readonly PlayerSummary[] = [
  { id: 'a', name: 'Ada', seat: 0, colour: 'rose', isConnected: true },
  { id: 'b', name: 'Bo', seat: 1, colour: 'sky', isConnected: true },
  { id: 'c', name: 'Cy', seat: 2, colour: 'emerald', isConnected: true },
  { id: 'd', name: 'Di', seat: 3, colour: 'amber', isConnected: true },
];

function demoState(): PublicGameState | null {
  const created = createGame({
    playerIds: players.map((player) => player.id),
    config: {
      startingCash: 1500,
      salary: 200,
      freeParkingPot: false,
      incomeTaxMode: 'flat',
      auctionOnDecline: true,
      auctionSeconds: 30,
    },
    boardPackId: defaultBoardPackId,
    seed: 11,
  });
  if (!created.ok) return null;
  const base = toPublicState(created.value);

  const owned: Record<number, [string, number, number]> = {
    1: ['a', 2, 0],
    3: ['a', 2, 0],
    6: ['b', 0, 0],
    11: ['c', 3, 0],
    13: ['c', 3, 0],
    14: ['c', 3, 0],
    16: ['d', 0, 0],
    5: ['b', 0, 0],
    25: ['b', 0, 0],
    21: ['a', 0, 0],
    26: ['d', 0, 0],
    31: ['b', 0, 0],
    37: ['a', 0, 1],
    39: ['a', 0, 1],
    28: ['c', 0, 0],
  };

  const deeds = { ...base.deeds };
  for (const [id, [ownerId, houses, hotels]] of Object.entries(owned)) {
    const key = Number(id);
    const deed = deeds[key];
    if (deed !== undefined) deeds[key] = { ...deed, ownerId, houses, hotels };
  }

  const positions: Record<string, number> = { a: 24, b: 8, c: 19, d: 34 };
  const statePlayers = Object.fromEntries(
    Object.entries(base.players).map(([id, player]) => [
      id,
      { ...player, position: positions[id] ?? 0 },
    ]),
  );

  return { ...base, deeds, players: statePlayers, turn: { ...base.turn, lastRoll: [5, 3] } };
}

export function DemoBoard() {
  const state = useMemo(demoState, []);
  if (state === null) return null;

  return (
    <div className="pointer-events-none select-none" aria-hidden="true" inert>
      <Board
        state={state}
        players={players}
        currency="£"
        youId="a"
        onSelectSquare={() => undefined}
      />
    </div>
  );
}
