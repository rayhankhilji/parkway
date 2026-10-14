'use client';

import { cn } from '@/lib/cn';
import { useStage } from '@/store/useStage';

/**
 * Two real dice.
 *
 * Each is a CSS cube that tumbles to the face the engine already rolled. The
 * spin accumulates whole turns per roll so every throw visibly tumbles, even
 * when it lands on the same face as last time.
 */

const pips: Record<number, readonly number[]> = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};

/** Face placement on the cube, and the rotation that brings each to the front. */
const faces: readonly { value: number; place: string; show: [number, number] }[] = [
  { value: 1, place: 'rotateY(0deg)', show: [0, 0] },
  { value: 6, place: 'rotateY(180deg)', show: [0, 180] },
  { value: 3, place: 'rotateY(90deg)', show: [0, -90] },
  { value: 4, place: 'rotateY(-90deg)', show: [0, 90] },
  { value: 2, place: 'rotateX(90deg)', show: [-90, 0] },
  { value: 5, place: 'rotateX(-90deg)', show: [90, 0] },
];

export function Dice({ className }: { readonly className?: string }) {
  const dice = useStage((s) => s.dice);
  const values = dice?.values ?? ([5, 3] as const);
  const key = dice?.key ?? 0;
  const rolling = dice?.rolling === true;

  return (
    <div className={cn('flex items-end justify-center gap-[2.2cqw]', className)} aria-hidden="true">
      <Die value={values[0]} turn={key} rolling={rolling} seed={1} idle={dice === null} />
      <Die value={values[1]} turn={key} rolling={rolling} seed={2} idle={dice === null} />
    </div>
  );
}

function Die({
  value,
  turn,
  rolling,
  seed,
  idle,
}: {
  readonly value: number;
  readonly turn: number;
  readonly rolling: boolean;
  readonly seed: number;
  readonly idle: boolean;
}) {
  const face = faces.find((candidate) => candidate.value === value) ?? faces[0];
  const [x, y] = face?.show ?? [0, 0];
  // Whole extra turns, different per die, so the pair never spins in lockstep.
  const spinX = turn * (720 + seed * 360);
  const spinY = turn * (1080 - seed * 360);
  const tilt = seed === 1 ? -14 : 11;

  return (
    <div className="relative size-[6.4cqw]" style={{ perspective: '600px' }}>
      <span
        className={cn(
          'absolute -bottom-[0.8cqw] left-1/2 h-[1.4cqw] w-[80%] -translate-x-1/2 rounded-[50%] bg-black/35 blur-[3px] transition-all duration-700',
          rolling && 'w-[50%] opacity-50',
        )}
      />
      <div
        className={cn(
          'size-full transition-transform',
          rolling ? 'duration-[1000ms]' : 'duration-0',
        )}
        style={{
          transform: rolling ? `translateY(-2.5cqw)` : 'translateY(0)',
          transitionTimingFunction: 'cubic-bezier(0.3, 1.6, 0.6, 1)',
        }}
      >
        <div
          className="die"
          style={{
            transform: `rotateX(${x + spinX - 18}deg) rotateY(${y + spinY}deg) rotateZ(${tilt}deg)`,
            transition: turn === 0 ? 'none' : 'transform 1000ms cubic-bezier(0.15, 0.85, 0.25, 1)',
            opacity: idle ? 0.85 : 1,
          }}
        >
          {faces.map((side) => (
            <div
              key={side.value}
              className="die-face"
              style={{ transform: `${side.place} translateZ(3.2cqw)` }}
            >
              {Array.from({ length: 9 }, (_, index) => (
                <span
                  key={index}
                  className={(pips[side.value] ?? []).includes(index) ? 'die-pip' : ''}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
