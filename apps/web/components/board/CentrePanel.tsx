'use client';

import { getBoardPack } from '@parkway/engine';
import type { PublicGameState } from '@parkway/engine';
import type { PlayerSummary } from '@/lib/apiClient';
import { formatMoney, formatRoll } from '@/lib/format';

/**
 * The middle of the board: whose turn it is, the last roll, and the bank.
 *
 * Everything shown is read straight from state. The phase line in particular is
 * a translation of `state.phase`, not a conclusion drawn from several fields —
 * the phase is a tagged union precisely so that nobody has to infer what is going
 * on from a combination of booleans.
 */
export function CentrePanel({
  state,
  players,
  currency,
  tracks,
}: {
  readonly state: PublicGameState;
  readonly players: readonly PlayerSummary[];
  readonly currency: string;
  readonly tracks: string;
}) {
  const pack = getBoardPack(state.boardPackId);
  const edgeCount = (pack.squares.length - 4) / 4;
  const activeId = state.turnOrder[state.activeIndex];
  const active = players.find((player) => player.id === activeId);

  return (
    <div
      // Sits inside the ring: from the second track to the second from last.
      style={{ gridColumn: `2 / ${edgeCount + 2}`, gridRow: `2 / ${edgeCount + 2}` }}
      className="flex flex-col items-center justify-center gap-4 p-6 text-center"
      data-tracks={tracks}
    >
      <p className="text-xs uppercase tracking-[0.04em] text-text-faint">Ashvale</p>

      {active !== undefined && (
        <p
          className="text-xl font-semibold"
          style={{ color: `var(--color-player-${active.colour})` }}
        >
          {active.name}
        </p>
      )}

      <p className="text-sm text-text-muted">{describePhase(state, players)}</p>

      {state.turn.lastRoll !== null && (
        <p className="font-mono text-md text-text tabular-nums">
          {formatRoll(state.turn.lastRoll)}
        </p>
      )}

      <dl className="flex gap-6 text-xs text-text-faint">
        <div>
          <dt className="uppercase tracking-[0.04em]">Houses</dt>
          <dd className="font-mono text-sm text-text-muted tabular-nums">{state.bank.houses}</dd>
        </div>
        <div>
          <dt className="uppercase tracking-[0.04em]">Hotels</dt>
          <dd className="font-mono text-sm text-text-muted tabular-nums">{state.bank.hotels}</dd>
        </div>
        {state.config.freeParkingPot && (
          <div>
            <dt className="uppercase tracking-[0.04em]">Pot</dt>
            <dd className="font-mono text-sm text-money tabular-nums">
              {formatMoney(state.pot, currency)}
            </dd>
          </div>
        )}
      </dl>
    </div>
  );
}

function describePhase(state: PublicGameState, players: readonly PlayerSummary[]): string {
  const nameOf = (id: string): string =>
    players.find((player) => player.id === id)?.name ?? 'Someone';

  switch (state.phase.kind) {
    case 'awaiting_roll':
      return 'to roll';
    case 'awaiting_jail_decision':
      return 'is in the gaol';
    case 'awaiting_purchase':
      return 'is deciding whether to buy';
    case 'auction':
      return 'Auction in progress';
    case 'awaiting_end_turn':
      return 'to end their turn';
    case 'awaiting_debt':
      return `${nameOf(state.phase.debtorId)} owes money`;
    case 'game_over':
      return `${nameOf(state.phase.winnerId)} wins`;
  }
}
