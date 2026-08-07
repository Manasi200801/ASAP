"use client";

import { ApprovalCard } from "@/components/approval-card";
import { BatchTable } from "@/components/batch-table";
import { Composer } from "@/components/composer";
import { BatchIcon, CrossIcon, UploadIcon } from "@/components/icons";
import { LiveStatus } from "@/components/live-status";
import { LocaleSwitch } from "@/components/locale-switch";
import { Spinner } from "@/components/spinner";
import { ThemeToggle } from "@/components/theme-toggle";
import { MAX_FILES } from "@/lib/events";
import { useLocale } from "@/lib/i18n";
import type { Duplicate } from "@/lib/use-run";
import { useRun } from "@/lib/use-run";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

// Both top actions read as one pair, not "the important one" and "the other
// one" - same neutral rest state, same accent on hover, on-header tokens rather
// than surface ones since this bar sits on the same colored background as the
// title bar (navy in dark mode, AWS blue in light mode).
//
// Two changes to the original: hover brightens the label instead of turning it
// `primary`, because orange on the light theme's blue header is 2.8:1 and
// unreadable across a room; and the fixed w-56 became a minimum, because the
// German labels plus an icon overflow a fixed 224px.
const TOP_BUTTON =
  "state-layer pressable flex min-h-[44px] min-w-[224px] flex-1 cursor-pointer items-center justify-center gap-2.5 rounded-full border border-on-header/30 bg-on-header/10 px-5 font-medium text-[15px] text-on-header transition-colors hover:border-on-header/60 hover:bg-on-header/20 disabled:opacity-50 disabled:hover:border-on-header/30 disabled:hover:bg-on-header/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-on-header sm:flex-none";

// The three stages the sample run will actually show, in the order the rail on
// the left lights them up. The sequence is the information here, which is why
// it is an ordered list and not three cards.
const EMPTY_STEPS = [
  ["stageExtract", "emptyStep1"],
  ["stageValidate", "emptyStep2"],
  ["stageApprove", "emptyStep3"],
] as const;

