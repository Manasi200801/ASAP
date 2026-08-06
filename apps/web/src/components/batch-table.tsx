"use client";

import type { InvoiceRow } from "@/lib/events";
import type { Translate } from "@/lib/i18n";
import { useState } from "react";
import { RuleChips } from "./rule-chips";

const GRID = "grid grid-cols-[128px_104px_84px_84px_54px_78px] items-center gap-2.5 px-3 py-2.5";

const STATUS_TONE: Record<InvoiceRow["status"], string> = {
  pending: "text-ink-faint",
  ready: "text-ok",
  blocked: "text-blocked",
  parked: "text-brass",
};

const DOT_TONE: Record<InvoiceRow["status"], string> = {
  pending: "bg-pending",
  ready: "bg-ok",
  blocked: "bg-blocked",
  parked: "bg-brass",
};

export function BatchTable({
  invoices,
  onAsk,
  disabled,
  t,
}: {
  invoices: InvoiceRow[];
  /** Puts a question to the agent about this run. */
  onAsk: (question: string) => void;
  disabled: boolean;
  t: Translate;
}) {
  const [open, setOpen] = useState<Record<string, boolean>>({});

  return (
    <div className="enter overflow-hidden rounded-md border border-line bg-surface-1">
      <div
        className={`${GRID} border-line border-b bg-surface-2 font-data text-[10px] text-ink-faint uppercase tracking-[0.12em]`}
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
            className={`enter border-line border-b last:border-b-0 ${
              invoice.status === "blocked" ? "bg-blocked/[0.055]" : ""
            }`}
          >
            <button
              type="button"
              aria-expanded={isOpen}
              onClick={() => setOpen((prev) => ({ ...prev, [invoice.invoiceId]: !isOpen }))}
              className={`${GRID} w-full cursor-pointer text-left transition-colors hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brass focus-visible:-outline-offset-2`}
            >
              <div className="font-data text-[12px] tabular-nums">{invoice.supplierInvoiceId}</div>
              <div className="font-data text-[12px] text-ink-dim tabular-nums">
                {invoice.purchaseOrder}
              </div>
              <div className="font-data text-[12px] text-ink-dim tabular-nums">
                {invoice.vendor}
              </div>
              <div className="text-right font-data text-[12px] tabular-nums">
                {invoice.netAmount}
              </div>
              <div className="text-right font-data text-[12px] text-ink-dim tabular-nums">
                {invoice.sapDocument ? (
                  <span className="sapref text-[11.5px] text-brass" data-on="true">
                    {invoice.sapDocument}
                  </span>
                ) : evaluated ? (
                  `${passed}/${invoice.rules.length}`
                ) : (
                  "—"
                )}
              </div>
              <div
                className={`inline-flex min-w-[74px] items-center gap-1.5 font-data text-[10.5px] uppercase tracking-[0.08em] ${STATUS_TONE[invoice.status]}`}
              >
                <span
                  className={`h-1.5 w-1.5 flex-none rounded-full transition-colors ${DOT_TONE[invoice.status]}`}
                />
                {t(`st${invoice.status[0].toUpperCase()}${invoice.status.slice(1)}` as never)}
              </div>
            </button>

            <div className="reveal" data-open={isOpen}>
              <div>
                <RuleChips rules={invoice.rules} t={t} />

                {invoice.headline ? (
                  <div className="mx-3 mb-3.5 border-blocked border-l-2 pl-3">
                    <p className="max-w-[62ch]">{invoice.headline}</p>
                    {invoice.impact ? (
                      <p className="mt-1 max-w-[62ch] text-ink-dim">{invoice.impact}</p>
                    ) : null}
                    {invoice.suggestion ? (
                      <p className="mt-1 max-w-[62ch] text-agent">◆ {invoice.suggestion.text}</p>
                    ) : null}
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {invoice.suggestion ? (
                        <Action
                          label={t("actUse", { po: invoice.suggestion.value })}
                          disabled={disabled}
                          onClick={() =>
                            onAsk(
                              t("askUse", {
                                invoice: invoice.supplierInvoiceId,
                                po: invoice.suggestion?.value ?? "",
                              }),
                            )
                          }
                        />
                      ) : null}
                      <Action
                        label={t("actSend")}
                        disabled={disabled}
                        onClick={() =>
                          onAsk(t("askSend", { invoice: invoice.supplierInvoiceId }))
                        }
                      />
                      <Action
                        label={t("actAsk")}
                        disabled={disabled}
                        onClick={() =>
                          onAsk(t("askWhy", { invoice: invoice.supplierInvoiceId }))
                        }
                      />
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

function Action({
  label,
  onClick,
  disabled,
}: {
  label: string;
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="pressable cursor-pointer rounded-full border border-line bg-surface-3 px-2.5 py-1 text-[12px] text-ink-dim transition-colors hover:border-ink-faint hover:text-ink disabled:cursor-default disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brass"
    >
      {label}
    </button>
  );
}
