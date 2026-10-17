import type { SVGProps } from 'react';

/**
 * The board's pictograms. Drawn as single-weight line art so they print like
 * ink on the ivory stock, and inherit their colour from the text around them.
 */

type IconProps = SVGProps<SVGSVGElement>;

const base = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
} as const;

export function TrainIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <rect x="5" y="3" width="14" height="13" rx="3" />
      <path d="M5 10h14M9 20l-2 2M15 20l2 2M8 16l-1 4h10l-1-4" />
      <circle cx="8.5" cy="13" r="0.8" fill="currentColor" />
      <circle cx="15.5" cy="13" r="0.8" fill="currentColor" />
    </svg>
  );
}

export function DropIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z" />
      <path d="M9 14.5a3 3 0 0 0 3 3" />
    </svg>
  );
}

export function BoltIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z" />
    </svg>
  );
}

export function QuestionIcon(props: IconProps) {
  return (
    <svg {...base} {...props} strokeWidth={2.2}>
      <path d="M8.5 8.5a3.5 3.5 0 1 1 5 3.2c-1 .5-1.5 1.2-1.5 2.3v.5" />
      <circle cx="12" cy="18.5" r="0.6" fill="currentColor" />
    </svg>
  );
}

export function ChestIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M4 10a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v9H4z" />
      <path d="M4 12h16M11 11h2v3h-2z" />
    </svg>
  );
}

export function CoinIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <ellipse cx="12" cy="7" rx="7" ry="3" />
      <path d="M5 7v5c0 1.7 3.1 3 7 3s7-1.3 7-3V7M5 12v5c0 1.7 3.1 3 7 3s7-1.3 7-3v-5" />
    </svg>
  );
}

export function GemIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M6 3h12l3 6-9 12L3 9z" />
      <path d="M3 9h18M9 3l3 18M15 3l-3 18" />
    </svg>
  );
}

export function BarsIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <rect x="4" y="3" width="16" height="18" rx="1.5" />
      <path d="M8 3v18M12 3v18M16 3v18" />
    </svg>
  );
}

export function TreeIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M12 21v-6" />
      <path d="M12 3c3 0 5.5 2.4 5.5 5.3 0 .6-.1 1.1-.3 1.6A3.8 3.8 0 0 1 15.5 17h-7a3.8 3.8 0 0 1-1.7-7.1 5 5 0 0 1-.3-1.6C6.5 5.4 9 3 12 3z" />
    </svg>
  );
}

export function GavelIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="m14 4 6 6M11 7l6 6M12.5 5.5l-4 4 6 6 4-4M10.5 11.5 3 19l2 2 7.5-7.5M3 22h9" />
    </svg>
  );
}

export function ArrowIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M20 12H4M10 6l-6 6 6 6" />
    </svg>
  );
}

export function SoundIcon({ muted, ...props }: IconProps & { readonly muted: boolean }) {
  return (
    <svg {...base} {...props}>
      <path d="M4 9v6h4l5 4V5L8 9z" />
      {muted ? (
        <path d="m16 9 5 6M21 9l-5 6" />
      ) : (
        <path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" />
      )}
    </svg>
  );
}

export function BoltFastIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M4 6l7 6-7 6M12 6l7 6-7 6" />
    </svg>
  );
}

export function CloseIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}

export function HouseIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 10 10" aria-hidden="true" {...props}>
      <path d="M1 5 5 1.5 9 5v4H1z" fill="currentColor" />
    </svg>
  );
}

export function SwapIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M4 8h14l-4-4M20 16H6l4 4" />
    </svg>
  );
}

export function StackIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M12 3 3 8l9 5 9-5-9-5zM3 13l9 5 9-5M3 17.5l9 5 9-5" />
    </svg>
  );
}

export function ListIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" />
    </svg>
  );
}

export function UsersIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6.5 6.5 0 0 1 3.5 6" />
    </svg>
  );
}

export function FlagIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M5 21V4M5 4h11l-2 4 2 4H5" />
    </svg>
  );
}

export function KeyIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="8" cy="15" r="4" />
      <path d="m11 12 9-9M17 6l3 3M15 8l2 2" />
    </svg>
  );
}
