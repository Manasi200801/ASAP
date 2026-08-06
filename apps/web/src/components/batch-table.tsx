"use client";

import type { InvoiceRow } from "@/lib/events";
import type { Translate } from "@/lib/i18n";
import { useEffect, useState } from "react";
import { CheckIcon, ChevronIcon, CrossIcon, JudgedIcon } from "./icons";
import { RuleChips } from "./rule-chips";
import { Spinner } from "./spinner";

const GRID =
  "grid min-w-[940px] grid-cols-[minmax(180px,1.2fr)_minmax(150px,0.9fr)_minmax(120px,0.7fr)_minmax(120px,0.7fr)_minmax(84px,0.5fr)_minmax(210px,1fr)] items-center gap-4 px-5 py-4";

/**
 * Status is a filled pill, not tinted text.
 *
 * Across a projector a word in a slightly different grey-green is not a state
 * change anyone catches; a solid block of colour is. Each pairing is one of the
 * theme's existing container/on-container pairs, so both themes stay legible
 * without a second palette - and the hairline keeps the light theme's very pale
 * containers from dissolving into the white surface behind them.
 */
const STATUS_PILL: Record<InvoiceRow["status"], string> = {
  pending: "bg-surface-container-high text-on-surface-variant border-outline-variant",
  ready: "bg-success-container text-on-success-container border-success/35",
  blocked: "bg-error-container text-on-error-container border-error/45",
  parked: "bg-secondary-container text-on-secondary-container border-secondary/35",
  parkError: "bg-error-container text-on-error-container border-error/45",
};

function formatDuration(ms: number) {
  if (ms < 1000) return "<1s";
  return `${(ms / 1000).toFixed(1)}s`;
}

function StatusIcon({ status }: { status: InvoiceRow["status"] }) {
  if (status === "pending") return <Spinner className="h-3.5 w-3.5" />;
  if (status === "blocked" || status === "parkError")
    return <CrossIcon className="h-3.5 w-3.5" />;
  return <CheckIcon className="h-3.5 w-3.5" />;
}

