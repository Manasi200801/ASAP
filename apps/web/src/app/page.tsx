"use client";

import { ApprovalCard } from "@/components/approval-card";
import { BatchTable } from "@/components/batch-table";
import { CallRail } from "@/components/call-rail";
import { Composer } from "@/components/composer";
import { useLocale } from "@/lib/i18n";
import { useRun } from "@/lib/use-run";
import Link from "next/link";
import { useState } from "react";

export default function Page() {
  const { locale, setLocale, t } = useLocale();
  const { run, start, ask, approve, decide, reset } = useRun();
  const [files, setFiles] = useState<string[]>([]);
  const [slow, setSlow] = useState(false);

  const busy =
    run.state === "uploading" ||
    run.state === "extracting" ||
    run.state === "validating" ||
    run.state === "posting";
  const started = run.state !== "idle";

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

  async function begin(message?: string, dropped: File[] = []) {
    reset();
    setFiles(dropped.map((f) => f.name));
    await start(locale, message, dropped);
  }

  async function onFiles(dropped: File[]) {
    if (dropped.length === 0) return;
    // Acknowledge receipt before any work begins - the chips appear immediately,
    // separately from the upload, so the drop never looks like it was ignored.
    await begin(undefined, dropped);
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

          <Link
            href="/sops"
            className="font-data text-[11px] text-ink-dim tracking-[0.06em] hover:text-ink"
          >
            SOPs
          </Link>

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
                  {files.map((name, index) => (
                    <span
                      key={name}
                      style={{ animationDelay: `${index * 30}ms` }}
                      className="chip-in rounded border border-line bg-surface-2 px-1.5 py-0.5 font-data text-[11px] text-ink-dim"
                    >
                      {name}
                    </span>
                  ))}
                </div>
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
                    // Decisions are only offered while the gate is open. After
                    // Approve there is nothing left to decide, and a live-looking
                    // button that no longer does anything is worse than none.
                    onDecide={run.state === "awaiting-approval" ? decide : undefined}
                    t={t}
                  />
                ) : null}

                {run.state === "awaiting-approval" ? (
                  <ApprovalCard
                    readyCount={run.readyIds.length}
                    overrideCount={run.invoices.filter((i) => i.decision === "override").length}
                    rejectCount={run.invoices.filter((i) => i.decision === "reject").length}
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
          onSubmit={(message) =>
            run.runId && message ? ask(locale, message) : begin(message)
          }
          onFiles={onFiles}
          disabled={busy || run.answering}
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
