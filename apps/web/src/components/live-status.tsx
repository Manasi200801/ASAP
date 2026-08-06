"use client";

import type { RunState } from "@/lib/events";
import type { Translate } from "@/lib/i18n";
import type { Message } from "@/lib/use-run";

const STATE_STAGE: Record<RunState, number> = {
  idle: -1,
  uploading: 0,
  extracting: 1,
  validating: 2,
  "awaiting-approval": 3,
  posting: 4,
  done: 5,
  failed: -1,
};

/**
 * A small supply-chain rail, not a transcript.
 *
 * Files received -> extracted -> validated -> approved -> posted is a literal
 * pipeline; showing it as one, with the current stage lit and the rest dimmed,
 * reads at a glance. The narration text still exists (it names the invoice
 * count, the blocked one, the reference) but only as a caption under whichever
 * stage is running - it never grows into a scrollback the clerk has to read.
 */
export function LiveStatus({
  state,
  messages,
  t,
}: {
  state: RunState;
  messages: Message[];
  t: Translate;
}) {
  const activeIndex = STATE_STAGE[state];
  const lastMessage = messages.at(-1)?.text;

  const stages = [
    { key: "received", label: t("stageReceived") },
    { key: "extract", label: t("stageExtract") },
    { key: "validate", label: t("stageValidate") },
    { key: "approve", label: t("stageApprove") },
    { key: "post", label: t("stagePost") },
  ];

  return (
    <div className="flex flex-col gap-2.5">
      <div className="font-semibold text-[12px] text-on-surface-faint uppercase tracking-[0.12em]">
        {t("liveStatus")}
      </div>

      <div className="flex flex-col">
        {stages.map((stage, index) => {
          const isDone = index < activeIndex;
          const isActive = index === activeIndex;

          return (
            <div key={stage.key} className="relative flex gap-3 pb-6 last:pb-0">
              {index < stages.length - 1 ? (
                <span
                  aria-hidden="true"
                  className={`absolute top-[18px] left-[8px] h-[calc(100%-10px)] w-px transition-colors duration-300 ${
                    isDone ? "bg-success" : "bg-outline-variant"
                  }`}
                />
              ) : null}

              <span
                className={`relative z-10 mt-0.5 flex h-[17px] w-[17px] flex-none items-center justify-center rounded-full border-2 transition-colors duration-300 ${
                  isDone
                    ? "border-success bg-success text-on-success"
                    : isActive
                      ? "border-primary bg-surface"
                      : "border-outline-variant bg-surface"
                }`}
              >
                {isDone ? <span className="text-[9px]">✓</span> : null}
                {isActive ? (
                  <span className="h-[7px] w-[7px] animate-pulse rounded-full bg-primary" />
                ) : null}
              </span>

              <div>
                <div
                  className={`text-[13px] leading-[18px] ${
                    isActive
                      ? "font-medium text-on-surface"
                      : isDone
                        ? "text-on-surface"
                        : "text-on-surface-faint"
                  }`}
                >
                  {stage.label}
                </div>
                {isActive && lastMessage ? (
                  <p className="mt-1 max-w-[160px] text-[12px] text-on-surface-faint leading-4">
                    {lastMessage}
                  </p>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
