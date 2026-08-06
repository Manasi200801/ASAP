"use client";

import type { Translate } from "@/lib/i18n";
import { useState } from "react";

/**
 * The single human approval gate.
 *
 * The label carries the whole consequence rather than floating a count above it,
 * and the excluded invoice is named rather than silently dropped. Both exist
 * because a clerk hesitates when they are not certain what they are agreeing to.
 *
 * `working` comes from the run, not local state - a batch approval can come back
 * with some invoices still unparked (a SAP write can fail for one and succeed for
 * another), which reopens this exact card for a retry. Local state that only ever
 * moved forward would leave the button stuck disabled forever after that first
 * round; deriving from the run means it always reflects what is actually running.
 */
export function ApprovalCard({
  readyCount,
  blockedCount,
  working,
  onApprove,
  t,
}: {
  readyCount: number;
  blockedCount: number;
  working: boolean;
  onApprove: () => void;
  t: Translate;
}) {
  const [justClicked, setJustClicked] = useState(false);

  function approve() {
    if (working) return;
    // Purely the blur-swap cue - the actual disabled/label state below never
    // depends on this, so it can't get stuck if the run comes back needing
    // another round.
    setJustClicked(true);
    setTimeout(() => setJustClicked(false), 220);
    onApprove();
  }

  return (
    <div className="enter flex max-w-[620px] flex-col gap-3 rounded-[12px] border border-outline-variant bg-surface-container-high p-4 shadow-[0_1px_3px_rgba(0,0,0,0.4)]">
      <button
        type="button"
        onClick={approve}
        disabled={working}
        aria-busy={working}
        className="state-layer pressable flex min-h-[48px] w-full cursor-pointer items-center justify-between gap-3 rounded-full bg-primary px-6 font-medium text-[16px] text-on-primary transition-opacity disabled:cursor-default disabled:opacity-80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-primary"
      >
        <span className="label-swap" data-swapping={justClicked}>
          {working
            ? t("approveWorking", { count: readyCount })
            : t("approveLabel", { count: readyCount })}
        </span>
        <span className="opacity-80">→</span>
      </button>

      <div className="flex justify-between gap-3 text-[14px] text-on-surface-variant">
        <span>{t("approveSub")}</span>
        {blockedCount > 0 ? (
          <span className="whitespace-nowrap text-[13.5px] text-error">
            {t("excluded", { count: blockedCount })}
          </span>
        ) : null}
      </div>
    </div>
  );
}
