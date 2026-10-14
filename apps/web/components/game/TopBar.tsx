'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { BoltFastIcon, SoundIcon } from '@/components/board/icons';
import { cn } from '@/lib/cn';
import { isMuted, onMuteChange, setMuted } from '@/lib/sound';
import { useStage } from '@/store/useStage';

/** The slim bar above the table: the mark, where you are, and the two switches. */
export function TopBar({
  label,
  status,
}: {
  readonly label: React.ReactNode;
  readonly status?: React.ReactNode;
}) {
  const [muted, setMutedState] = useState(false);
  const fast = useStage((s) => s.fast);
  const setFast = useStage((s) => s.setFast);

  useEffect(() => {
    setMutedState(isMuted());
    return onMuteChange(setMutedState);
  }, []);

  return (
    <header className="relative z-30 flex h-14 shrink-0 items-center gap-3 px-4 pt-[env(safe-area-inset-top)]">
      <Link href="/" className="flex items-center gap-2">
        <Mark className="size-7" />
        <span className="font-display text-xl font-black italic tracking-tight">Parkway</span>
      </Link>
      <span className="hidden h-5 w-px bg-white/10 sm:block" />
      <div className="hidden min-w-0 truncate text-sm text-text-muted sm:block">{label}</div>
      <div className="ml-auto flex items-center gap-1">
        {status}
        <IconToggle
          label={fast ? 'Normal animation speed' : 'Faster animations'}
          active={fast}
          onClick={() => setFast(!fast)}
        >
          <BoltFastIcon className="size-[18px]" />
        </IconToggle>
        <IconToggle
          label={muted ? 'Turn sound on' : 'Mute'}
          active={!muted}
          onClick={() => setMuted(!muted)}
        >
          <SoundIcon muted={muted} className="size-[18px]" />
        </IconToggle>
      </div>
    </header>
  );
}

function IconToggle({
  label,
  active,
  onClick,
  children,
}: {
  readonly label: string;
  readonly active: boolean;
  readonly onClick: () => void;
  readonly children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      aria-pressed={active}
      className={cn(
        'flex size-9 items-center justify-center rounded-full transition active:scale-90',
        active
          ? 'text-gold-bright hover:bg-white/5'
          : 'text-text-faint hover:bg-white/5 hover:text-text',
      )}
    >
      {children}
    </button>
  );
}

/** The Parkway mark: a gold roundel with the road turning through it. */
export function Mark({ className }: { readonly className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="mark-gold" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f8dc92" />
          <stop offset="0.55" stopColor="#e6bc5f" />
          <stop offset="1" stopColor="#a87b2a" />
        </linearGradient>
      </defs>
      <rect x="1.5" y="1.5" width="29" height="29" rx="8" fill="url(#mark-gold)" />
      <rect
        x="1.5"
        y="1.5"
        width="29"
        height="29"
        rx="8"
        fill="none"
        stroke="rgb(255 255 255 / 0.35)"
      />
      <path
        d="M9 24V10.5A2.5 2.5 0 0 1 11.5 8H17a5 5 0 0 1 0 10h-4"
        fill="none"
        stroke="#2a1d07"
        strokeWidth="3.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="22.5" cy="22.5" r="2.4" fill="#b3261e" />
    </svg>
  );
}
