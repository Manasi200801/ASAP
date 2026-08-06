"use client";

import type { Translate } from "@/lib/i18n";
import { useState } from "react";

/**
 * The single human approval gate.
 *
 * The label carries the whole consequence rather than floating a count above it,
 * and the excluded invoice is named rather than silently dropped. Both exist
 * because a clerk hesitates when they are not certain what they are agreeing to.
 */
export function ApprovalCard({
  readyCount,
  blockedCount,
  onApprove,
  t,
}: {
  readyCount: number;
  blockedCount: number;
  onApprove: () => void;
  t: Translate;
}) {
  const [state, setState] = useState<"idle" | "swapping" | "working">("idle");

  function approve() {
    if (state !== "idle") return;
    setState("swapping");
    // Blur the label out, swap it, blur back in. Width is held by the flex row.
    setTimeout(() => setState("working"), 200);
    onApprove();
  }

  return (
    <div className="enter flex max-w-[520px] flex-col gap-2.5 rounded-lg border border-brass-deep bg-gradient-to-b from-surface-2 to-surface-1 p-3.5">
      <button
        type="button"
        onClick={approve}
        disabled={state !== "idle"}
        className="pressable flex min-h-[42px] w-full cursor-pointer items-center justify-between gap-3 rounded-md bg-brass px-4 font-semibold text-[#17130a] text-sm transition-[filter] hover:brightness-107 disabled:cursor-default focus-visible:outline focus-visible:outline-2 focus-visible:outline-brass focus-visible:outline-offset-[3px]"
      >
        <span className="label-swap" data-swapping={state === "swapping"}>
          {state === "idle"
            ? t("approveLabel", { count: readyCount })
            : t("approveWorking", { count: readyCount })}
        </span>
        <span className="font-data opacity-65">→</span>
      </button>

      <div className="flex justify-between gap-3 text-[12.5px] text-ink-dim">
        <span>{t("approveSub")}</span>
        {blockedCount > 0 ? (
          <span className="whitespace-nowrap font-data text-[11px] text-blocked">
            {t("excluded", { count: blockedCount })}
          </span>
        ) : null}
      </div>
    </div>
  );
}
