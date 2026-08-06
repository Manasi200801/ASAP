"use client";

import { ApprovalCard } from "@/components/approval-card";
import { BatchTable } from "@/components/batch-table";
import { Composer } from "@/components/composer";
import { LiveStatus } from "@/components/live-status";
import { LocaleSwitch } from "@/components/locale-switch";
import { ThemeToggle } from "@/components/theme-toggle";
import { MAX_FILES } from "@/lib/events";
import { useLocale } from "@/lib/i18n";
import type { Duplicate } from "@/lib/use-run";
import { useRun } from "@/lib/use-run";
import { useEffect, useRef, useState } from "react";

// Both top actions read as one pair, not "the important one" and "the other
// one" - same neutral rest state, same yellow accent on hover, on-header
// tokens rather than surface ones since this bar sits on the same colored
// background as the title bar (navy in dark mode, AWS blue in light mode).
const TOP_BUTTON =
  "state-layer pressable flex w-56 cursor-pointer items-center justify-center rounded-full border border-on-header/25 bg-on-header/10 px-3.5 py-2 font-medium text-[14px] text-on-header transition-colors hover:border-primary hover:text-primary disabled:opacity-50 disabled:hover:border-on-header/25 disabled:hover:text-on-header focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary";

export default function Page() {
  const { locale, setLocale, t } = useLocale();
  const { run, start, upload, ask, approve, reset, fail } = useRun();
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

  // Follow the newest content, but only while the reader is already at the
  // bottom. Yanking someone back down while they are reading an earlier answer
  // is worse than not following at all.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the run object is the signal
  useEffect(() => {
    const box = transcript.current;
    if (!box) return;
    const distance = box.scrollHeight - box.scrollTop - box.clientHeight;
    if (distance < 140) box.scrollTop = box.scrollHeight;
  }, [run]);

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
    <main className="flex min-h-screen w-full flex-col bg-surface">
      <div className="h-[3px] flex-none">
        {busy ? (
          <div className="progress-track h-full w-full">
            <div className="progress-indicator h-full w-1/3" />
          </div>
        ) : null}
      </div>

      <header className="flex flex-wrap items-center gap-5 border-outline-variant border-b bg-header px-6 py-4">
        <div className="font-semibold text-[17px] text-on-header uppercase tracking-[0.11em]">
          STRIKE <span className="text-primary">AP</span>
        </div>

        <div className="ml-auto flex items-center gap-3">
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
        className={`flex flex-wrap items-center justify-center gap-3 border-outline-variant border-b bg-header px-6 py-4 transition-colors ${
          dragging ? "bg-primary/[0.12]" : ""
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
        <button
          type="button"
          disabled={busy || run.answering}
          onClick={() => fileInput.current?.click()}
          className={TOP_BUTTON}
        >
          {uploading ? t("uploading") : t("uploadFiles")}
        </button>
        <button
          type="button"
          disabled={busy || run.answering}
          onClick={() => begin()}
          className={TOP_BUTTON}
        >
          {t("loadBatch")}
        </button>
      </div>

      <div className="flex min-h-0 flex-1">
        {started ? (
          <aside className="w-[190px] flex-none overflow-y-auto border-outline-variant border-r bg-surface-container-low px-5 py-6">
            <LiveStatus state={run.state} messages={statusMessages} t={t} />
          </aside>
        ) : null}

        <div className="flex min-h-0 flex-1 flex-col">
          {/* The transcript scrolls, the shell does not. A long conversation
              otherwise pushes the composer off the bottom of the window, so the
              input you need is the one thing you have to scroll away from. */}
          <div
            ref={transcript}
            className="flex min-h-[560px] min-w-0 flex-1 flex-col gap-5 overflow-auto overscroll-contain px-6 pt-6 pb-4"
          >
            {files.length > 0 ? (
              <div className="flex flex-col gap-2.5">
                <div className="font-semibold text-[12px] text-on-surface-faint uppercase tracking-[0.12em]">
                  {t("you")}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {files.map((name, index) => {
                    // A repeated file stays visible, labelled. Removing it would
                    // leave the person wondering which of the ten they dropped
                    // went missing.
                    const repeat = repeats.find((d) => d.name === name);
                    return (
                      <span
                        key={name}
                        style={{ animationDelay: `${index * 30}ms` }}
                        className={`chip-in rounded-[8px] border border-outline-variant bg-surface-container px-2 py-1 text-[13px] ${
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
                  <p className="max-w-[72ch] text-[15px] text-on-surface-variant">
                    {t("duplicatesSkipped", { count: repeats.length })}
                  </p>
                ) : null}
              </div>
            ) : null}

            {started ? (
              <div className="flex flex-col gap-2.5">
                {chatMessages.map((message, index) => {
                  // Label only when the speaker changes. Repeating "AGENT" above
                  // every sentence of a run turns a transcript into a stutter.
                  const speakerChanged =
                    index === 0 || chatMessages[index - 1].role !== message.role;
                  return (
                    <div
                      // Index alone. Keying on the text remounts the paragraph
                      // on every delta of a streaming answer, which restarts the
                      // enter animation once per token.
                      // biome-ignore lint/suspicious/noArrayIndexKey: messages are only appended
                      key={index}
                      className="flex flex-col gap-2.5"
                    >
                      {speakerChanged ? (
                        <div
                          className={`font-semibold text-[12px] uppercase tracking-[0.12em] ${
                            message.role === "agent" ? "text-secondary" : "text-on-surface-faint"
                          }`}
                        >
                          {t(message.role)}
                        </div>
                      ) : null}
                      <p className="enter max-w-[78ch] whitespace-pre-wrap text-[17px] text-on-surface leading-7">
                        {/* An answer that has not produced a token yet still gets
                            a bubble, so the question never looks unheard. */}
                        {message.text || (message.streaming ? "…" : "")}
                      </p>
                    </div>
                  );
                })}

                {run.invoices.length > 0 ? (
                  <BatchTable
                    invoices={run.invoices}
                    approvable={approvable}
                    parkingIds={run.parkingIds}
                    onApprove={(id) => approve([id])}
                    onAsk={(question) => ask(locale, question)}
                    asking={busy || run.answering}
                    t={t}
                  />
                ) : null}

                {(run.state === "awaiting-approval" && remainingReadyIds.length > 0) ||
                (run.state === "posting" && run.parkingIds.length > 1) ? (
                  <ApprovalCard
                    // While a batch approval is in flight, show how many are
                    // actually being parked right now, not the original count -
                    // the card must keep counting down, not freeze mid-batch.
                    readyCount={
                      run.parkingIds.length > 1 ? run.parkingIds.length : remainingReadyIds.length
                    }
                    blockedCount={run.blockedIds.length}
                    working={run.state === "posting"}
                    onApprove={() => approve(remainingReadyIds)}
                    t={t}
                  />
                ) : null}

                {run.error ? (
                  <p className="max-w-[62ch] border-error border-l-2 pl-3 text-error">
                    {run.error}
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>

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
