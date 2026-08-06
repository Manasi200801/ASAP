"use client";

import { ApprovalCard } from "@/components/approval-card";
import { BatchTable } from "@/components/batch-table";
import { CallRail } from "@/components/call-rail";
import { Composer } from "@/components/composer";
import { useLocale } from "@/lib/i18n";
import { useRun } from "@/lib/use-run";
import { useState } from "react";

export default function Page() {
  const { locale, setLocale, t } = useLocale();
  const { run, start, approve, reset } = useRun();
  const [files, setFiles] = useState<string[]>([]);
  const [slow, setSlow] = useState(false);

  const busy = run.state === "extracting" || run.state === "validating" || run.state === "posting";
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
                <div className="font-data text-[10.5px] text-brass uppercase tracking-[0.14em]">
                  {t("agent")}
                </div>

                {run.messages.map((message, index) => (
                  <p key={`${index}-${message.slice(0, 12)}`} className="enter max-w-[66ch]">
                    {message}
                  </p>
                ))}

                {run.invoices.length > 0 ? <BatchTable invoices={run.invoices} t={t} /> : null}

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

        <Composer onSubmit={(message) => begin(message)} onFiles={onFiles} disabled={busy} t={t} />
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
