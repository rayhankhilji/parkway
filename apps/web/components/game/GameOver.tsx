'use client';

import { useEffect, useRef } from 'react';
import { getBoardPack, netWorth } from '@parkway/engine';
import { Token } from '@/components/board/TokenLayer';
import { Button } from '@/components/ui/Button';
import type { GamePayload } from '@/lib/apiClient';
import { cn } from '@/lib/cn';
import { formatMoney } from '@/lib/format';
import { rulesView } from '@/lib/rulesView';

/** The end: a winner, confetti, the final standings, and a way back in. */
export function GameOver({
  game,
  onPlayAgain,
  onHome,
}: {
  readonly game: GamePayload;
  readonly onPlayAgain?: () => void;
  readonly onHome: () => void;
}) {
  const state = game.publicState;
  if (state === null || state.phase.kind !== 'game_over') return null;

  const pack = getBoardPack(state.boardPackId);
  const winnerId = state.phase.winnerId;
  const winner = game.players.find((player) => player.id === winnerId);
  const youWon = winnerId === game.you.playerId;
  const view = rulesView(state);

  const standings = [...game.players]
    .map((player) => ({
      player,
      worth: state.players[player.id]?.bankrupt === true ? 0 : netWorth(view, player.id),
      out: state.players[player.id]?.bankrupt === true,
    }))
    .sort((a, b) =>
      a.player.id === winnerId ? -1 : b.player.id === winnerId ? 1 : b.worth - a.worth,
    );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 animate-[fade-up_400ms_ease-out_both] bg-scrim backdrop-blur-sm" />
      <Confetti />
      <div className="glass relative w-full max-w-md animate-pop-in rounded-3xl p-6 text-center shadow-dialog sm:p-8">
        {winner !== undefined && (
          <div className="mx-auto mb-4 size-20 animate-bob">
            <Token colour={winner.colour} initial={winner.name} labelClassName="text-4xl" active />
          </div>
        )}
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gold">
          {youWon ? 'Victory' : 'Game over'}
        </p>
        <h2 className="mt-1 font-display text-4xl font-black italic leading-tight">
          {youWon ? 'You own Ashvale' : `${winner?.name ?? 'Someone'} wins`}
        </h2>
        <p className="mt-2 text-sm text-text-muted">
          {youWon ? 'Every rival bankrupt. Magnificent.' : 'Last player standing takes the city.'}
        </p>

        <ol className="mt-6 flex flex-col gap-1.5 text-left">
          {standings.map(({ player, worth, out }, index) => (
            <li
              key={player.id}
              className={cn(
                'flex items-center gap-3 rounded-xl px-3 py-2',
                index === 0 ? 'bg-gold/10 ring-1 ring-gold/40' : 'bg-black/25',
              )}
            >
              <span className="w-4 text-sm font-bold text-text-faint">{index + 1}</span>
              <span className="size-6">
                <Token colour={player.colour} initial={player.name} labelClassName="text-xs" />
              </span>
              <span
                className={cn(
                  'flex-1 truncate text-sm font-semibold',
                  out && 'text-text-faint line-through',
                )}
              >
                {player.name}
              </span>
              <span className="text-sm tabular-nums text-text-muted">
                {out ? 'Bankrupt' : formatMoney(worth, pack.currencySymbol)}
              </span>
            </li>
          ))}
        </ol>

        <div className="mt-6 flex gap-2">
          <Button variant="secondary" size="lg" className="flex-1" onClick={onHome}>
            Home
          </Button>
          {onPlayAgain !== undefined && (
            <Button variant="primary" size="lg" className="flex-1" onClick={onPlayAgain}>
              Play again
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

/** A one-shot burst of paper confetti on a canvas. */
function Confetti() {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const element = canvas.current;
    const ctx = element?.getContext('2d');
    if (element == null || ctx == null) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const dpr = window.devicePixelRatio || 1;
    const resize = () => {
      element.width = window.innerWidth * dpr;
      element.height = window.innerHeight * dpr;
    };
    resize();

    const colours = ['#e6bc5f', '#f7d98c', '#f2606f', '#4fb3f0', '#37c47a', '#a77ef5', '#f7f0e1'];
    const pieces = Array.from({ length: 180 }, () => ({
      x: window.innerWidth / 2 + (Math.random() - 0.5) * 200,
      y: window.innerHeight * 0.45,
      vx: (Math.random() - 0.5) * 16,
      vy: -Math.random() * 18 - 6,
      size: 6 + Math.random() * 7,
      rotation: Math.random() * Math.PI,
      spin: (Math.random() - 0.5) * 0.3,
      colour: colours[Math.floor(Math.random() * colours.length)] ?? '#e6bc5f',
    }));

    let frame = 0;
    let raf = 0;
    const draw = () => {
      frame += 1;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
      for (const piece of pieces) {
        piece.vy += 0.42;
        piece.vx *= 0.985;
        piece.x += piece.vx;
        piece.y += piece.vy;
        piece.rotation += piece.spin;
        ctx.save();
        ctx.translate(piece.x, piece.y);
        ctx.rotate(piece.rotation);
        ctx.scale(1, Math.cos(frame * 0.1 + piece.size));
        ctx.fillStyle = piece.colour;
        ctx.fillRect(-piece.size / 2, -piece.size / 4, piece.size, piece.size / 2);
        ctx.restore();
      }
      if (frame < 360) raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    window.addEventListener('resize', resize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
  }, []);

  return (
    <canvas
      ref={canvas}
      className="pointer-events-none fixed inset-0 size-full"
      aria-hidden="true"
    />
  );
}
