'use client';

import { getBoardPack, getSquare } from '@parkway/engine';
import type { PublicGameState } from '@parkway/engine';
import type { PlayerSummary } from '@/lib/apiClient';
import { cn } from '@/lib/cn';
import { useStage } from '@/store/useStage';
import { boardGrid } from './layout';
import { Square } from './Square';
import { CentrePanel } from './CentrePanel';
import { TokenLayer } from './TokenLayer';
import { ChestIcon, QuestionIcon } from './icons';

/**
 * The board: a printed ivory board in a dark wooden frame, sitting on felt.
 *
 * Positions come from the stage and nothing else — there is no local model of
 * where anyone is. The squares are read from the same board pack the engine
 * read, so what is on screen and what the rules operate on cannot disagree.
 *
 * The board is a size container, and everything printed on it is sized in
 * container units, so it scales as one object from a phone to a desktop.
 */
export function Board({
  state,
  players,
  currency,
  youId,
  highlight,
  onSelectSquare,
  centre,
  className,
}: {
  readonly state: PublicGameState;
  readonly players: readonly PlayerSummary[];
  readonly currency: string;
  readonly youId: string;
  /** When set, every other square is dimmed. */
  readonly highlight?: ReadonlySet<number> | null;
  readonly onSelectSquare: (squareId: number) => void;
  readonly centre?: React.ReactNode;
  readonly className?: string;
}) {
  const pack = getBoardPack(state.boardPackId);
  const grid = boardGrid(pack);
  const landed = useStage((s) => s.landed);
  const stamps = useStage((s) => s.stamps);

  const colourOf = (playerId: string): string =>
    players.find((player) => player.id === playerId)?.colour ?? 'slate';

  return (
    <div
      className={cn(
        'relative aspect-square w-full rounded-[1.6%] p-[1.3%]',
        'bg-[linear-gradient(145deg,#4a3320,#2a1c10_45%,#3a2716)] shadow-board',
        className,
      )}
    >
      <div className="@container/board relative size-full overflow-hidden rounded-[0.6%] bg-ink/70 ring-1 ring-black/40">
        <div
          className="grid size-full gap-[1px] bg-paper-line"
          style={{ gridTemplateColumns: grid.template, gridTemplateRows: grid.template }}
        >
          {grid.placements.map((placement) => {
            const square = getSquare(pack, placement.id);
            const deed = state.deeds[placement.id];
            const owner = deed?.ownerId ?? null;

            return (
              <Square
                key={placement.id}
                square={square}
                placement={placement}
                deed={deed}
                currency={currency}
                ownerColour={owner === null ? null : colourOf(owner)}
                landed={landed === placement.id}
                stampKey={stamps[placement.id]}
                dimmed={highlight != null && !highlight.has(placement.id)}
                onSelect={onSelectSquare}
              />
            );
          })}

          <CentrePanel
            state={state}
            players={players}
            currency={currency}
            youId={youId}
            edgeCount={grid.tracks - 2}
          >
            {centre}
          </CentrePanel>
        </div>

        <TokenLayer state={state} players={players} grid={grid} pack={pack} />
        <Banners />
        <CardReveal />
      </div>
    </div>
  );
}

/** Headlines for what just happened, stacked at the top of the centre. */
function Banners() {
  const banners = useStage((s) => s.banners);

  return (
    <div
      className="pointer-events-none absolute inset-x-[18%] top-[17%] z-30 flex flex-col items-center gap-[0.8cqw]"
      role="status"
      aria-live="polite"
    >
      {banners.map((banner) => (
        <div
          key={banner.id}
          className={cn(
            'flex max-w-full animate-banner items-center gap-[1.2cqw] rounded-[1.2cqw] px-[2cqw] py-[1cqw] shadow-popover',
            'border text-center',
            banner.tone === 'good' && 'border-good/40 bg-[#10291b]/92 text-[#c9f5d9]',
            banner.tone === 'bad' && 'border-bad/40 bg-[#2e1210]/92 text-[#ffd3cd]',
            banner.tone === 'gold' && 'border-gold/50 bg-[#2a2010]/94 text-gold-bright',
            banner.tone === 'info' && 'border-white/15 bg-[#17140f]/92 text-text',
          )}
        >
          {banner.colour !== undefined && (
            <span
              className="size-[1.6cqw] shrink-0 rounded-full ring-2 ring-black/30 @max-[620px]/board:size-[3cqw]"
              style={{ background: `var(--color-player-${banner.colour})` }}
            />
          )}
          <span className="min-w-0">
            <span className="block truncate font-display text-[2.1cqw] font-bold leading-tight @max-[620px]/board:text-[4cqw]">
              {banner.title}
            </span>
            {banner.detail !== undefined && (
              <span className="block truncate text-[1.3cqw] opacity-80 @max-[620px]/board:text-[2.8cqw]">
                {banner.detail}
              </span>
            )}
          </span>
        </div>
      ))}
    </div>
  );
}

/** A drawn card, turned over in the middle of the board. Tap to carry on. */
function CardReveal() {
  const card = useStage((s) => s.card);
  const skip = useStage((s) => s.skip);
  if (card === null) return null;

  const chance = card.deck === 'chance';

  return (
    <button
      type="button"
      onClick={skip}
      className="absolute inset-0 z-40 flex items-center justify-center bg-black/25 backdrop-blur-[1px]"
      aria-label="Continue"
    >
      <div
        key={card.id}
        className="flex aspect-[5/3.2] w-[46%] animate-card-flip flex-col overflow-hidden rounded-[1.6cqw] shadow-dialog @max-[620px]/board:w-[64%]"
        style={{
          background: chance
            ? 'linear-gradient(160deg, #fff6df, #f6e2b0)'
            : 'linear-gradient(160deg, #f1f6ff, #d5e3fb)',
        }}
      >
        <div
          className="flex items-center justify-center gap-[1cqw] py-[1.2cqw] text-ivory"
          style={{
            background: chance
              ? 'linear-gradient(90deg, #c77a14, #e8a83a)'
              : 'linear-gradient(90deg, #2b55b8, #4f7fe0)',
          }}
        >
          {chance ? (
            <QuestionIcon className="size-[2.6cqw]" />
          ) : (
            <ChestIcon className="size-[2.6cqw]" />
          )}
          <span className="font-display text-[2.4cqw] font-black italic @max-[620px]/board:text-[4cqw]">
            {chance ? 'Fortune' : 'Civic Fund'}
          </span>
        </div>
        <div className="flex flex-1 flex-col items-center justify-center gap-[1.2cqw] px-[3cqw] text-center text-ink">
          <p className="font-display text-[2.2cqw] font-semibold leading-snug text-balance @max-[620px]/board:text-[3.6cqw]">
            {card.text}
          </p>
          <p className="flex items-center gap-[0.8cqw] text-[1.25cqw] font-semibold uppercase tracking-wider text-ink-muted @max-[620px]/board:text-[2.4cqw]">
            <span
              className="size-[1.2cqw] rounded-full"
              style={{ background: `var(--color-player-${card.colour})` }}
            />
            {card.playerName === 'You' ? 'You drew this' : `Drawn by ${card.playerName}`}
          </p>
        </div>
      </div>
    </button>
  );
}
