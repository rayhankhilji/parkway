import { cn } from '@/lib/cn';

/**
 * A player's token.
 *
 * Movement is a position transition rather than a walk along each square: the
 * brief prioritises function, and instant clarity about where a token ended up
 * beats watching it travel (→ DESIGN, Motion). `prefers-reduced-motion` drops the
 * transition entirely, handled globally in the stylesheet.
 */
export function Token({ colour, className }: { colour: string; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'size-2 rounded-full ring-1 ring-bg transition-transform duration-200 ease-standard',
        className,
      )}
      style={{ backgroundColor: `var(--color-player-${colour})` }}
    />
  );
}
