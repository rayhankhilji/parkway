'use client';

import { useEffect, useState } from 'react';
import { getBoardPack, type Action, type SquareId } from '@parkway/engine';
import { Board } from '@/components/board/Board';
import { ListIcon, StackIcon } from '@/components/board/icons';
import { Dialog } from '@/components/ui/Dialog';
import type { ApiFailure } from '@/lib/apiClient';
import type { ConnectionStatus } from '@/lib/realtime';
import { useStage } from '@/store/useStage';
import { ActionPanel } from './ActionPanel';
import { DeedCard } from './DeedCard';
import { Feed } from './Feed';
import { GameOver } from './GameOver';
import { PlayerList } from './PlayerList';
import { Portfolio } from './Portfolio';
import { TopBar } from './TopBar';
import { TradeComposer, TradeReview } from './Trade';

/**
 * The table: everything on screen during a game.
 *
 * It renders what the stage is showing, which lags the truth by however long
 * the animation takes, so the controls always match the board you can see.
 * Online and solo games both arrive here as the same payload.
 *
 * Layout is decided by how big the board actually is, not by a breakpoint
 * guess: when it is large, your controls sit in its centre like a real game;
 * when it is phone-sized, they move to a dock beneath it.
 */
export function Table({
  label,
  pending,
  refusal,
  connection,
  onAct,
  firesAuctionTimeout,
  onPlayAgain,
  onHome,
}: {
  readonly label: React.ReactNode;
  readonly pending: Action['type'] | null;
  readonly refusal: ApiFailure | null;
  readonly connection: ConnectionStatus;
  readonly onAct: (action: Action) => void;
  readonly firesAuctionTimeout: boolean;
  readonly onPlayAgain?: () => void;
  readonly onHome: () => void;
}) {
  const game = useStage((s) => s.shown);
  const feed = useStage((s) => s.feed);
  const busy = useStage((s) => s.busy);

  const [inspect, setInspect] = useState<SquareId | null>(null);
  const [portfolioOpen, setPortfolioOpen] = useState(false);
  const [tradeOpen, setTradeOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [logOpen, setLogOpen] = useState(false);

  const [boardElement, setBoardElement] = useState<HTMLDivElement | null>(null);
  const boardWidth = useWidth(boardElement);
  const compact = boardWidth > 0 && boardWidth < 540;

  // An incoming offer opens itself — it is the one thing you must answer.
  const tradeId = game?.publicState?.openTrade?.id ?? null;
  const incoming = game?.publicState?.openTrade?.toId === game?.you.playerId;
  useEffect(() => {
    if (tradeId !== null && incoming) setReviewOpen(true);
    if (tradeId === null) setReviewOpen(false);
  }, [tradeId, incoming]);

  if (game === null || game.publicState === null) return null;

  const state = game.publicState;
  const pack = getBoardPack(state.boardPackId);
  const you = game.you.playerId;
  const gameOver = state.phase.kind === 'game_over';

  const panel = (variant: 'centre' | 'dock') => (
    <ActionPanel
      game={game}
      busy={busy}
      pending={pending}
      refusal={refusal}
      onAct={onAct}
      onOpenPortfolio={() => setPortfolioOpen(true)}
      onOpenTrade={() => setTradeOpen(true)}
      onReviewTrade={() => setReviewOpen(true)}
      firesAuctionTimeout={firesAuctionTimeout}
      hotkeys
      variant={variant}
    />
  );

  return (
    <div className="felt flex min-h-dvh flex-col lg:h-dvh lg:overflow-hidden">
      <TopBar label={label} />

      {connection !== 'live' && (
        <div
          role="status"
          className="relative z-20 mx-4 mb-2 flex items-center justify-center gap-2 rounded-xl bg-warn/15 px-3 py-1.5 text-sm text-warn ring-1 ring-warn/30"
        >
          <span className="size-2 animate-pulse rounded-full bg-warn" />
          {connection === 'connecting'
            ? 'Connecting…'
            : 'Reconnecting — the board may be out of date'}
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col lg:grid lg:grid-cols-[280px_minmax(0,1fr)] lg:gap-5 lg:px-5 lg:pb-5 xl:grid-cols-[300px_minmax(0,1fr)_320px]">
        <aside className="hidden min-h-0 flex-col gap-4 lg:flex">
          <section className="glass scrollbar-thin max-h-full shrink-0 overflow-y-auto rounded-3xl p-3">
            <PanelTitle>Players</PanelTitle>
            <PlayerList state={state} players={game.players} youId={you} variant="rail" />
          </section>
          <section className="glass flex min-h-0 flex-1 flex-col overflow-hidden rounded-3xl xl:hidden">
            <PanelTitle className="px-4 pt-3">Game log</PanelTitle>
            <div className="min-h-0 flex-1">
              <Feed lines={feed} state={state} players={game.players} />
            </div>
          </section>
        </aside>

        <main className="flex min-h-0 flex-col items-center gap-3 px-2 pb-4 lg:justify-center lg:px-0 lg:pb-0">
          <div className="w-full px-2 lg:hidden">
            <PlayerList state={state} players={game.players} youId={you} variant="strip" />
          </div>

          <div ref={setBoardElement} className="w-full max-w-[min(100%,calc(100dvh-6rem))]">
            <Board
              state={state}
              players={game.players}
              currency={pack.currencySymbol}
              youId={you}
              onSelectSquare={setInspect}
              centre={compact ? null : panel('centre')}
            />
          </div>

          {compact && (
            <div className="sticky bottom-0 z-30 w-full max-w-xl px-1 pb-[env(safe-area-inset-bottom)]">
              {panel('dock')}
            </div>
          )}

          <div className="flex w-full max-w-xl gap-2 px-1 lg:hidden">
            <button
              type="button"
              onClick={() => setLogOpen(true)}
              className="glass flex h-11 flex-1 items-center justify-center gap-2 rounded-xl text-sm font-semibold text-text-muted active:scale-[0.98]"
            >
              <ListIcon className="size-4" /> Game log
            </button>
            <button
              type="button"
              onClick={() => setPortfolioOpen(true)}
              className="glass flex h-11 flex-1 items-center justify-center gap-2 rounded-xl text-sm font-semibold text-text-muted active:scale-[0.98]"
            >
              <StackIcon className="size-4" /> My property
            </button>
          </div>
        </main>

        <aside className="hidden min-h-0 flex-col xl:flex">
          <section className="glass flex min-h-0 flex-1 flex-col overflow-hidden rounded-3xl">
            <PanelTitle className="px-4 pt-3">Game log</PanelTitle>
            <div className="min-h-0 flex-1">
              <Feed lines={feed} state={state} players={game.players} />
            </div>
            <button
              type="button"
              onClick={() => setPortfolioOpen(true)}
              className="m-3 flex h-11 items-center justify-center gap-2 rounded-xl bg-white/5 text-sm font-semibold text-text-muted ring-1 ring-inset ring-white/5 transition hover:bg-white/10 hover:text-text active:scale-[0.98]"
            >
              <StackIcon className="size-4" /> My property
            </button>
          </section>
        </aside>
      </div>

      <Dialog
        open={inspect !== null}
        onClose={() => setInspect(null)}
        title={inspect === null ? '' : 'Deed'}
        className="sm:max-w-sm"
      >
        {inspect !== null && (
          <DeedCard state={state} squareId={inspect} players={game.players} youId={you} />
        )}
      </Dialog>

      <Portfolio
        open={portfolioOpen}
        onClose={() => setPortfolioOpen(false)}
        game={game}
        busy={busy || pending !== null}
        onAct={onAct}
        onInspect={(id) => {
          setPortfolioOpen(false);
          setInspect(id);
        }}
      />

      <TradeComposer
        open={tradeOpen}
        onClose={() => setTradeOpen(false)}
        game={game}
        onAct={onAct}
      />
      <TradeReview
        open={reviewOpen}
        onClose={() => setReviewOpen(false)}
        game={game}
        onAct={onAct}
      />

      <Dialog
        open={logOpen}
        onClose={() => setLogOpen(false)}
        title="Game log"
        className="h-[80dvh]"
      >
        <div className="-mx-3 h-full">
          <Feed lines={feed} state={state} players={game.players} />
        </div>
      </Dialog>

      {gameOver && !busy && (
        <GameOver
          game={game}
          onHome={onHome}
          {...(onPlayAgain === undefined ? {} : { onPlayAgain })}
        />
      )}
    </div>
  );
}

function PanelTitle({
  children,
  className,
}: {
  readonly children: React.ReactNode;
  readonly className?: string;
}) {
  return (
    <h2
      className={`mb-2 px-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-text-faint ${className ?? ''}`}
    >
      {children}
    </h2>
  );
}

function useWidth(element: HTMLElement | null): number {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (element === null) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry !== undefined) setWidth(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);
  return width;
}
