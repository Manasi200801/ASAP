"use client";

import type { InvoiceRow, RunState } from "@/lib/events";
import type { Translate } from "@/lib/i18n";
import type { Summary } from "@/lib/use-run";
import type { Message } from "@/lib/use-run";
import { LiveStatus } from "./live-status";

const EMPTY_STEPS = [
  ["stageExtract", "emptyStep1"],
  ["stageValidate", "emptyStep2"],
  ["stageApprove", "emptyStep3"],
] as const;

function StatTile({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex flex-1 flex-col gap-1.5 rounded-[12px] border border-outline-variant bg-surface p-5">
      <div className="font-semibold text-[13px] text-on-surface-faint uppercase tracking-[0.1em]">
        {label}
      </div>
      <div className="font-semibold text-[28px] text-on-surface tabular-nums leading-none">
        {value}
      </div>
    </div>
  );
}

/**
 * The landing screen. Before a run: what the product does and the one thing
 * worth doing. After a run starts: the real numbers from this run's own
 * `summary` event, not a canned dashboard - a run still validating shows an
 * em dash rather than a zero it would have to walk back a second later.
 */
export function CommandCenterView({
  state,
  started,
  invoices,
  summary,
  statusMessages,
  onUpload,
  onSample,
  onOpenQueue,
  t,
}: {
  state: RunState;
  started: boolean;
  invoices: InvoiceRow[];
  summary: Summary | null;
  statusMessages: Message[];
  onUpload: () => void;
  onSample: () => void;
  onOpenQueue: () => void;
  t: Translate;
}) {
  const dash = "—";

  if (!started) {
    return (
      <div className="enter mx-auto flex w-full max-w-[900px] flex-col gap-8 px-8 py-12">
        <div className="flex flex-col gap-4">
          <h1 className="max-w-[36ch] text-balance font-semibold text-[clamp(25px,2.4vw,36px)] text-on-surface leading-[1.18] tracking-[-0.02em]">
            {t("emptyTitle")}
          </h1>
          <p className="max-w-[64ch] text-[18px] text-on-surface-variant leading-7">
            {t("emptyBody")}
          </p>
        </div>

        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={onUpload}
            className="pressable state-layer min-h-[46px] cursor-pointer rounded-full bg-primary px-6 font-semibold text-[15px] text-on-primary transition-opacity focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-on-surface"
          >
            {t("uploadFiles")}
          </button>
          <button
            type="button"
            onClick={onSample}
            className="pressable state-layer min-h-[46px] cursor-pointer rounded-full border border-outline px-6 font-semibold text-[15px] text-on-surface-variant transition-colors hover:border-on-surface-variant hover:text-on-surface focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            {t("loadBatch")}
          </button>
        </div>

        <ol className="flex max-w-[76ch] flex-col border-outline-variant border-t">
          {EMPTY_STEPS.map(([stage, body]) => (
            <li
              key={stage}
              className="flex flex-col gap-1 border-outline-variant border-b py-3.5 sm:flex-row sm:gap-6"
            >
              <span className="w-[9rem] flex-none pt-0.5 font-semibold text-[14px] text-primary uppercase tracking-[0.1em]">
                {t(stage)}
              </span>
              <span className="max-w-[60ch] text-[17px] text-on-surface leading-7">{t(body)}</span>
            </li>
          ))}
        </ol>
      </div>
    );
  }

  return (
    <div className="enter mx-auto flex w-full max-w-[1100px] flex-col gap-6 px-8 py-8">
      <div className="flex flex-wrap gap-4">
        <StatTile label={t("sumReady")} value={summary?.ready ?? dash} />
        <StatTile label={t("sumBlocked")} value={summary?.blocked ?? dash} />
        <StatTile label={t("sumRules")} value={summary?.rulesRun ?? dash} />
        <StatTile label={t("sumAgent")} value={summary?.agentDecided ?? dash} />
        <StatTile
          label={t("sumSaved")}
          value={summary ? t("minutes", { count: summary.minutesSaved }) : dash}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[280px_1fr]">
        <div className="rounded-[12px] border border-outline-variant bg-surface p-6">
          <LiveStatus state={state} messages={statusMessages} t={t} />
        </div>

        <div className="rounded-[12px] border border-outline-variant bg-surface p-6">
          <div className="mb-4 flex items-center justify-between">
            <div className="font-semibold text-[13px] text-on-surface-variant uppercase tracking-[0.12em]">
              {t("navQueue")}
            </div>
            {invoices.length > 0 ? (
              <button
                type="button"
                onClick={onOpenQueue}
                className="pressable cursor-pointer font-medium text-[14px] text-secondary hover:underline"
              >
                {t("viewAll")}
              </button>
            ) : null}
          </div>

          {invoices.length === 0 ? (
            <p className="text-[15px] text-on-surface-faint">{t("noInvoicesYet")}</p>
          ) : (
            <div className="flex flex-col divide-y divide-outline-variant">
              {invoices.slice(0, 6).map((invoice) => (
                <div
                  key={invoice.invoiceId}
                  className="flex items-center justify-between gap-3 py-2.5 text-[15px]"
                >
                  <span className="min-w-0 flex-1 truncate font-medium text-on-surface tabular-nums">
                    {invoice.supplierInvoiceId}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-on-surface-faint">
                    {invoice.vendorName ?? invoice.vendor}
                  </span>
                  <span className="flex-none tabular-nums text-on-surface-variant">
                    {invoice.netAmount} {invoice.currency}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
