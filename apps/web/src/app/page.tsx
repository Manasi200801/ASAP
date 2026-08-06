"use client";

import { ApprovalCard } from "@/components/approval-card";
import { BatchTable } from "@/components/batch-table";
import { CallRail } from "@/components/call-rail";
import { Composer } from "@/components/composer";
import { MAX_FILES } from "@/lib/events";
import { useLocale } from "@/lib/i18n";
import type { Duplicate } from "@/lib/use-run";
import { useRun } from "@/lib/use-run";
import { useEffect, useState } from "react";

export default function Page() {
  const { locale, setLocale, t } = useLocale();
  const { run, start, upload, ask, approve, reset, fail } = useRun();
  const [files, setFiles] = useState<string[]>([]);
  const [slow, setSlow] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [repeats, setRepeats] = useState<Duplicate[]>([]);
  // A question typed before any batch exists. Held until there is something
  // to answer it from.
  const [pending, setPending] = useState<string | null>(null);

  const busy =
    uploading ||
    run.state === "extracting" ||
    run.state === "validating" ||
    run.state === "posting";
  const started = run.state !== "idle" || uploading;

  // Counted from the rows as they settle, not from the closing `summary` event.
  // Reading the summary alone leaves the header on 0/0/0 for the whole run, which
  // contradicts a table the user can already see resolving in front of them.
  const ready = run.invoices.filter((i) => i.status === "ready" || i.status === "parked").length;
  const blocked = run.invoices.filter((i) => i.status === "blocked").length;
  const checks = run.invoices.reduce(
    (total, i) => total + i.rules.filter((r) => r.status !== "skip").length,
    0,
  );

  function toggleSlow() {
    const next = !slow;
    setSlow(next);
    // Multiplies every CSS duration at once, so the cascade can be reviewed frame
    // by frame. Reviewing motion in slow motion catches what full speed hides.
    document.documentElement.style.setProperty("--m", next ? "4" : "1");
  }

  async function begin(message?: string) {
    reset();
    setFiles([]);
    setRepeats([]);
    // Asking before a batch exists used to load the batch and throw the
    // question away. Keep it, and put it once the run has something to answer
    // from - the question is why they clicked in the first place.
    setPending(message ?? null);
    // No documents means the demo batch, and it says so rather than relying on
    // the agent to guess from an empty key list.
    await start(locale, undefined, { sample: true });
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: `ask` is stable per run
  useEffect(() => {
    if (!pending || run.state !== "awaiting-approval" || run.answering) return;
    const question = pending;
    setPending(null);
    void ask(locale, question);
  }, [pending, run.state, run.answering, locale]);

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
      const { keys, duplicates } = await upload(runId, dropped);
      setUploading(false);
      setRepeats(duplicates);

      if (keys.length === 0) {
        // Every file was one we have already read. Nothing to check, and saying
        // so is more useful than an empty run that appears to have done work.
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
    <main className="mx-auto max-w-[1080px] px-5 pb-24">
      <section className="mt-10 overflow-hidden rounded-lg border border-line bg-surface-1">
        <header className="flex flex-wrap items-center gap-4 border-line border-b bg-surface-2 px-4 py-3">
          <div className="font-data text-[12px] uppercase tracking-[0.12em]">
            STRIKE <span className="text-brass">AP</span>
          </div>

          <div
            className={`ml-auto flex gap-3.5 font-data text-[11.5px] text-ink-dim tabular-nums transition-opacity ${
              started ? "opacity-100" : "opacity-0"
            }`}
          >
            <span>
              <b className="font-medium text-ok">{ready}</b> {t("ready")}
            </span>
            <span>
              <b className={blocked ? "font-medium text-blocked" : "font-medium text-ink"}>
                {blocked}
              </b>{" "}
              {t("blocked")}
            </span>
            <span>
              <b className="font-medium text-ink">{checks}</b> {t("checks")}
            </span>
            <span className="text-ink-faint">{t("period")}</span>
          </div>

          <div className="flex gap-1.5">
            {(["en", "de"] as const).map((code) => (
              <Ctrl
                key={code}
                pressed={locale === code}
                onClick={() => setLocale(code)}
                label={code.toUpperCase()}
              />
            ))}
            <Ctrl pressed={slow} onClick={toggleSlow} label="0.25×" />
          </div>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_270px]">
          <div className="flex min-h-[460px] min-w-0 flex-col gap-4 px-4 pt-5 pb-2">
            {files.length > 0 ? (
              <div className="flex flex-col gap-2.5">
                <div className="font-data text-[10.5px] text-ink-faint uppercase tracking-[0.14em]">
                  {t("you")}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {files.map((name, index) => {
                    // A repeated file stays visible, labelled. Removing it from
                    // the list would leave the person wondering which of the ten
                    // they dropped went missing.
                    const repeat = repeats.find((d) => d.name === name);
                    return (
                      <span
                        key={name}
                        style={{ animationDelay: `${index * 30}ms` }}
                        className={`chip-in rounded border px-1.5 py-0.5 font-data text-[11px] ${
                          repeat
                            ? "border-line bg-surface-2 text-ink-faint line-through"
                            : "border-line bg-surface-2 text-ink-dim"
                        }`}
                        title={repeat ? t("duplicateOf", { of: repeat.of }) : undefined}
                      >
                        {name}
                      </span>
                    );
                  })}
                </div>
                {repeats.length > 0 ? (
                  <p className="max-w-[62ch] text-[13px] text-ink-faint">
                    {t("duplicatesSkipped", { count: repeats.length })}
                  </p>
                ) : null}
              </div>
            ) : null}

            {started ? (
              <div className="flex flex-col gap-2.5">
                {run.messages.map((message, index) => {
                  // Label only when the speaker changes. Repeating "AGENT" above
                  // every sentence of a run turns a transcript into a stutter.
                  const speakerChanged =
                    index === 0 || run.messages[index - 1].role !== message.role;
                  return (
                    <div
                      key={`${index}-${message.role}-${message.text.slice(0, 12)}`}
                      className="flex flex-col gap-2.5"
                    >
                      {speakerChanged ? (
                        <div
                          className={`font-data text-[10.5px] uppercase tracking-[0.14em] ${
                            message.role === "agent" ? "text-brass" : "text-ink-faint"
                          }`}
                        >
                          {t(message.role)}
                        </div>
                      ) : null}
                      <p className="enter max-w-[66ch]">{message.text}</p>
                    </div>
                  );
                })}

                {run.invoices.length > 0 ? (
                  <BatchTable
                    invoices={run.invoices}
                    onAsk={(question) => ask(locale, question)}
                    disabled={busy || run.answering}
                    t={t}
                  />
                ) : null}

                {run.state === "awaiting-approval" ? (
                  <ApprovalCard
                    readyCount={run.readyIds.length}
                    blockedCount={run.blockedIds.length}
                    onApprove={approve}
                    t={t}
                  />
                ) : null}

                {run.error ? (
                  <p className="max-w-[62ch] border-blocked border-l-2 pl-3 text-blocked">
                    {run.error}
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>

          <CallRail calls={run.calls} live={busy} t={t} />
        </div>

        <Composer
          // Once a batch exists, typing asks about it. Only the first message
          // starts a run - otherwise a question wipes the table it is asking
          // about and re-checks every invoice against SAP to answer nothing.
          // An empty submit still means "run this batch", even after a run exists.
          onSubmit={(message) => (run.runId && message ? ask(locale, message) : begin(message))}
          onFiles={onFiles}
          disabled={busy || run.answering}
          uploading={uploading}
          t={t}
        />
      </section>
    </main>
  );
}

function Ctrl({
  label,
  pressed,
  onClick,
}: {
  label: string;
  pressed: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={`pressable cursor-pointer rounded border px-2.5 py-1 font-data text-[11px] tracking-[0.06em] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-brass ${
        pressed
          ? "border-brass-deep bg-brass/[0.08] text-brass"
          : "border-line-strong text-ink-dim hover:border-ink-faint hover:text-ink"
      }`}
    >
      {label}
    </button>
  );
}
