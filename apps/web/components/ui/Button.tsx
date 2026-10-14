import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * Buttons.
 *
 * `primary` is polished gold — the one thing to press. Everything presses down
 * a little on click, because a control that does not respond to the finger
 * feels broken on a touch screen even when it works.
 *
 * `disabledReason` exists because a disabled control must say why, and the
 * reason must come from the engine's answer rather than being invented here.
 */

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'good';
type Size = 'sm' | 'md' | 'lg' | 'xl';

const variants: Record<Variant, string> = {
  primary:
    'text-[#2a1d07] bg-[linear-gradient(180deg,#f8dc92,#e6bc5f_55%,#c99a3c)] shadow-[0_1px_0_rgb(255_255_255/0.5)_inset,0_-2px_0_rgb(120_80_20/0.35)_inset,0_6px_16px_rgb(230_188_95/0.25)] hover:brightness-110',
  secondary:
    'text-text bg-surface-high/90 ring-1 ring-inset ring-white/10 hover:bg-[#3a3126] shadow-sm',
  ghost: 'text-text-muted hover:text-text hover:bg-white/5',
  danger: 'text-[#ffd8d3] bg-[#4a1914] ring-1 ring-inset ring-bad/40 hover:bg-[#5c1f18]',
  good: 'text-[#0c2615] bg-[linear-gradient(180deg,#7be3a3,#4fca80_60%,#36a764)] shadow-[0_1px_0_rgb(255_255_255/0.4)_inset,0_6px_16px_rgb(79_202_128/0.22)] hover:brightness-110',
};

const sizes: Record<Size, string> = {
  sm: 'h-8 px-3 text-sm rounded-lg',
  md: 'h-10 px-4 text-sm rounded-xl',
  lg: 'h-12 px-5 text-base rounded-xl',
  xl: 'h-14 px-7 text-lg rounded-2xl',
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
  size = 'md',
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
      title={isDisabled ? disabledReason : rest.title}
      aria-busy={pending}
      className={cn(
        'relative inline-flex select-none items-center justify-center gap-2 whitespace-nowrap font-semibold',
        'transition-[transform,filter,background-color,box-shadow] duration-150 ease-out',
        'active:scale-[0.96]',
        variants[variant],
        sizes[size],
        isDisabled && 'pointer-events-none opacity-45 saturate-50',
        className,
      )}
    >
      {pending && <Spinner />}
      {children}
    </button>
  );
}

function Spinner() {
  return (
    <span
      aria-hidden="true"
      className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
    />
  );
}
