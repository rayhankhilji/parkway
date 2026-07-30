import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * The four button variants in the design system, and nothing else.
 *
 * `disabledReason` exists because of a rule in DESIGN.md that is easy to skip: a
 * disabled control must say why it is disabled, and the reason must come from the
 * engine's legality result rather than being invented here. A component that
 * writes its own explanation for why an action is unavailable has started
 * guessing at rules.
 */

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'default' | 'compact' | 'bar';

const variants: Record<Variant, string> = {
  primary: 'bg-accent-solid text-white hover:bg-accent',
  secondary: 'bg-surface-raised text-text ring-1 ring-border hover:bg-border',
  ghost: 'bg-transparent text-text-muted hover:text-text',
  danger: 'bg-transparent text-danger ring-1 ring-transparent hover:ring-danger',
};

const sizes: Record<Size, string> = {
  default: 'h-9 px-4 text-base',
  compact: 'h-8 px-3 text-sm',
  bar: 'h-11 px-5 text-base',
};

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  readonly variant?: Variant;
  readonly size?: Size;
  readonly pending?: boolean;
  /** Shown as the title when disabled. Comes from the engine, never invented. */
  readonly disabledReason?: string;
  readonly children: ReactNode;
};

export function Button({
  variant = 'secondary',
  size = 'default',
  pending = false,
  disabledReason,
  className,
  disabled,
  children,
  ...rest
}: ButtonProps) {
  const isDisabled = disabled === true || pending;

  return (
    <button
      type="button"
      {...rest}
      disabled={isDisabled}
      title={isDisabled ? disabledReason : undefined}
      aria-busy={pending}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-md font-medium',
        'transition-colors duration-120 ease-standard',
        variants[variant],
        sizes[size],
        // A disabled control still has to read as a control. Without the ring it
        // looks like a line of dim text and people stop looking for it.
        isDisabled &&
          'cursor-not-allowed bg-surface text-text-faint ring-1 ring-border hover:bg-surface',
        className,
      )}
    >
      {pending && <Spinner />}
      {children}
    </button>
  );
}

/** The only looping animation in the system, and only for real pending work. */
function Spinner() {
  return (
    <span
      aria-hidden="true"
      className="size-3 animate-spin rounded-full border border-current border-t-transparent"
    />
  );
}
