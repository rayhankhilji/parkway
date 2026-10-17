'use client';

import { useEffect, useId, useRef } from 'react';
import { cn } from '@/lib/cn';
import { CloseIcon } from '@/components/board/icons';

/**
 * A modal that is a bottom sheet on a phone and a centred card on a desktop.
 *
 * Escape and a tap on the scrim both close it, focus moves into it on open and
 * back to wherever it came from on close.
 */
export function Dialog({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  className,
  dismissable = true,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly title: React.ReactNode;
  readonly subtitle?: React.ReactNode;
  readonly children: React.ReactNode;
  readonly footer?: React.ReactNode;
  readonly className?: string;
  readonly dismissable?: boolean;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.focus();

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && dismissable) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      previous?.focus?.();
    };
  }, [open, onClose, dismissable]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6">
      <button
        type="button"
        aria-label="Close"
        tabIndex={-1}
        className="absolute inset-0 animate-[fade-up_200ms_ease-out_both] bg-scrim backdrop-blur-[3px]"
        onClick={() => dismissable && onClose()}
      />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cn(
          'glass relative flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-3xl shadow-dialog outline-none',
          'animate-sheet-up sm:max-w-lg sm:rounded-3xl',
          className,
        )}
      >
        <div
          className="mx-auto mt-2 h-1 w-10 rounded-full bg-white/15 sm:hidden"
          aria-hidden="true"
        />
        <header className="flex items-start gap-3 px-5 pb-3 pt-4 sm:px-6 sm:pt-5">
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="font-display text-2xl font-bold leading-tight">
              {title}
            </h2>
            {subtitle !== undefined && <p className="mt-1 text-sm text-text-muted">{subtitle}</p>}
          </div>
          {dismissable && (
            <button
              type="button"
              onClick={onClose}
              className="-mr-2 rounded-full p-2 text-text-muted transition hover:bg-white/5 hover:text-text"
              aria-label="Close"
            >
              <CloseIcon className="size-5" />
            </button>
          )}
        </header>
        <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-5 pb-5 sm:px-6">
          {children}
        </div>
        {footer !== undefined && (
          <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-white/5 bg-black/20 px-5 py-3 pb-[max(12px,env(safe-area-inset-bottom))] sm:px-6">
            {footer}
          </footer>
        )}
      </div>
    </div>
  );
}
