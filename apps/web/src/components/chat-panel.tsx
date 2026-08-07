"use client";

import type { Translate } from "@/lib/i18n";
import type { Message } from "@/lib/use-run";
import { useEffect, useRef } from "react";
import { Composer } from "./composer";
import { AgentIcon, CloseIcon } from "./icons";

function formatTime(at: number) {
  return new Date(at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

/**
 * The conversational half of the app, now a slide-over rather than a
 * permanent bottom third of the screen - the sidebar/queue layout needs the
 * vertical space back, and the agent bubble (top bar, and this floating
 * button) is what the mockup uses for the same job.
 *
 * Bubbles, not a transcript: this is a two-party conversation, so who said
 * something is carried entirely by side and colour, the way a messaging app
 * carries it - a role label repeated over every line would be saying out
 * loud what the layout already shows.
 */
export function ChatPanel({
  open,
  onToggle,
  messages,
  onSubmit,
  hasRun,
  disabled,
  t,
}: {
  open: boolean;
  onToggle: () => void;
  messages: Message[];
  onSubmit: (message?: string) => void;
  hasRun: boolean;
  disabled: boolean;
  t: Translate;
}) {
  const transcript = useRef<HTMLDivElement>(null);

  // A new message must scroll the panel even while it was already open, not only on the open
  // transition, so messages.length has to stay a dependency here.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see above
  useEffect(() => {
    if (!open) return;
    const box = transcript.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [open, messages.length]);

  return (
    <>
      {!open ? (
        // Two elements, not one: `.state-layer` sets `position: relative` as
        // plain (unlayered) CSS, which in Tailwind v4's cascade beats a
        // layered utility class regardless of source order - so a single
        // element carrying both `state-layer` and `fixed` silently loses the
        // `fixed` and gets laid out in-flow instead of pinned to the
        // viewport. The wrapper owns the viewport positioning; the button
        // owns the hover/press state layer.
        <div className="fixed right-6 bottom-6 z-30">
          <button
            type="button"
            onClick={onToggle}
            aria-label={t("openAgentChat")}
            className="state-layer pressable flex h-14 w-14 cursor-pointer items-center justify-center rounded-full bg-primary text-on-primary shadow-lg elevated-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-on-surface"
          >
            <AgentIcon className="h-6 w-6" />
          </button>
        </div>
      ) : null}

      {/* A slide-over, not a native <dialog> - it never blocks interaction with the rest of the
          app the way a modal does, so the ARIA role is applied to a div on purpose. */}
      {/* biome-ignore lint/a11y/useSemanticElements: see above */}
      <div
        role="dialog"
        aria-label={t("openAgentChat")}
        aria-hidden={!open}
        className={`fixed inset-y-0 right-0 z-30 flex w-full max-w-[420px] flex-col border-outline-variant border-l bg-surface shadow-lg transition-transform duration-300 ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
        style={{ transitionTimingFunction: "var(--ease-out)" }}
      >
        <div className="flex flex-none items-center justify-between border-outline-variant border-b px-5 py-4">
          <div className="flex items-center gap-2.5 font-semibold text-[15px] text-on-surface">
            <AgentIcon className="h-5 w-5 text-primary" />
            {t("brand")}
          </div>
          <button
            type="button"
            onClick={onToggle}
            aria-label={t("close")}
            className="state-layer pressable flex h-8 w-8 cursor-pointer items-center justify-center rounded-full text-on-surface-variant hover:text-on-surface"
          >
            <CloseIcon className="h-4 w-4" />
          </button>
        </div>

        <div
          ref={transcript}
          className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto bg-surface-dim px-4 py-4"
        >
          {messages.length === 0 ? (
            <p className="text-[14px] text-on-surface-faint">{t("askPlaceholder")}</p>
          ) : (
            messages.map((message, index) => {
              const isYou = message.role === "you";
              // A run of consecutive bubbles from the same speaker reads as one
              // turn: tight spacing and one soft corner apiece inside the run,
              // the sharper "tail" corner and the timestamp only on the last -
              // the same shape a messaging app gives a burst of texts sent in a
              // row rather than three separate conversations.
              const isFirstInRun = index === 0 || messages[index - 1].role !== message.role;
              const isLastInRun =
                index === messages.length - 1 || messages[index + 1].role !== message.role;
              const isEmptyStream = message.streaming && message.text === "";

              return (
                <div
                  // biome-ignore lint/suspicious/noArrayIndexKey: messages are only appended
                  key={index}
                  className={`flex ${isYou ? "justify-end" : "justify-start"} ${isFirstInRun ? "mt-2.5" : "mt-0.5"}`}
                >
                  <div
                    className={`${isYou ? "bubble-in-you" : "bubble-in-agent"} flex max-w-[78%] flex-col gap-1 rounded-[18px] px-3.5 py-2 ${
                      isYou
                        ? `bg-primary text-on-primary ${isLastInRun ? "rounded-br-[4px]" : ""}`
                        : `bg-surface text-on-surface ${isLastInRun ? "rounded-bl-[4px]" : ""}`
                    }`}
                  >
                    {isEmptyStream ? (
                      <span className="flex items-center gap-1 py-1" aria-label={t("agentTyping")}>
                        <span className="typing-dot h-1.5 w-1.5 rounded-full bg-current opacity-60" />
                        <span className="typing-dot h-1.5 w-1.5 rounded-full bg-current opacity-60" />
                        <span className="typing-dot h-1.5 w-1.5 rounded-full bg-current opacity-60" />
                      </span>
                    ) : (
                      <p className="max-w-full whitespace-pre-wrap text-[15px] leading-6">
                        {message.text}
                      </p>
                    )}
                    {isLastInRun && !isEmptyStream ? (
                      <span
                        className={`text-[11px] leading-none ${isYou ? "text-on-primary/70" : "text-on-surface-faint"}`}
                      >
                        {formatTime(message.at)}
                      </span>
                    ) : null}
                  </div>
                </div>
              );
            })
          )}
        </div>

        <Composer onSubmit={onSubmit} hasRun={hasRun} disabled={disabled} t={t} />
      </div>
    </>
  );
}
