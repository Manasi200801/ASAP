"use client";

import { ApprovalCard } from "@/components/approval-card";
import { BatchTable } from "@/components/batch-table";
import { Composer } from "@/components/composer";
import { useLocale } from "@/lib/i18n";
import { useRun } from "@/lib/use-run";
import { useState } from "react";

export default function Page() {
  const { locale, setLocale, t } = useLocale();
  const { run, start, approve, reset } = useRun();
  const [files, setFiles] = useState<string[]>([]);

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

      <header className="flex flex-wrap items-center gap-5 border-outline-variant border-b bg-surface-container-low px-6 py-4">
        <div className="font-semibold text-[17px] text-on-surface uppercase tracking-[0.11em]">
          STRIKE <span className="text-primary">AP</span>
        </div>

        <div
          className={`ml-auto flex gap-4 text-[14px] text-on-surface-variant tabular-nums transition-opacity ${
            started ? "opacity-100" : "opacity-0"
          }`}
        >
          <span>
            <b className="font-medium text-success">{ready}</b> {t("ready")}
          </span>
          <span>
            <b className={blocked ? "font-medium text-error" : "font-medium text-on-surface"}>
              {blocked}
            </b>{" "}
            {t("blocked")}
          </span>
          <span>
            <b className="font-medium text-on-surface">{checks}</b> {t("checks")}
          </span>
          <span className="text-on-surface-faint">{t("period")}</span>
        </div>

        <div className="flex gap-2">
          {(["en", "de"] as const).map((code) => (
            <Ctrl
              key={code}
              pressed={locale === code}
              onClick={() => setLocale(code)}
              label={code.toUpperCase()}
            />
          ))}
        </div>
      </header>

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
              <div className="font-semibold text-[12px] text-secondary uppercase tracking-[0.12em]">
                {t("agent")}
              </div>

              {run.messages.map((message, index) => (
                <p
                  key={`${index}-${message.slice(0, 12)}`}
                  className="enter max-w-[78ch] text-[17px] text-on-surface leading-7"
                >
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
                <p className="max-w-[62ch] border-error border-l-2 pl-3 text-error">{run.error}</p>
              ) : null}
            </div>
          ) : null}
        </div>

        <Composer onSubmit={(message) => begin(message)} onFiles={onFiles} disabled={busy} t={t} />
      </div>
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
      className={`state-layer pressable cursor-pointer rounded-[8px] border px-3 py-1.5 font-semibold text-[13px] tracking-[0.04em] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary ${
        pressed
          ? "border-primary bg-primary-container text-on-primary-container"
          : "border-outline text-on-surface-variant hover:text-on-surface"
      }`}
    >
      {label}
    </button>
  );
}