export default function Page() {
  const { locale, setLocale, t } = useLocale();
  const { run, start, upload, ask, approve, decide, reset, fail } = useRun();
  const [files, setFiles] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [repeats, setRepeats] = useState<Duplicate[]>([]);
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const fileInput = useRef<HTMLInputElement>(null);
  const transcript = useRef<HTMLDivElement>(null);

  // Read the saved preference once on mount rather than at useState init, so
  // server and first client render agree and React never complains about a
  // hydration mismatch over something as harmless as a color scheme.
  useEffect(() => {
    const saved = window.localStorage.getItem("theme");
    if (saved === "light" || saved === "dark") setTheme(saved);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem("theme", theme);
  }, [theme]);

  const busy =
    uploading ||
    run.state === "extracting" ||
    run.state === "validating" ||
    run.state === "posting";
  // Messages count too: a question asked before any batch exists still gets an
  // answer, and it has to have somewhere to appear.
  const started = run.state !== "idle" || uploading || run.messages.length > 0;
  const statusMessages = run.messages.filter((m) => m.role === "agent" && m.kind === "status");
  const chatMessages = run.messages.filter((m) => !(m.role === "agent" && m.kind === "status"));

  // Only the ones nobody has parked yet - once a clerk parks a few invoices one
  // row at a time, "approve all" must offer the rest, not the original count.
  const remainingReadyIds = run.readyIds.filter(
    (id) => run.invoices.find((i) => i.invoiceId === id)?.status !== "parked",
  );
  const approvable = run.state === "awaiting-approval" || run.state === "posting";

  // Follow the conversation, and only the conversation.
  //
  // This used to key on the whole `run` object, which changes on every one of
  // the ~96 rule events a batch emits. The viewport chased a table that was
  // still growing, once per event, for the length of the run - on screen that
  // read as the page crawling downward on its own while the answer you were
  // reading slid off the top. Rule events must move nothing: the table lives in
  // its own scroll container now and has its own motion to show progress.
  //
  // A new message and the tail of a streaming one are the only two things worth
  // following, and even then only while the reader is already at the bottom -
  // yanking someone back down mid-sentence is worse than not following at all.
  const messageCount = chatMessages.length;
  const streamingTail = chatMessages.at(-1)?.text ?? "";
  // biome-ignore lint/correctness/useExhaustiveDependencies: the count and the streaming tail are the signal; widening these deps is exactly what caused the chase
  useEffect(() => {
    const box = transcript.current;
    if (!box) return;
    const distance = box.scrollHeight - box.scrollTop - box.clientHeight;
    if (distance < 140) box.scrollTop = box.scrollHeight;
  }, [messageCount, streamingTail]);

  async function begin() {
    reset();
    setFiles([]);
    setRepeats([]);
    // No documents means the demo batch, and it says so rather than relying on
    // the agent to guess from an empty key list.
    await start(locale, undefined, { sample: true });
  }

  async function onFiles(dropped: File[]) {
    if (dropped.length === 0) return;

    if (dropped.length > MAX_FILES) {
      reset();
      fail(t("tooMany", { max: MAX_FILES }));
      return;
    }

    const runId = `r_${Math.random().toString(36).slice(2, 8)}`;
    reset();
    setRepeats([]);
    // Acknowledge receipt before any work begins - the chips appear immediately,
    // separately from the upload, so a dropped file never looks ignored.
    setFiles(dropped.map((f) => f.name));
    setUploading(true);

    try {
      // The documents have to reach S3 before the agent can read them. Skipping
      // this is why an earlier version appeared to accept uploads and then
      // checked the demo batch instead.
      const { keys, duplicates } = await upload(runId, dropped);
      setUploading(false);
      setRepeats(duplicates);

      if (keys.length === 0) {
        fail(t("allDuplicates"));
        return;
      }

      await start(locale, undefined, { keys, runId });
    } catch (error) {
      setUploading(false);
      fail(error instanceof Error ? error.message : t("uploadFailed"));
    }
  }

  return (
    // A fixed-height shell, not a growing page. Each region below owns its own
    // scrolling, which is the only way the composer and the approval gate can be
    // guaranteed on screen without the clerk hunting for them.
    <main className="flex h-screen w-full flex-col overflow-hidden bg-surface">
      <div className="h-[3px] flex-none">
        {busy ? (
          <div className="progress-track h-full w-full">
            <div className="progress-indicator h-full w-1/3" />
          </div>
        ) : null}
      </div>

      <header className="flex flex-none flex-wrap items-center gap-5 border-outline-variant border-b bg-header px-8 py-4">
        <div className="font-semibold text-[21px] text-on-header uppercase tracking-[0.12em]">
          STRIKE <span className="text-primary">AP</span>
        </div>

        <div className="ml-auto flex items-center gap-3">
          <Link
            href="/sops"
            className="state-layer pressable flex min-h-[44px] cursor-pointer items-center rounded-full border border-on-header/30 bg-on-header/10 px-4 font-medium text-[15px] text-on-header transition-colors hover:border-on-header/60 hover:bg-on-header/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-on-header"
          >
            SOPs
          </Link>
          <LocaleSwitch locale={locale} onChange={setLocale} />
          <ThemeToggle
            theme={theme}
            onToggle={() => setTheme((p) => (p === "dark" ? "light" : "dark"))}
            t={t}
          />
        </div>
      </header>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          onFiles(Array.from(e.dataTransfer.files));
        }}
        className={`flex flex-none flex-wrap items-center gap-x-6 gap-y-3 border-outline-variant border-b bg-header px-8 py-4 transition-colors ${
          dragging ? "bg-primary/[0.12] ring-2 ring-primary ring-inset" : ""
        }`}
      >
        <input
          ref={fileInput}
          type="file"
          multiple
          // A photographed invoice is as ordinary as a PDF one, and Converse
          // reads both.
          accept="application/pdf,image/png,image/jpeg,image/gif,image/webp"
          className="hidden"
          onChange={(e) => {
            onFiles(Array.from(e.target.files ?? []));
            e.target.value = "";
          }}
        />
        {/* The bar was two unlabelled pills. It is a drop target and nothing on
            it said so - this is the sentence that makes the whole bar legible. */}
        <p className="max-w-[46ch] text-[15px] text-on-header/85 leading-6">{t("dropHint")}</p>

        <div className="ml-auto flex flex-1 flex-wrap items-center gap-3 sm:flex-none">
          <button
            type="button"
            disabled={busy || run.answering}
            onClick={() => fileInput.current?.click()}
            className={TOP_BUTTON}
          >
            {uploading ? <Spinner className="h-4 w-4" /> : <UploadIcon className="h-4 w-4" />}
            {uploading ? t("uploading") : t("uploadFiles")}
          </button>
          <button
            type="button"
            disabled={busy || run.answering}
            onClick={() => begin()}
            className={TOP_BUTTON}
          >
            <BatchIcon className="h-4 w-4" />
            {t("loadBatch")}
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        {started ? (
          <aside className="w-[236px] flex-none overflow-y-auto border-outline-variant border-r bg-surface-container-low px-6 py-7">
            <LiveStatus state={run.state} messages={statusMessages} t={t} />
          </aside>
        ) : null}

        <div className="flex min-h-0 flex-1 flex-col">
          {/* The work pane: the batch, and nothing that streams.
              It scrolls on its own and is never scrolled by anything else, so a
              table that grows to twenty rows stays exactly where the clerk left
              it instead of shoving the conversation off the screen. */}
          {/* The floor matters: without it this pane is the only thing that can
              shrink, so a long answer plus the gate squeezed the batch down to
              its header row on a laptop. Below this height the conversation
              yields instead. */}
          <div className="min-h-[220px] min-w-0 flex-1 overflow-auto overscroll-contain px-8 py-6">
            {files.length > 0 ? (
              <div className="mb-5 flex flex-col gap-2.5">
                <div className="font-semibold text-[13px] text-on-surface-faint uppercase tracking-[0.12em]">
                  {t("you")}
                </div>
                <div className="flex flex-wrap gap-2">
                  {files.map((name, index) => {
                    // A repeated file stays visible, labelled. Removing it would
                    // leave the person wondering which of the ten they dropped
                    // went missing.
                    const repeat = repeats.find((d) => d.name === name);
                    return (
                      <span
                        key={name}
                        style={{ animationDelay: `${index * 30}ms` }}
                        className={`chip-in rounded-[8px] border border-outline-variant bg-surface-container px-2.5 py-1.5 text-[15px] ${
                          repeat ? "text-on-surface-faint line-through" : "text-on-surface-variant"
                        }`}
                        title={repeat ? t("duplicateOf", { of: repeat.of }) : undefined}
                      >
                        {name}
                      </span>
                    );
                  })}
                </div>
                {repeats.length > 0 ? (
                  <p className="max-w-[70ch] text-[16px] text-on-surface-variant">
                    {t("duplicatesSkipped", { count: repeats.length })}
                  </p>
                ) : null}
              </div>
            ) : null}

            {started ? (
              run.invoices.length > 0 ? (
                <BatchTable
                  invoices={run.invoices}
                  approvable={approvable}
                  parkingIds={run.parkingIds}
                  onApprove={(id) => approve([id])}
                  onAsk={(question) => ask(locale, question)}
                  // Decisions are only offered while the gate is open. After
                  // Approve there is nothing left to decide, and a live-looking
                  // button that no longer does anything is worse than none.
                  onDecide={run.state === "awaiting-approval" ? decide : undefined}
                  asking={busy || run.answering}
                  t={t}
                />
              ) : null
            ) : (
              /* Cold open. A judge arriving at this screen was previously shown
                 two unexplained pills and an empty page; this says what the
                 product does, what to do next, and what the sample run will
                 actually show them. */
              /* min-h-full + justify-center rather than fixed padding: on a
                 projector the block sits centred in the pane, and on a laptop
                 the pane simply scrolls instead of hiding the three lines that
                 say what the sample run will do. */
              <div className="enter mx-auto flex min-h-full w-full max-w-[900px] flex-col justify-center gap-5 py-6">
                <h1 className="max-w-[36ch] text-balance font-semibold text-[clamp(25px,2.4vw,36px)] text-on-surface leading-[1.18] tracking-[-0.02em]">
                  {t("emptyTitle")}
                </h1>
                <p className="max-w-[64ch] text-[18px] text-on-surface-variant leading-7">
                  {t("emptyBody")}
                </p>
                <ol className="flex max-w-[76ch] flex-col border-outline-variant border-t">
                  {EMPTY_STEPS.map(([stage, body]) => (
                    <li
                      key={stage}
                      className="flex flex-col gap-1 border-outline-variant border-b py-3.5 sm:flex-row sm:gap-6"
                    >
                      <span className="w-[9rem] flex-none pt-0.5 font-semibold text-[14px] text-primary uppercase tracking-[0.1em]">
                        {t(stage)}
                      </span>
                      <span className="max-w-[60ch] text-[17px] text-on-surface leading-7">
                        {t(body)}
                      </span>
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </div>

          {/* Everything below this line is pinned above the composer. A run that
              needs a decision, an error that needs reading, and the answer to
              the question just asked are the three things that must never be
              somewhere off-screen. */}
          {run.error ? (
            <div
              role="alert"
              className="enter flex flex-none items-start gap-3 border-error/40 border-t bg-error/[0.08] px-8 py-4"
            >
              <CrossIcon className="mt-1 h-5 w-5 flex-none text-error" />
              <p className="max-w-[70ch] text-[17px] text-on-surface leading-7">{run.error}</p>
            </div>
          ) : null}

          {(run.state === "awaiting-approval" && remainingReadyIds.length > 0) ||
          (run.state === "posting" && run.parkingIds.length > 1) ? (
            <div className="flex flex-none justify-center border-outline-variant border-t bg-surface-container-low px-8 py-4">
              <ApprovalCard
                // While a batch approval is in flight, show how many are
                // actually being parked right now, not the original count -
                // the card must keep counting down, not freeze mid-batch.
                readyCount={
                  run.parkingIds.length > 1 ? run.parkingIds.length : remainingReadyIds.length
                }
                overrideCount={run.invoices.filter((i) => i.decision === "override").length}
                rejectCount={run.invoices.filter((i) => i.decision === "reject").length}
                blockedCount={run.blockedIds.length}
                working={run.state === "posting"}
                onApprove={() => approve(remainingReadyIds)}
                t={t}
              />
            </div>
          ) : null}

          {/* The conversation, directly above the box you typed into. Bounded
              rather than flexible: it takes a third of the viewport at most, so
              a long answer scrolls inside itself instead of squeezing the batch
              out of the pane above.

              Shrinkable, not `flex-none`. On a laptop the two panes together ask
              for more height than there is, and something has to give: the batch
              has a 220px floor and this does not, so the conversation yields and
              scrolls inside itself rather than crushing the table to its header
              row. `min-h-0` is what actually permits that - a flex child refuses
              to shrink below its content without it. */}
          {chatMessages.length > 0 ? (
            <div
              ref={transcript}
              className="flex max-h-[min(34vh,320px)] min-h-0 shrink flex-col gap-3 overflow-auto overscroll-contain border-outline-variant border-t px-8 py-4"
            >
              {chatMessages.map((message, index) => {
                // Label only when the speaker changes. Repeating "AGENT" above
                // every sentence of a run turns a transcript into a stutter.
                const speakerChanged = index === 0 || chatMessages[index - 1].role !== message.role;
                return (
                  <div
                    // Index alone. Keying on the text remounts the paragraph
                    // on every delta of a streaming answer, which restarts the
                    // enter animation once per token.
                    // biome-ignore lint/suspicious/noArrayIndexKey: messages are only appended
                    key={index}
                    className="flex flex-col gap-1.5"
                  >
                    {speakerChanged ? (
                      <div
                        className={`font-semibold text-[13px] uppercase tracking-[0.12em] ${
                          message.role === "agent" ? "text-secondary" : "text-on-surface-faint"
                        }`}
                      >
                        {t(message.role)}
                      </div>
                    ) : null}
                    <p className="enter max-w-[72ch] whitespace-pre-wrap text-[18px] text-on-surface leading-8">
                      {/* An answer that has not produced a token yet still gets
                          a bubble, so the question never looks unheard. */}
                      {message.text || (message.streaming ? "…" : "")}
                    </p>
                  </div>
                );
              })}
            </div>
          ) : null}

          <Composer
            // A message is always a question, a submit with no message is always
            // a batch. Nothing typed or clicked in the chat can start a run:
            // asking "why was FPL-9999 blocked?" used to load and re-check six
            // invoices before answering, which is the opposite of what was asked.
            onSubmit={(message) => (message ? ask(locale, message) : begin())}
            hasRun={Boolean(run.runId)}
            disabled={busy || run.answering}
            t={t}
          />
        </div>
      </div>
    </main>
  );
}
