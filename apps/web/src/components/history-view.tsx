"use client";

import type { InvoiceRow } from "@/lib/events";
import type { Translate } from "@/lib/i18n";
import type { Summary } from "@/lib/use-run";
import { useState } from "react";
import { ChevronIcon } from "./icons";
import { STATUS_PILL } from "./validation-queue";

export type HistoryEntry = {
  runId: string;
  reference: string | null;
  at: number;
  invoices: InvoiceRow[];
  summary: Summary | null;
};

/**
 * Runs completed earlier in this browser session, not a durable log.
 *
 * The backend keeps every run in SQLite (`apps/agent/app/db.py`), but nothing
 * exposes that over HTTP yet - there is no endpoint this page could call for
 * a run from before the tab was opened. Labelling it "this session" is the
 * honest scope rather than a history page that quietly loses everything on
 * reload.
 */
export function HistoryView({ entries, t }: { entries: HistoryEntry[]; t: Translate }) {
  const [openId, setOpenId] = useState<string | null>(null);

  if (entries.length === 0) {
    return (
      <div className="mx-auto flex w-full max-w-[900px] flex-col gap-2 px-8 py-10">
        <h1 className="font-semibold text-[22px] text-on-surface">{t("navHistory")}</h1>
        <p className="text-[15px] text-on-surface-faint">{t("noHistory")}</p>
      </div>
    );
  }

  return (
    <div className="enter mx-auto flex w-full max-w-[900px] flex-col gap-4 px-8 py-8">
      <div className="flex flex-col gap-1">
        <h1 className="font-semibold text-[22px] text-on-surface">{t("navHistory")}</h1>
        <p className="text-[14px] text-on-surface-faint">{t("historySessionScope")}</p>
      </div>

      {entries.map((entry) => {
        const isOpen = openId === entry.runId;
        return (
          <div
            key={entry.runId}
            className="rounded-[12px] border border-outline-variant bg-surface"
          >
            <button
              type="button"
              onClick={() => setOpenId(isOpen ? null : entry.runId)}
              aria-expanded={isOpen}
              className="state-layer flex w-full cursor-pointer items-center gap-4 px-5 py-4 text-left"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium text-[16px] text-on-surface">
                  {entry.reference ?? entry.runId}
                </div>
                <div className="text-[13px] text-on-surface-faint">
                  {new Date(entry.at).toLocaleString(undefined, {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                </div>
              </div>
              <div className="flex flex-none items-center gap-4 text-[14px] text-on-surface-variant tabular-nums">
                <span>
                  {t("sumReady")}: {entry.summary?.ready ?? "—"}
                </span>
                <span>
                  {t("sumBlocked")}: {entry.summary?.blocked ?? "—"}
                </span>
              </div>
              <ChevronIcon
                className={`h-4 w-4 flex-none text-on-surface-faint transition-transform ${isOpen ? "rotate-90" : ""}`}
              />
            </button>

            {isOpen ? (
              <div className="flex flex-col divide-y divide-outline-variant border-outline-variant border-t px-5">
                {entry.invoices.map((invoice) => (
                  <div key={invoice.invoiceId} className="flex items-center gap-3 py-2.5">
                    <span
                      className={`rounded-full border px-2 py-0.5 font-semibold text-[11px] uppercase tracking-[0.05em] ${STATUS_PILL[invoice.status]}`}
                    >
                      {t(`st${invoice.status[0].toUpperCase()}${invoice.status.slice(1)}` as never)}
                    </span>
                    <span className="min-w-0 flex-1 truncate font-medium text-[14px] text-on-surface tabular-nums">
                      {invoice.supplierInvoiceId}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[13px] text-on-surface-faint">
                      {invoice.vendorName ?? invoice.vendor}
                    </span>
                    <span className="flex-none text-[13px] text-on-surface-variant tabular-nums">
                      {invoice.netAmount} {invoice.currency}
                    </span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
