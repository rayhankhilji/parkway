'use client';

import type { PublicGameState } from '@parkway/engine';
import type { PlayerSummary } from '@/lib/apiClient';
import { formatMoney } from '@/lib/format';
import { Dice } from './Dice';
import { ChestIcon, QuestionIcon } from './icons';

/**
 * The middle of the board: the wordmark, the two decks, the dice, and — on
 * screens wide enough — the controls for whatever is happening now.
 *
 * The status line is a translation of `state.phase`, not a conclusion drawn
 * from several fields: the phase is a tagged union precisely so that nobody
 * has to infer what is going on from a combination of booleans.
 */
export function CentrePanel({
  state,
  players,
  currency,
  youId,
  edgeCount,
  children,
}: {
  readonly state: PublicGameState;
  readonly players: readonly PlayerSummary[];
  readonly currency: string;
  readonly youId: string;
  readonly edgeCount: number;
  readonly children?: React.ReactNode;
}) {
  const activeId = state.turnOrder[state.activeIndex];
  const active = players.find((player) => player.id === activeId);

  return (
    <div
      style={{ gridColumn: `2 / ${edgeCount + 2}`, gridRow: `2 / ${edgeCount + 2}` }}
      className="relative overflow-hidden bg-ivory-deep"
    >
      {/* Printed decoration: a soft inner frame and the wordmark on the diagonal. */}
      <div className="paper pointer-events-none absolute inset-0 opacity-70" aria-hidden="true" />
      <div
        className="pointer-events-none absolute inset-[3%] rounded-[1cqw] border border-ink/15"
        aria-hidden="true"
      />
      <div
        className="pointer-events-none absolute inset-0 flex items-center justify-center"
        aria-hidden="true"
      >
        <span className="-rotate-[38deg] select-none font-display text-[12cqw] font-black italic leading-none tracking-[-0.03em] text-[#b3261e]/[0.14]">
          Parkway
        </span>
      </div>

      <Deck
        className="left-[5%] top-[7%] rotate-[-38deg]"
        kind="chance"
        count={state.decks.chance}
      />
      <Deck
        className="bottom-[7%] right-[5%] rotate-[142deg]"
        kind="chest"
        count={state.decks.chest}
      />

      <div className="absolute inset-0 flex flex-col items-center justify-center gap-[2cqw] p-[4%]">
        <div className="flex flex-col items-center gap-[1cqw]">
          <Dice />
          {active !== undefined && (
            <p className="mt-[1.2cqw] flex items-center gap-[0.8cqw] rounded-full bg-ink/85 px-[1.6cqw] py-[0.5cqw] text-[1.45cqw] font-semibold text-ivory shadow-sm @max-[620px]/board:text-[2.6cqw]">
              <span
                className="size-[1.2cqw] rounded-full @max-[620px]/board:size-[2cqw]"
                style={{ background: `var(--color-player-${active.colour})` }}
              />
              {describePhase(state, players, youId)}
            </p>
          )}
        </div>

        {children}

        <dl className="flex gap-[2.4cqw] text-[1.05cqw] font-semibold uppercase tracking-wider text-ink-muted @max-[620px]/board:hidden">
          <div className="flex gap-[0.6cqw]">
            <dt>Houses</dt>
            <dd className="tabular-nums text-ink">{state.bank.houses}</dd>
          </div>
          <div className="flex gap-[0.6cqw]">
            <dt>Hotels</dt>
            <dd className="tabular-nums text-ink">{state.bank.hotels}</dd>
          </div>
          {state.config.freeParkingPot && (
            <div className="flex gap-[0.6cqw]">
              <dt>Pot</dt>
              <dd className="tabular-nums text-gold-deep">{formatMoney(state.pot, currency)}</dd>
            </div>
          )}
        </dl>
      </div>
    </div>
  );
}

function Deck({
  className,
  kind,
  count,
}: {
  readonly className: string;
  readonly kind: 'chance' | 'chest';
  readonly count: number;
}) {
  const chance = kind === 'chance';
  return (
    <div
      className={`pointer-events-none absolute flex h-[13%] w-[21%] items-center justify-center ${className}`}
      aria-hidden="true"
    >
      {[2, 1, 0].map((layer) => (
        <span
          key={layer}
          className="absolute inset-0 rounded-[0.8cqw] border border-ink/25"
          style={{
            transform: `translate(${layer * 0.25}cqw, ${layer * -0.25}cqw)`,
            background: chance
              ? 'linear-gradient(135deg, #f4c867, #e09a2c)'
              : 'linear-gradient(135deg, #8fb7f0, #3f6fd0)',
            opacity: count > layer ? 1 : 0.35,
          }}
        />
      ))}
      <span className="relative flex items-center gap-[0.6cqw] font-display text-[1.6cqw] font-bold italic text-ink/80">
        {chance ? (
          <QuestionIcon className="size-[2.2cqw]" />
        ) : (
          <ChestIcon className="size-[2.2cqw]" />
        )}
        <span className="@max-[620px]/board:hidden">{chance ? 'Fortune' : 'Civic Fund'}</span>
      </span>
    </div>
  );
}

function describePhase(
  state: PublicGameState,
  players: readonly PlayerSummary[],
  youId: string,
): string {
  const nameOf = (id: string): string =>
    id === youId ? 'You' : (players.find((player) => player.id === id)?.name ?? 'Someone');
  const activeId = state.turnOrder[state.activeIndex] ?? '';
  const who = nameOf(activeId);
  const yours = activeId === youId;

  switch (state.phase.kind) {
    case 'awaiting_roll':
      return yours ? 'Your roll' : `${who} to roll`;
    case 'awaiting_jail_decision':
      return yours ? 'You are in the Gaol' : `${who} is in the Gaol`;
    case 'awaiting_purchase':
      return yours ? 'Buy it or pass?' : `${who} is deciding`;
    case 'auction':
      return 'Auction';
    case 'awaiting_end_turn':
      return yours ? 'Your move' : `${who} is thinking`;
    case 'awaiting_debt':
      return `${nameOf(state.phase.debtorId)} ${state.phase.debtorId === youId ? 'owe' : 'owes'} money`;
    case 'game_over':
      return `${nameOf(state.phase.winnerId)} ${state.phase.winnerId === youId ? 'win' : 'wins'}!`;
  }
}
