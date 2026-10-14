import type { InputHTMLAttributes, ReactNode } from 'react';
import { useId } from 'react';
import { cn } from '@/lib/cn';

/**
 * Labelled inputs.
 *
 * The label is always rendered and always tied to its control by id — never a
 * placeholder standing in for one, which disappears the moment someone starts
 * typing and leaves a screen reader with nothing.
 */

const control =
  'h-12 w-full rounded-xl border border-white/10 bg-black/30 px-4 text-base text-text placeholder:text-text-faint transition focus:border-gold/60 focus:bg-black/40 focus:outline-none focus:ring-4 focus:ring-gold/10';

const labelClass = 'text-xs font-semibold uppercase tracking-[0.08em] text-text-muted';

export function TextField({
  label,
  hint,
  error,
  className,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & {
  readonly label: string;
  readonly hint?: string;
  readonly error?: string | undefined;
}) {
  const id = useId();
  const describedBy =
    error !== undefined ? `${id}-error` : hint !== undefined ? `${id}-hint` : undefined;

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className={labelClass}>
        {label}
      </label>
      <input
        id={id}
        {...rest}
        aria-describedby={describedBy}
        aria-invalid={error !== undefined}
        className={cn(control, error !== undefined && 'border-bad/70', className)}
      />
      {error !== undefined ? (
        <p id={`${id}-error`} className="text-sm text-bad">
          {error}
        </p>
      ) : (
        hint !== undefined && (
          <p id={`${id}-hint`} className="text-sm text-text-faint">
            {hint}
          </p>
        )
      )}
    </div>
  );
}

/**
 * A row of mutually exclusive chips — friendlier than a select for a handful
 * of options, and every option is visible without opening anything.
 */
export function ChoiceField<T extends string | number>({
  label,
  value,
  options,
  onChange,
}: {
  readonly label: string;
  readonly value: T;
  readonly options: readonly { readonly value: T; readonly label: ReactNode }[];
  readonly onChange: (value: T) => void;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <span id={id} className={labelClass}>
        {label}
      </span>
      <div role="radiogroup" aria-labelledby={id} className="flex flex-wrap gap-1.5">
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <button
              key={String(option.value)}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange(option.value)}
              className={cn(
                'h-9 rounded-lg px-3 text-sm font-semibold transition active:scale-95',
                selected
                  ? 'bg-gold/15 text-gold-bright ring-1 ring-inset ring-gold/60'
                  : 'bg-white/[0.04] text-text-muted ring-1 ring-inset ring-white/10 hover:text-text',
              )}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function ToggleField({
  label,
  description,
  checked,
  onChange,
}: {
  readonly label: string;
  readonly description?: string;
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
}) {
  const id = useId();
  return (
    <div className="flex items-center justify-between gap-4">
      <label htmlFor={id} className="min-w-0 cursor-pointer">
        <span className="block text-sm font-semibold text-text">{label}</span>
        {description !== undefined && (
          <span className="block text-xs text-text-faint">{description}</span>
        )}
      </label>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative h-7 w-12 shrink-0 rounded-full transition-colors',
          checked ? 'bg-gold' : 'bg-white/10',
        )}
      >
        <span
          className={cn(
            'absolute top-1 size-5 rounded-full bg-white shadow-sm transition-transform duration-200 ease-[cubic-bezier(0.34,1.56,0.64,1)]',
            checked ? 'translate-x-6' : 'translate-x-1',
          )}
        />
      </button>
    </div>
  );
}