export function BatchTable({
  invoices,
  approvable,
  parkingIds,
  onApprove,
  onAsk,
  asking,
  t,
}: {
  invoices: InvoiceRow[];
  approvable: boolean;
  parkingIds: string[];
  onApprove: (invoiceId: string) => void;
  /** Puts a question to the agent about this invoice. */
  onAsk: (question: string) => void;
  asking: boolean;
  t: Translate;
}) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [now, setNow] = useState(() => Date.now());

  // Only tick while something is still being checked - a finished batch has no
  // reason to keep re-rendering every quarter second.
  useEffect(() => {
    if (!invoices.some((i) => i.status === "pending")) return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [invoices]);

  const allSettled = invoices.length > 0 && invoices.every((i) => i.status !== "pending");
  const totalMs = allSettled
    ? invoices.reduce((sum, i) => sum + ((i.finishedAt ?? 0) - (i.startedAt ?? 0)), 0)
    : null;

  return (
    <div className="enter elevated overflow-x-auto rounded-[12px] border border-outline-variant bg-surface">
      <div
        className={`${GRID} border-outline-variant border-b bg-surface-container-high font-semibold text-[13px] text-on-surface-variant uppercase tracking-[0.09em]`}
      >
        <div>{t("colInvoice")}</div>
        <div>{t("colPo")}</div>
        <div>{t("colVendor")}</div>
        <div className="text-right">{t("colAmount")}</div>
        <div className="text-right">{t("colTime")}</div>
        <div className="text-right">{t("colStatus")}</div>
      </div>

      {invoices.map((invoice) => {
        // Every row opens on demand only - none pre-expand, even a failing one.
        // The clerk chooses which invoice to inspect, not the interface.
        const isOpen = open[invoice.invoiceId] ?? false;
        const elapsed =
          invoice.startedAt !== undefined ? (invoice.finishedAt ?? now) - invoice.startedAt : null;
        const isParking = parkingIds.includes(invoice.invoiceId);
        const toggle = () => setOpen((prev) => ({ ...prev, [invoice.invoiceId]: !isOpen }));
        const isBad = invoice.status === "blocked" || invoice.status === "parkError";

        return (
          <div
            key={invoice.invoiceId}
            // `row-alert` arrives with the status change, so the wash fires at
            // the exact moment the failing check lands and never on a timer. The
            // 2px rail and the pill carry the state once the wash has settled.
            className={`enter border-outline-variant border-b border-l-2 last:border-b-0 ${
              isBad ? "row-alert border-l-error" : "border-l-transparent"
            }`}
          >
            {/* A row toggles open/closed but also hosts its own approve button, so
                this is a div acting as a button rather than a real one - a <button>
                cannot legally contain another <button>. */}
            {/* biome-ignore lint/a11y/useSemanticElements: a real <button> here would illegally nest the row's own approve <button> */}
            <div
              role="button"
              tabIndex={0}
              aria-expanded={isOpen}
              onClick={toggle}
              onKeyDown={(e) => {
                if (e.key !== "Enter" && e.key !== " ") return;
                e.preventDefault();
                toggle();
              }}
              className={`${GRID} relative w-full cursor-pointer text-left transition-colors hover:bg-surface-container focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary focus-visible:-outline-offset-2`}
            >
              <div className="font-medium text-[17px] text-on-surface tabular-nums">
                {invoice.supplierInvoiceId}
                {invoice.sapDocument ? (
                  <span className="sapref ml-2 text-[13px] text-secondary" data-on="true">
                    {invoice.sapDocument}
                  </span>
                ) : null}
              </div>
              <div className="text-[16px] text-on-surface-variant tabular-nums">
                {invoice.purchaseOrder}
              </div>
              <div className="text-[16px] text-on-surface-variant tabular-nums">
                {invoice.vendor}
              </div>
              <div className="text-right text-[17px] text-on-surface tabular-nums">
                {invoice.netAmount}
              </div>
              <div className="text-right text-[15px] text-on-surface-faint tabular-nums">
                {elapsed === null ? "—" : formatDuration(elapsed)}
              </div>
              <div className="flex items-center justify-end gap-2.5">
                {isParking ? (
                  // Replaces the status pill in place, rather than sitting beside
                  // it - "success" must visibly become "parking" right where it
                  // was, not leave a stale green tick while the row quietly waits
                  // its turn in the same batch approval.
                  <div className="inline-flex items-center gap-2 rounded-full border border-outline-variant bg-surface-container-high px-3 py-1.5 font-semibold text-[14px] text-on-surface-variant uppercase tracking-[0.05em]">
                    <Spinner className="h-3.5 w-3.5" />
                    {t("stParking")}
                  </div>
                ) : (
                  <div
                    className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 font-semibold text-[14px] uppercase tracking-[0.05em] ${STATUS_PILL[invoice.status]}`}
                  >
                    <StatusIcon status={invoice.status} />
                    {t(`st${invoice.status[0].toUpperCase()}${invoice.status.slice(1)}` as never)}
                  </div>
                )}

                {approvable &&
                (invoice.status === "ready" || invoice.status === "parkError") &&
                !isParking ? (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onApprove(invoice.invoiceId);
                    }}
                    className="state-layer pressable ml-auto flex min-h-[36px] flex-none cursor-pointer items-center gap-1.5 rounded-[8px] border border-outline px-3.5 text-[14px] text-on-surface-variant transition-colors hover:border-primary hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
                  >
                    {invoice.status === "parkError" ? t("retryOne") : t("approveOne")}
                  </button>
                ) : null}

                <ChevronIcon
                  className={`h-4 w-4 text-on-surface-faint transition-transform duration-200 ${isOpen ? "rotate-90" : ""}`}
                />
              </div>
            </div>

            <div className="reveal" data-open={isOpen}>
              <div>
                <RuleChips rules={invoice.rules} pending={invoice.status === "pending"} t={t} />

                {invoice.headline ? (
                  <div className="mx-5 mb-5 rounded-[10px] border border-outline-variant bg-surface-container-low p-5">
                    <p className="max-w-[70ch] font-medium text-[18px] text-on-surface leading-7">
                      {invoice.headline}
                    </p>
                    {invoice.impact ? (
                      <p className="mt-2 max-w-[70ch] text-[16px] text-on-surface-variant leading-7">
                        {invoice.impact}
                      </p>
                    ) : null}
                    {invoice.suggestion ? (
                      <p className="mt-2 flex max-w-[70ch] items-start gap-2 text-[16px] text-secondary leading-7">
                        <JudgedIcon className="mt-1.5 h-3.5 w-3.5" />
                        <span>{invoice.suggestion.text}</span>
                      </p>
                    ) : null}
                    {/* Each of these asks the agent a real question. They were
                        decoration once, and a button that does nothing is worse
                        than no button - it teaches people the screen is a mockup. */}
                    <div className="mt-4 flex flex-wrap gap-2">
                      {invoice.suggestion ? (
                        <Action
                          label={t("actUse", { po: invoice.suggestion.value })}
                          disabled={asking}
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
                        disabled={asking}
                        onClick={() => onAsk(t("askSend", { invoice: invoice.supplierInvoiceId }))}
                      />
                      <Action
                        label={t("actAsk")}
                        disabled={asking}
                        onClick={() => onAsk(t("askWhy", { invoice: invoice.supplierInvoiceId }))}
                      />
                    </div>
                  </div>
                ) : null}

                {invoice.status === "parkError" ? (
                  <div className="mx-5 mb-5 rounded-[10px] border border-error/40 bg-error/[0.08] p-5">
                    <p className="max-w-[70ch] font-medium text-[18px] text-on-surface leading-7">
                      {t("parkErrorHeadline")}
                    </p>
                    <p className="mt-2 max-w-[70ch] text-[16px] text-on-surface-variant leading-7">
                      {invoice.parkError}
                    </p>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        );
      })}

      {totalMs !== null ? (
        <div className="flex items-center justify-end gap-2.5 border-outline-variant border-t bg-surface-container-high px-5 py-3 text-[15px] text-on-surface-variant">
          {t("totalTime")}
          <span className="font-semibold text-[17px] text-on-surface tabular-nums">
            {formatDuration(totalMs)}
          </span>
        </div>
      ) : null}
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
      className="state-layer pressable min-h-[40px] cursor-pointer rounded-[8px] border border-outline bg-surface-container-high px-4 text-[15px] text-on-surface-variant transition-colors hover:border-on-surface-variant hover:text-on-surface disabled:cursor-default disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
    >
      {label}
    </button>
  );
}
