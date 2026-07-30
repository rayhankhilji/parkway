import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';
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
  'h-9 w-full rounded-md border border-border bg-surface px-3 text-base text-text placeholder:text-text-faint';

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
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-xs uppercase tracking-[0.04em] text-text-muted">
        {label}
      </label>
      <input
        id={id}
        {...rest}
        aria-describedby={describedBy}
        aria-invalid={error !== undefined}
        className={cn(control, error !== undefined && 'border-danger', className)}
      />
      {error !== undefined ? (
        <p id={`${id}-error`} className="text-sm text-danger">
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

export function SelectField({
  label,
  children,
  className,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement> & {
  readonly label: string;
  readonly children: ReactNode;
}) {
  const id = useId();

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-xs uppercase tracking-[0.04em] text-text-muted">
        {label}
      </label>
      <select id={id} {...rest} className={cn(control, className)}>
        {children}
      </select>
    </div>
  );
}

export function CheckField({
  label,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { readonly label: string }) {
  const id = useId();

  return (
    <div className="flex items-center gap-2">
      <input
        id={id}
        type="checkbox"
        {...rest}
        className="size-4 rounded-sm border border-border bg-surface accent-accent-solid"
      />
      <label htmlFor={id} className="text-base text-text-muted">
        {label}
      </label>
    </div>
  );
}
