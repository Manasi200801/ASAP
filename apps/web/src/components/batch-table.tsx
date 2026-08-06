"use client";

import type { InvoiceRow } from "@/lib/events";
import type { Translate } from "@/lib/i18n";
import { useState } from "react";
import { RuleChips } from "./rule-chips";

const GRID =
  "grid min-w-[860px] grid-cols-[minmax(170px,1.2fr)_minmax(140px,0.9fr)_minmax(120px,0.8fr)_minmax(110px,0.7fr)_minmax(82px,0.5fr)_minmax(110px,0.7fr)] items-center gap-4 px-4 py-3";

const STATUS_TONE: Record<InvoiceRow["status"], string> = {
  pending: "text-on-surface-faint",
  ready: "text-success",
  blocked: "text-error",
  parked: "text-secondary",
};

const DOT_TONE: Record<InvoiceRow["status"], string> = {
  pending: "bg-outline",
  ready: "bg-success",
  blocked: "bg-error",
  parked: "bg-secondary",
};

export function BatchTable({ invoices, t }: { invoices: InvoiceRow[]; t: Translate }) {
  const [open, setOpen] = useState<Record<string, boolean>>({});

  return (
    <div className="enter overflow-x-auto rounded-[12px] border border-outline-variant bg-surface">
      <div
        className={`${GRID} border-outline-variant border-b bg-surface-container-high font-semibold text-[12px] text-on-surface-faint uppercase tracking-[0.1em]`}
      >
        <div>{t("colInvoice")}</div>
        <div>{t("colPo")}</div>
        <div>{t("colVendor")}</div>
        <div className="text-right">{t("colAmount")}</div>
        <div className="text-right">{t("colChecks")}</div>
        <div>{t("colStatus")}</div>
      </div>

      {invoices.map((invoice) => {
        // A blocked invoice opens itself and stays open. Everything else is on demand.
        const isOpen = open[invoice.invoiceId] ?? invoice.status === "blocked";
        const passed = invoice.rules.filter((r) => r.status === "pass").length;
        const evaluated = invoice.rules.filter((r) => r.status !== "skip").length;

        return (
          <div
            key={invoice.invoiceId}
            className={`enter border-outline-variant border-b last:border-b-0 ${
              invoice.status === "blocked" ? "bg-error/[0.06]" : ""
            }`}
          >
            <button
              type="button"
              aria-expanded={isOpen}
              onClick={() => setOpen((prev) => ({ ...prev, [invoice.invoiceId]: !isOpen }))}
              className={`${GRID} w-full cursor-pointer text-left transition-colors hover:bg-surface-container focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary focus-visible:-outline-offset-2`}
            >
              <div className="text-[15px] text-on-surface tabular-nums">
                {invoice.supplierInvoiceId}
              </div>
              <div className="text-[15px] text-on-surface-variant tabular-nums">
                {invoice.purchaseOrder}
              </div>
              <div className="text-[15px] text-on-surface-variant tabular-nums">
                {invoice.vendor}
              </div>
              <div className="text-right text-[15px] text-on-surface tabular-nums">
                {invoice.netAmount}
              </div>
              <div className="text-right text-[15px] text-on-surface-variant tabular-nums">
                {invoice.sapDocument ? (
                  <span className="sapref text-[14px] text-secondary" data-on="true">
                    {invoice.sapDocument}
                  </span>
                ) : evaluated ? (
                  `${passed}/${invoice.rules.length}`
                ) : (
                  "—"
                )}
              </div>
              <div className="flex items-center justify-between gap-2">
                <div
                  className={`inline-flex min-w-[96px] items-center gap-2 font-semibold text-[13px] uppercase tracking-[0.06em] ${STATUS_TONE[invoice.status]}`}
                >
                  <span
                    className={`h-1.5 w-1.5 flex-none rounded-full transition-colors ${DOT_TONE[invoice.status]}`}
                  />
                  {t(`st${invoice.status[0].toUpperCase()}${invoice.status.slice(1)}` as never)}
                </div>
                <span
                  aria-hidden="true"
                  className={`flex-none text-on-surface-faint text-[11px] transition-transform ${isOpen ? "rotate-90" : ""}`}
                >
                  ▶
                </span>
              </div>
            </button>

            <div className="reveal" data-open={isOpen}>
              <div>
                <RuleChips rules={invoice.rules} t={t} />

                {invoice.headline ? (
                  <div className="mx-4 mb-4 border-error border-l-2 pl-4">
                    <p className="max-w-[72ch] text-[16px] text-on-surface leading-6">
                      {invoice.headline}
                    </p>
                    {invoice.impact ? (
                      <p className="mt-1 max-w-[72ch] text-[15px] text-on-surface-variant leading-6">
                        {invoice.impact}
                      </p>
                    ) : null}
                    {invoice.suggestion ? (
                      <p className="mt-1 max-w-[72ch] text-[15px] text-secondary leading-6">
                        ◆ {invoice.suggestion.text}
                      </p>
                    ) : null}
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {invoice.suggestion ? (
                        <Action label={t("actUse", { po: invoice.suggestion.value })} />
                      ) : null}
                      <Action label={t("actSend")} />
                      <Action label={t("actAsk")} />
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Action({ label }: { label: string }) {
  return (
    <button
      type="button"
      className="state-layer pressable cursor-pointer rounded-[8px] border border-outline bg-surface-container-high px-3 py-1.5 text-[14px] text-on-surface-variant transition-colors hover:text-on-surface focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
    >
      {label}
    </button>
  );
}
