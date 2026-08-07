"use client";

import type { RunState } from "@/lib/events";
import type { Translate } from "@/lib/i18n";
import type { Message } from "@/lib/use-run";
import { CheckIcon } from "./icons";

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
    <div className="flex flex-col gap-4">
      <div className="font-semibold text-[13px] text-on-surface-variant uppercase tracking-[0.12em]">
        {t("liveStatus")}
      </div>

      {/* An ordered list, because the order is the information: this is a
          pipeline, and which stage the run has reached is the whole point. */}
      <ol className="flex flex-col">
        {stages.map((stage, index) => {
          const isDone = index < activeIndex;
          const isActive = index === activeIndex;

          return (
            <li
              key={stage.key}
              aria-current={isActive ? "step" : undefined}
              className="relative flex gap-3.5 pb-7 last:pb-0"
            >
              {index < stages.length - 1 ? (
                <span
                  aria-hidden="true"
                  className={`absolute top-[22px] left-[9px] h-[calc(100%-14px)] w-0.5 rounded-full transition-colors duration-300 ${
                    isDone ? "bg-success" : "bg-outline-variant"
                  }`}
                />
              ) : null}

              <span
                aria-hidden="true"
                className={`relative z-10 mt-0.5 flex h-5 w-5 flex-none items-center justify-center rounded-full border-2 transition-colors duration-300 ${
                  isDone
                    ? "border-success bg-success text-on-success"
                    : isActive
                      ? "border-primary bg-surface"
                      : "border-outline-variant bg-surface"
                }`}
              >
                {isDone ? <CheckIcon className="h-3 w-3" /> : null}
                {isActive ? (
                  <span className="h-2 w-2 animate-pulse rounded-full bg-primary motion-reduce:animate-none" />
                ) : null}
              </span>

              <div className="min-w-0">
                <div
                  className={`text-[16px] leading-[22px] ${
                    isActive
                      ? "font-semibold text-on-surface"
                      : isDone
                        ? "font-medium text-on-surface"
                        : "text-on-surface-faint"
                  }`}
                >
                  {stage.label}
                </div>
                {isActive && lastMessage ? (
                  <p
                    aria-live="polite"
                    className="mt-1.5 text-[14px] text-on-surface-variant leading-5"
                  >
                    {lastMessage}
                  </p>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
