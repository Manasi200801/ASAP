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
      <path
        d="M8 1.8 13.4 3.9v4c0 3.2-2.2 5.4-5.4 6.3-3.2-.9-5.4-3.1-5.4-6.3v-4Z"
        strokeWidth="1.4"
      />
      <path d="M5.8 7.9 7.4 9.5 10.4 6.3" strokeWidth="1.4" />
    </Svg>
  );
}

export function UploadIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M8 11V2.6M4.6 6 8 2.6 11.4 6" strokeWidth="1.5" />
      <path
        d="M2.4 10.6v1.6a1.4 1.4 0 0 0 1.4 1.4h8.4a1.4 1.4 0 0 0 1.4-1.4v-1.6"
        strokeWidth="1.5"
      />
    </Svg>
  );
}

export function BatchIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path
        d="M3.4 2.4h6l3.2 3.2v8a.6.6 0 0 1-.6.6H3.4a.6.6 0 0 1-.6-.6V3a.6.6 0 0 1 .6-.6Z"
        strokeWidth="1.5"
      />
      <path d="M9.2 2.6v3.2h3.2M5.6 9h4.8M5.6 11.4h3.2" strokeWidth="1.5" />
    </Svg>
  );
}

/** Command Center: a 2x2 grid, the classic "dashboard" mark. */
export function GridIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <rect x="2" y="2" width="5" height="5" rx="1" strokeWidth="1.5" />
      <rect x="9" y="2" width="5" height="5" rx="1" strokeWidth="1.5" />
      <rect x="2" y="9" width="5" height="5" rx="1" strokeWidth="1.5" />
      <rect x="9" y="9" width="5" height="5" rx="1" strokeWidth="1.5" />
    </Svg>
  );
}

/** Validation Queue: a checked list. */
export function QueueIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M3 3.6 4 4.6 6 2.6" strokeWidth="1.5" />
      <path d="M8.4 3.6h4.2" strokeWidth="1.5" />
      <path d="M3 8 4 9 6 7" strokeWidth="1.5" />
      <path d="M8.4 8h4.2" strokeWidth="1.5" />
      <path d="M3 12.4 4 13.4 6 11.4" strokeWidth="1.5" />
      <path d="M8.4 12.4h4.2" strokeWidth="1.5" />
    </Svg>
  );
}

/** Approval Workflow: a document with a signing checkmark. */
export function WorkflowIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path
        d="M4 1.8h5.2l2.8 2.8v8.8a.6.6 0 0 1-.6.6H4a.6.6 0 0 1-.6-.6V2.4a.6.6 0 0 1 .6-.6Z"
        strokeWidth="1.4"
      />
      <path d="M5.6 9.4 7 10.8 10.2 7.4" strokeWidth="1.4" />
    </Svg>
  );
}

/** History: a clock with a back-turning arrow. */
export function HistoryIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M8 1.8a6.2 6.2 0 1 1-5.4 3.1" strokeWidth="1.4" />
      <path d="M2.6 1.8v3.1h3.1" strokeWidth="1.4" />
      <path d="M8 4.8v3.4l2.4 1.4" strokeWidth="1.4" />
    </Svg>
  );
}

export function SearchIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <circle cx="7" cy="7" r="4.6" strokeWidth="1.5" />
      <path d="M10.4 10.4 14 14" strokeWidth="1.5" />
    </Svg>
  );
}

export function BellIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path
        d="M8 2.2c-2 0-3.4 1.6-3.4 3.7v1.9c0 .6-.2 1.2-.6 1.7l-.6.8h9.2l-.6-.8a2.7 2.7 0 0 1-.6-1.7V5.9C11.4 3.8 10 2.2 8 2.2Z"
        strokeWidth="1.4"
      />
      <path d="M6.4 12.6a1.7 1.7 0 0 0 3.2 0" strokeWidth="1.4" />
    </Svg>
  );
}

export function ProfileIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <circle cx="8" cy="5.4" r="2.6" strokeWidth="1.4" />
      <path d="M2.6 13.6c.8-2.6 2.9-4 5.4-4s4.6 1.4 5.4 4" strokeWidth="1.4" />
    </Svg>
  );
}

/** The agent, in one drawn mark rather than a literal robot glyph. */
export function AgentIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <rect x="3" y="5" width="10" height="8" rx="2" strokeWidth="1.4" />
      <path d="M8 5V2.6" strokeWidth="1.4" />
      <circle cx="8" cy="2" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="6.1" cy="8.8" r="1" fill="currentColor" stroke="none" />
      <circle cx="9.9" cy="8.8" r="1" fill="currentColor" stroke="none" />
      <path d="M1.6 8v2.4M14.4 8v2.4" strokeWidth="1.4" />
    </Svg>
  );
}

export function DocumentIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path
        d="M4 1.8h5.2l2.8 2.8v8.8a.6.6 0 0 1-.6.6H4a.6.6 0 0 1-.6-.6V2.4a.6.6 0 0 1 .6-.6Z"
        strokeWidth="1.4"
      />
      <path d="M5.4 8h5.2M5.4 10.4h5.2M5.4 5.6h2.4" strokeWidth="1.4" />
    </Svg>
  );
}

export function CloseIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M4 4 12 12M12 4 4 12" />
    </Svg>
  );
}

export function AlertIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M8 1.8 14.6 13.4H1.4Z" strokeWidth="1.3" />
      <path d="M8 6.4v3M8 11.6h.01" strokeWidth="1.6" />
    </Svg>
  );
}
