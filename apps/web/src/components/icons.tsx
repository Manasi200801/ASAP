/**
 * One drawn set, one stroke weight.
 *
 * These replaced literal ✓ ✕ ◆ ▶ → characters. Text glyphs pick up whatever the
 * platform font decides - on Windows Chrome U+25B6 renders as a colour emoji,
 * and the tick and cross land on different baselines at different weights - so a
 * status column built from them reads as inconsistent at projector distance.
 * Every icon here sits on a 16 grid, inherits `currentColor`, and is decorative:
 * the label beside it always carries the meaning.
 */
import type { ReactNode } from "react";

type IconProps = { className?: string };

function Svg({ className = "", children }: IconProps & { children: ReactNode }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 16 16"
      className={`flex-none ${className}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

export function CheckIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M3.2 8.6 6.4 11.8 12.8 4.6" />
    </Svg>
  );
}

export function CrossIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M4.2 4.2 11.8 11.8M11.8 4.2 4.2 11.8" />
    </Svg>
  );
}

/** Marks a check a model judged rather than arithmetic decided. */
export function JudgedIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M8 1.8 10 6 14.2 8 10 10 8 14.2 6 10 1.8 8 6 6Z" strokeWidth="1.4" />
    </Svg>
  );
}

export function ChevronIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M6 3.5 10.5 8 6 12.5" />
    </Svg>
  );
}

export function ArrowIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M2.8 8h10.4M9 3.8 13.2 8 9 12.2" />
    </Svg>
  );
}

export function SendIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M13.6 2.4 7.2 8.8M13.6 2.4 9.6 13.8 7.2 8.8 2.2 6.4Z" strokeWidth="1.5" />
    </Svg>
  );
}

/** Reassurance on the approval gate: parked, reversible, not paid. */
export function ShieldIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M8 1.8 13.4 3.9v4c0 3.2-2.2 5.4-5.4 6.3-3.2-.9-5.4-3.1-5.4-6.3v-4Z" strokeWidth="1.4" />
      <path d="M5.8 7.9 7.4 9.5 10.4 6.3" strokeWidth="1.4" />
    </Svg>
  );
}

export function UploadIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M8 11V2.6M4.6 6 8 2.6 11.4 6" strokeWidth="1.5" />
      <path d="M2.4 10.6v1.6a1.4 1.4 0 0 0 1.4 1.4h8.4a1.4 1.4 0 0 0 1.4-1.4v-1.6" strokeWidth="1.5" />
    </Svg>
  );
}

export function BatchIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M3.4 2.4h6l3.2 3.2v8a.6.6 0 0 1-.6.6H3.4a.6.6 0 0 1-.6-.6V3a.6.6 0 0 1 .6-.6Z" strokeWidth="1.5" />
      <path d="M9.2 2.6v3.2h3.2M5.6 9h4.8M5.6 11.4h3.2" strokeWidth="1.5" />
    </Svg>
  );
}
