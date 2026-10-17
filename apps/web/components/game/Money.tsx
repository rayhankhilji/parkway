'use client';

import { useEffect, useRef, useState } from 'react';
import { formatMoney } from '@/lib/format';

/**
 * A sum of money that counts to its new value instead of jumping.
 *
 * Watching a balance tick down after paying rent is half the drama of the
 * game; a number that silently changes is easy to miss entirely.
 */
export function Money({
  amount,
  currency,
  className,
}: {
  readonly amount: number;
  readonly currency: string;
  readonly className?: string;
}) {
  const [shown, setShown] = useState(amount);
  const from = useRef(amount);
  const frame = useRef<number | null>(null);

  useEffect(() => {
    const start = performance.now();
    const origin = from.current;
    const delta = amount - origin;
    if (delta === 0) return;
    const duration = Math.min(900, 300 + Math.abs(delta) / 2);

    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      const value = Math.round(origin + delta * eased);
      from.current = value;
      setShown(value);
      if (t < 1) frame.current = requestAnimationFrame(step);
    };
    frame.current = requestAnimationFrame(step);
    return () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    };
  }, [amount]);

  return (
    <span className={className} data-numeric>
      {formatMoney(shown, currency)}
    </span>
  );
}
