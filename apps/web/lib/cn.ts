import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Conditional class names, with later utilities winning over earlier ones.
 *
 * Without the merge, a component that sets `p-4` and accepts a `p-6` override
 * emits both and the winner depends on the order Tailwind happened to generate
 * them in — which is not a thing anyone should have to reason about.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
