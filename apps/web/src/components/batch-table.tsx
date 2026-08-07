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
  refused: "text-blocked",
};

const DOT_TONE: Record<InvoiceRow["status"], string> = {
  pending: "bg-pending",
  ready: "bg-ok",
  blocked: "bg-blocked",
  parked: "bg-brass",
  refused: "bg-blocked",
};

export function BatchTable({
  invoices,
  onDecide,
  t,
}: {
  invoices: InvoiceRow[];
  /** Absent once the gate has closed - there is nothing left to decide. */
  onDecide?: (invoiceId: string, decision: "override" | "reject") => void;
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
        // A blocked or refused invoice opens itself and stays open. A refusal
        // that stays collapsed is a failure nobody reads.
        const isOpen =
          open[invoice.invoiceId] ??
          (invoice.status === "blocked" || invoice.status === "refused");
        const passed = invoice.rules.filter((r) => r.status === "pass").length;
        const evaluated = invoice.rules.filter((r) => r.status !== "skip").length;

        return (
          <div
            key={invoice.invoiceId}
            className={`enter border-line border-b last:border-b-0 ${
              invoice.status === "blocked" || invoice.status === "refused"
                ? "bg-blocked/[0.055]"
                : ""
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

                {invoice.postingError ? (
                  <div className="mx-3 mb-3.5 border-blocked border-l-2 pl-3">
                    <p className="max-w-[62ch] text-blocked">{t("postingRefused")}</p>
                    {/* SAP's own words. Paraphrasing a write failure is how the
                        actual cause gets lost between the system and the person
                        who has to do something about it. */}
                    <p className="mt-1 max-w-[62ch] font-data text-[12px] text-ink-dim">
                      {invoice.postingError}
                    </p>
                    <p className="mt-1 max-w-[62ch] text-ink-dim">{t("postingRefusedImpact")}</p>
                  </div>
                ) : null}

                {invoice.filed ? (
                  <p className="mx-3 mb-3 font-data text-[11px] text-ink-faint">
                    {invoice.filed.status === "error"
                      ? `${t("filedError")}${invoice.filed.message ? ` — ${invoice.filed.message}` : ""}`
                      : t(invoice.filed.status === "moved" ? "filedMoved" : "filedKept", {
                          bucket: invoice.filed.bucket ?? "",
                        })}
                  </p>
                ) : null}

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
                      {onDecide ? (
                        <>
                          {/* Neither of these posts or files anything on its own.
                              They mark the row, and the single Approve press
                              below carries every mark to the agent at once. */}
                          <Action
                            label={t("actOverride")}
                            pressed={invoice.decision === "override"}
                            tone="override"
                            onClick={() => onDecide(invoice.invoiceId, "override")}
                          />
                          <Action
                            label={t("actReject")}
                            pressed={invoice.decision === "reject"}
                            tone="reject"
                            onClick={() => onDecide(invoice.invoiceId, "reject")}
                          />
                        </>
                      ) : null}
                      {invoice.suggestion ? (
                        <Action label={t("actUse", { po: invoice.suggestion.value })} />
                      ) : null}
                      <Action label={t("actSend")} />
                      <Action label={t("actAsk")} />
                    </div>

                    {invoice.decision ? (
                      <p className="mt-2.5 max-w-[62ch] text-[12.5px] text-ink-dim">
                        {t(invoice.decision === "override" ? "markedOverride" : "markedReject")}
                      </p>
                    ) : null}
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

const PRESSED_TONE = {
  override: "border-ok bg-ok/[0.12] text-ok",
  reject: "border-blocked bg-blocked/[0.12] text-blocked",
} as const;

function Action({
  label,
  pressed,
  tone,
  onClick,
}: {
  label: string;
  pressed?: boolean;
  tone?: keyof typeof PRESSED_TONE;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={onClick ? Boolean(pressed) : undefined}
      className={`pressable cursor-pointer rounded-full border px-2.5 py-1 text-[12px] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-brass ${
        pressed && tone
          ? PRESSED_TONE[tone]
          : "border-line bg-surface-3 text-ink-dim hover:border-ink-faint hover:text-ink"
      }`}
    >
      {label}
    </button>
  );
}
