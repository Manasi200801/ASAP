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
 * the one decision the run stops for can never be scrolled past. Everything
 * about it is a size larger and slower than the rest of the page - a 56px
 * target, an entrance that travels further over 440ms, one halo beat and then
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
  overrideCount,
  rejectCount,
  blockedCount,
  working,
  onApprove,
  t,
}: {
  readyCount: number;
  overrideCount: number;
  rejectCount: number;
  blockedCount: number;
  working: boolean;
  onApprove: () => void;
  t: Translate;
}) {
  const [justClicked, setJustClicked] = useState(false);

  // Overridden invoices post exactly like clean ones, so the count on the button
  // has to include them. A clerk who overrides two and reads "post 5" then
  // watches seven documents park has been told the wrong thing at the one moment
  // the interface exists to be trusted.
  const posting = readyCount + overrideCount;
  const stillOpen = blockedCount - overrideCount - rejectCount;

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
    <div className="gate-in elevated-2 flex w-full max-w-[720px] flex-col gap-4 rounded-[14px] border border-primary/35 bg-surface-container-high p-5">
      <button
        type="button"
        onClick={approve}
        disabled={working}
        aria-busy={working}
        className={`state-layer pressable flex min-h-[56px] w-full cursor-pointer items-center justify-between gap-4 rounded-full bg-primary px-7 font-semibold text-[19px] text-on-primary transition-opacity disabled:cursor-default disabled:opacity-80 focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-[3px] focus-visible:outline-on-surface ${
          working ? "" : "gate-halo"
        }`}
      >
        <span className="label-swap text-left" data-swapping={justClicked}>
          {working
            ? t("approveWorking", { count: posting })
            : t("approveLabel", { count: posting })}
        </span>
        <ArrowIcon className="h-5 w-5 flex-none opacity-90" />
      </button>

      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <p className="flex items-center gap-2.5 text-[16px] text-on-surface-variant">
          <ShieldIcon className="h-5 w-5 flex-none text-success" />
          {t("approveSub")}
        </p>
        <span className="flex flex-wrap items-center justify-end gap-2">
          {overrideCount > 0 ? (
            <span className="inline-flex items-center whitespace-nowrap rounded-full border border-success/45 bg-success-container px-3 py-1 font-semibold text-[14px] text-on-success-container uppercase tracking-[0.05em]">
              {t("overriding", { count: overrideCount })}
            </span>
          ) : null}
          {rejectCount > 0 ? (
            <span className="inline-flex items-center whitespace-nowrap rounded-full border border-error/45 bg-error-container px-3 py-1 font-semibold text-[14px] text-on-error-container uppercase tracking-[0.05em]">
              {t("rejecting", { count: rejectCount })}
            </span>
          ) : null}
          {stillOpen > 0 ? (
            <span className="inline-flex items-center whitespace-nowrap rounded-full border border-error/45 bg-error-container px-3 py-1 font-semibold text-[14px] text-on-error-container uppercase tracking-[0.05em]">
              {t("excluded", { count: stillOpen })}
            </span>
          ) : null}
        </span>
      </div>
    </div>
  );
}
