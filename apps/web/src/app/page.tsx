"use client";

import { ApprovalCard } from "@/components/approval-card";
import { BatchTable } from "@/components/batch-table";
import { Composer } from "@/components/composer";
import { LiveStatus } from "@/components/live-status";
import { LocaleSwitch } from "@/components/locale-switch";
import { ThemeToggle } from "@/components/theme-toggle";
import { useLocale } from "@/lib/i18n";
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
  const { run, start, ask, approve, reset } = useRun();
  const [files, setFiles] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const fileInput = useRef<HTMLInputElement>(null);

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

  const busy = run.state === "extracting" || run.state === "validating" || run.state === "posting";
  const started = run.state !== "idle";
  const statusMessages = run.messages.filter((m) => m.role === "agent" && m.kind === "status");
  const chatMessages = run.messages.filter((m) => !(m.role === "agent" && m.kind === "status"));

  // Only the ones nobody has parked yet - once a clerk parks a few invoices one
  // row at a time, "approve all" must offer the rest, not the original count.
  const remainingReadyIds = run.readyIds.filter(
    (id) => run.invoices.find((i) => i.invoiceId === id)?.status !== "parked",
  );
  const approvable = run.state === "awaiting-approval" || run.state === "posting";

  async function begin(message?: string, names: string[] = []) {
    reset();
    setFiles(names);
    await start(locale, message);
  }

  async function onFiles(dropped: File[]) {
    if (dropped.length === 0) return;
    // Acknowledge receipt before any work begins - the chips appear immediately,
    // separately from extraction, so the upload never looks like it was ignored.
    await begin(
      undefined,
      dropped.map((f) => f.name),
    );
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
          accept="application/pdf"
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
          {t("uploadFiles")}
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
          <div className="flex min-h-[560px] min-w-0 flex-1 flex-col gap-5 overflow-auto px-6 pt-6 pb-4">
            {files.length > 0 ? (
              <div className="flex flex-col gap-2.5">
                <div className="font-semibold text-[12px] text-on-surface-faint uppercase tracking-[0.12em]">
                  {t("you")}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {files.map((name, index) => (
                    <span
                      key={name}
                      style={{ animationDelay: `${index * 30}ms` }}
                      className="chip-in rounded-[8px] border border-outline-variant bg-surface-container px-2 py-1 text-[13px] text-on-surface-variant"
                    >
                      {name}
                    </span>
                  ))}
                </div>
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
                      key={`${index}-${message.role}-${message.text.slice(0, 12)}`}
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
                      <p className="enter max-w-[78ch] text-[17px] text-on-surface leading-7">
                        {message.text}
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
            // Once a batch exists, typing asks about it. Only the first message
            // starts a run - otherwise a question wipes the table it is asking
            // about and re-checks every invoice against SAP to answer nothing.
            // An empty submit still means "run this batch", even after a run exists.
            onSubmit={(message) => (run.runId && message ? ask(locale, message) : begin(message))}
            disabled={busy || run.answering}
            t={t}
          />
        </div>
      </div>
    </main>
  );
}
