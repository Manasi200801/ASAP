"use client";

import type { Translate } from "@/lib/i18n";
import { useState } from "react";
import { ArrowIcon, ShieldIcon } from "./icons";

/**
 * The single human approval gate.
 *
 * The label carries the whole consequence rather than floating a count above it,
 * and the excluded invoice is named rather than silently dropped. Both exist
 * because a clerk hesitates when they are not certain what they are agreeing to.
 *
 * It is pinned above the composer rather than parked in the scrolling column, so
 * the one decision the run stops for can never be scrolled past. It was a
 * centred, elevated card there, which read as a dialog floating over the batch
 * and cost the table ~100px of height - at 1440x800 the blocked invoice, the
 * one row the decision is actually about, fell outside the visible area. It is
 * a full-width bar now: same content, laid out along the pane instead of down
 * it, so nothing it says is bought with rows the clerk needs to read.
 *
 * It keeps the entrance that travels further over 440ms and one halo beat, then
 * stillness. The safety line is not fine print: it sits at reading size next to
 * a drawn mark, because "nothing is paid" is the sentence that lets someone
 * press this.
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
    <div className="gate-in flex w-full flex-wrap items-center gap-x-5 gap-y-3">
      <p className="flex items-center gap-2.5 text-[16px] text-on-surface-variant">
        <ShieldIcon className="h-5 w-5 flex-none text-success" />
        {t("approveSub")}
      </p>
      {blockedCount > 0 ? (
        <span className="inline-flex items-center whitespace-nowrap rounded-full border border-error/45 bg-error-container px-3 py-1 font-semibold text-[14px] text-on-error-container uppercase tracking-[0.05em]">
          {t("excluded", { count: blockedCount })}
        </span>
      ) : null}

      <button
        type="button"
        onClick={approve}
        disabled={working}
        aria-busy={working}
        className={`state-layer pressable ml-auto flex min-h-[44px] cursor-pointer items-center justify-between gap-3 rounded-full bg-primary px-6 font-semibold text-[17px] text-on-primary transition-opacity disabled:cursor-default disabled:opacity-80 focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-[3px] focus-visible:outline-on-surface ${
          working ? "" : "gate-halo"
        }`}
      >
        <span className="label-swap text-left" data-swapping={justClicked}>
          {working
            ? t("approveWorking", { count: readyCount })
            : t("approveLabel", { count: readyCount })}
        </span>
        <ArrowIcon className="h-5 w-5 flex-none opacity-90" />
      </button>
    </div>
  );
}
