"use client";

import type { InvoiceRow, RuleEvent } from "@/lib/events";
import type { Translate } from "@/lib/i18n";
import { useEffect, useState } from "react";
import { CheckIcon, CrossIcon, DocumentIcon, JudgedIcon } from "./icons";
import { RuleChips } from "./rule-chips";
import { Spinner } from "./spinner";

export const STATUS_PILL: Record<InvoiceRow["status"], string> = {
  pending: "bg-surface-container-high text-on-surface-variant border-outline-variant",
  ready: "bg-success-container text-on-success-container border-success/35",
  blocked: "bg-error-container text-on-error-container border-error/45",
  parked: "bg-secondary-container text-on-secondary-container border-secondary/35",
  parkError: "bg-error-container text-on-error-container border-error/45",
};

/** One row of the extracted-vs-SAP comparison: the invoice field, and the
 * rule id(s) whose result speaks to whether SAP agrees with it. */
const FIELD_ROWS: { key: keyof InvoiceRow; labelKey: string; ruleIds: number[] }[] = [
  { key: "vendorName", labelKey: "colVendor", ruleIds: [4] },
  { key: "purchaseOrder", labelKey: "colPo", ruleIds: [1, 2, 3] },
  { key: "companyCode", labelKey: "fieldCompanyCode", ruleIds: [5] },
  { key: "currency", labelKey: "fieldCurrency", ruleIds: [6] },
  { key: "material", labelKey: "fieldMaterial", ruleIds: [7] },
  { key: "quantity", labelKey: "fieldQuantity", ruleIds: [8, 13] },
  { key: "unitPrice", labelKey: "fieldUnitPrice", ruleIds: [9] },
  { key: "netAmount", labelKey: "colAmount", ruleIds: [10] },
  { key: "grossAmount", labelKey: "fieldGrossAmount", ruleIds: [11] },
  { key: "taxCode", labelKey: "fieldTaxCode", ruleIds: [14] },
];

function ruleFor(rules: RuleEvent[], ids: number[]): RuleEvent | undefined {
  return rules.find((r) => ids.includes(r.ruleId));
}

function formatDuration(ms: number) {
  if (ms < 1000) return "<1s";
  return `${(ms / 1000).toFixed(1)}s`;
}

function isPdf(filename: string) {
  return filename.toLowerCase().endsWith(".pdf");
}

function QueueList({
  invoices,
  selectedId,
  onSelect,
  t,
}: {
  invoices: InvoiceRow[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  t: Translate;
}) {
  return (
    <div className="flex w-[300px] flex-none flex-col gap-2 overflow-y-auto border-outline-variant border-r px-3 py-4">
      {invoices.length === 0 ? (
        <p className="px-3 py-6 text-[14px] text-on-surface-faint">{t("noMatches")}</p>
      ) : null}
      {invoices.map((invoice) => {
        const isSelected = invoice.invoiceId === selectedId;
        return (
          <button
            key={invoice.invoiceId}
            type="button"
            onClick={() => onSelect(invoice.invoiceId)}
            aria-current={isSelected ? "true" : undefined}
            className={`state-layer pressable flex cursor-pointer flex-col gap-1.5 rounded-[10px] border px-3.5 py-3 text-left transition-colors ${
              isSelected
                ? "border-primary bg-primary-container/40"
                : "border-transparent hover:bg-surface-container"
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="min-w-0 truncate font-medium text-[15px] text-on-surface tabular-nums">
                {invoice.supplierInvoiceId}
              </span>
              <span
                className={`flex h-5 w-5 flex-none items-center justify-center rounded-full border ${STATUS_PILL[invoice.status]}`}
                aria-hidden="true"
              >
                {invoice.status === "pending" ? (
                  <Spinner className="h-3 w-3" />
                ) : invoice.status === "blocked" || invoice.status === "parkError" ? (
                  <CrossIcon className="h-2.5 w-2.5" />
                ) : (
                  <CheckIcon className="h-2.5 w-2.5" />
                )}
              </span>
            </div>
            <div className="truncate text-[13px] text-on-surface-faint">
              {invoice.vendorName ?? invoice.vendor}
            </div>
            <div className="text-[13px] text-on-surface-variant tabular-nums">
              {invoice.netAmount} {invoice.currency}
            </div>
          </button>
        );
      })}
    </div>
  );
}

function FieldRow({
  label,
  value,
  rule,
  lowConfidence,
  t,
}: {
  label: string;
  value: string | undefined;
  rule: RuleEvent | undefined;
  lowConfidence: boolean;
  t: Translate;
}) {
  const failed = rule?.status === "fail";
  const judged = rule?.decidedBy === "agent" && rule.status === "pass";

  return (
    <div
      className={`flex flex-col gap-1 rounded-[8px] px-3 py-2.5 ${failed ? "border border-error/40 bg-error/[0.06]" : ""}`}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="text-[13px] text-on-surface-faint">{label}</span>
        <div className="flex items-center gap-1.5">
          {lowConfidence ? (
            <span className="rounded-full bg-primary-container px-1.5 py-0.5 font-semibold text-[10px] text-on-primary-container uppercase tracking-[0.05em]">
              {t("lowConfidence")}
            </span>
          ) : null}
          {rule ? (
            failed ? (
              <CrossIcon className="h-3.5 w-3.5 flex-none text-error" />
            ) : judged ? (
              <JudgedIcon className="h-3 w-3 flex-none text-secondary" />
            ) : (
              <CheckIcon className="h-3.5 w-3.5 flex-none text-success" />
            )
          ) : null}
        </div>
      </div>
      <span className="font-medium text-[16px] text-on-surface tabular-nums">{value || "—"}</span>
      {failed && rule?.detail ? (
        <p className="text-[13px] text-error leading-5">{rule.detail}</p>
      ) : judged && rule?.reasoning ? (
        <p className="text-[13px] text-secondary leading-5">{rule.reasoning}</p>
      ) : null}
    </div>
  );
}

export function ValidationQueueView({
  invoices,
  selectedId,
  onSelect,
  approvable,
  parkingIds,
  onApprove,
  onAsk,
  asking,
  previewUrls,
  t,
}: {
  invoices: InvoiceRow[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  approvable: boolean;
  parkingIds: string[];
  onApprove: (id: string) => void;
  onAsk: (question: string) => void;
  asking: boolean;
  previewUrls: Record<string, string>;
  t: Translate;
}) {
  const selected = invoices.find((i) => i.invoiceId === selectedId) ?? invoices[0] ?? null;
  const isParking = selected ? parkingIds.includes(selected.invoiceId) : false;

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (selected?.status !== "pending") return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [selected?.status]);
  const elapsed =
    selected?.startedAt !== undefined ? (selected.finishedAt ?? now) - selected.startedAt : null;

  const confidenceValues = selected?.confidence ? Object.values(selected.confidence) : [];
  const avgConfidence =
    confidenceValues.length > 0
      ? Math.round((confidenceValues.reduce((a, b) => a + b, 0) / confidenceValues.length) * 100)
      : null;

  const previewUrl = selected ? previewUrls[selected.invoiceId] : undefined;

  return (
    <div className="flex min-h-0 flex-1">
      <QueueList
        invoices={invoices}
        selectedId={selected?.invoiceId ?? null}
        onSelect={onSelect}
        t={t}
      />

      {!selected ? (
        <div className="flex flex-1 items-center justify-center px-8 text-[15px] text-on-surface-faint">
          {t("noInvoicesYet")}
        </div>
      ) : (
        <div className="enter flex min-h-0 flex-1 flex-col overflow-y-auto px-6 py-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <h2 className="font-semibold text-[20px] text-on-surface tabular-nums">
                {selected.supplierInvoiceId}
              </h2>
              <span
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-semibold text-[12px] uppercase tracking-[0.05em] ${STATUS_PILL[selected.status]}`}
              >
                {t(`st${selected.status[0].toUpperCase()}${selected.status.slice(1)}` as never)}
              </span>
              {elapsed !== null ? (
                <span className="text-[13px] text-on-surface-faint tabular-nums">
                  {formatDuration(elapsed)}
                </span>
              ) : null}
            </div>
            {approvable && (selected.status === "ready" || selected.status === "parkError") ? (
              <button
                type="button"
                disabled={isParking}
                onClick={() => onApprove(selected.invoiceId)}
                className="state-layer pressable flex min-h-[38px] cursor-pointer items-center gap-2 rounded-full bg-primary px-4 font-semibold text-[14px] text-on-primary disabled:opacity-60"
              >
                {isParking ? <Spinner className="h-3.5 w-3.5" /> : null}
                {selected.status === "parkError" ? t("retryOne") : t("approveOne")}
              </button>
            ) : null}
          </div>

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <div className="flex flex-col gap-3 rounded-[12px] border border-outline-variant bg-surface-container-low p-4">
              <div className="font-semibold text-[13px] text-on-surface-variant uppercase tracking-[0.1em]">
                {t("originalDocument")}
              </div>
              <div className="flex min-h-[280px] flex-1 overflow-hidden rounded-[10px] border border-outline-variant bg-surface">
                {previewUrl ? (
                  isPdf(selected.file) ? (
                    // `<img>` silently renders nothing for a PDF blob - the browser's own
                    // PDF viewer is what actually shows it, and only an iframe/embed can
                    // host that. `h-full` (not a fixed px height) is what makes it fill
                    // the pane instead of sitting centred in a taller box - the sibling
                    // "Extracted vs SAP" column is usually taller, and a grid row
                    // stretches both columns to match it.
                    <iframe
                      src={previewUrl}
                      title={selected.file}
                      className="h-full w-full border-0"
                    />
                  ) : (
                    // A blob: URL from an in-memory File, never a remote asset - nothing
                    // here for Next's image pipeline to optimize.
                    <img
                      src={previewUrl}
                      alt={selected.file}
                      className="h-full w-full object-contain"
                    />
                  )
                ) : (
                  <div className="flex w-full flex-col items-center justify-center gap-2 px-6 py-10 text-center">
                    <DocumentIcon className="h-8 w-8 text-on-surface-faint" />
                    <span className="text-[13px] text-on-surface-faint">
                      {t("previewUnavailable")}
                    </span>
                  </div>
                )}
              </div>
              <span className="truncate text-[13px] text-on-surface-faint">{selected.file}</span>
            </div>

            <div className="flex flex-col gap-3 rounded-[12px] border border-outline-variant bg-surface-container-low p-4">
              <div className="flex items-center justify-between">
                <div className="font-semibold text-[13px] text-on-surface-variant uppercase tracking-[0.1em]">
                  {t("extractedVsSap")}
                </div>
                {avgConfidence !== null ? (
                  <span className="rounded-full border border-outline-variant bg-surface px-2.5 py-1 font-semibold text-[12px] text-on-surface-variant">
                    {t("confidence", { pct: avgConfidence })}
                  </span>
                ) : null}
              </div>

              <div className="flex flex-col gap-1.5">
                {FIELD_ROWS.map(({ key, labelKey, ruleIds }) => {
                  const value = selected[key];
                  if (value === undefined || value === "") return null;
                  const confidenceKey = key === "vendorName" ? "vendor" : key;
                  const confidence = selected.confidence?.[confidenceKey as string];
                  return (
                    <FieldRow
                      key={key}
                      label={t(labelKey as never)}
                      value={String(value)}
                      rule={ruleFor(selected.rules, ruleIds)}
                      lowConfidence={confidence !== undefined && confidence < 0.8}
                      t={t}
                    />
                  );
                })}
                {selected.status === "pending" ? (
                  <div className="flex items-center gap-2 px-3 py-2 text-[14px] text-on-surface-faint">
                    <Spinner className="h-3.5 w-3.5" />
                    {t("stPending")}…
                  </div>
                ) : null}
              </div>

              {selected.headline ? (
                <div
                  className={`mt-2 flex flex-col gap-2 rounded-[10px] border p-4 ${
                    selected.status === "blocked"
                      ? "border-error/40 bg-error/[0.06]"
                      : "border-primary/40 bg-primary/[0.06]"
                  }`}
                >
                  <div className="font-semibold text-[13px] text-primary uppercase tracking-[0.08em]">
                    {t("aiInsight")}
                  </div>
                  <p className="text-[15px] text-on-surface leading-6">{selected.headline}</p>
                  {selected.impact ? (
                    <p className="text-[14px] text-on-surface-variant leading-6">
                      {selected.impact}
                    </p>
                  ) : null}
                  {selected.suggestion ? (
                    <p className="flex items-start gap-2 text-[14px] text-secondary leading-6">
                      <JudgedIcon className="mt-1 h-3 w-3 flex-none" />
                      <span>{selected.suggestion.text}</span>
                    </p>
                  ) : null}
                  <div className="mt-1 flex flex-wrap gap-2">
                    {selected.suggestion ? (
                      <QueueAction
                        label={t("actUse", { po: selected.suggestion.value })}
                        disabled={asking}
                        onClick={() =>
                          onAsk(
                            t("askUse", {
                              invoice: selected.supplierInvoiceId,
                              po: selected.suggestion?.value ?? "",
                            }),
                          )
                        }
                      />
                    ) : null}
                    <QueueAction
                      label={t("actSend")}
                      disabled={asking}
                      onClick={() => onAsk(t("askSend", { invoice: selected.supplierInvoiceId }))}
                    />
                    <QueueAction
                      label={t("actAsk")}
                      disabled={asking}
                      onClick={() => onAsk(t("askWhy", { invoice: selected.supplierInvoiceId }))}
                    />
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          <div className="mt-5 flex flex-col gap-2 rounded-[12px] border border-outline-variant bg-surface-container-low p-4">
            <div className="font-semibold text-[13px] text-on-surface-variant uppercase tracking-[0.1em]">
              {t("allChecks")}
            </div>
            <RuleChips rules={selected.rules} pending={selected.status === "pending"} t={t} />
          </div>
        </div>
      )}
    </div>
  );
}

function QueueAction({
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
      className="state-layer pressable min-h-[36px] cursor-pointer rounded-[8px] border border-outline bg-surface px-3.5 text-[13px] text-on-surface-variant transition-colors hover:border-on-surface-variant hover:text-on-surface disabled:cursor-default disabled:opacity-50"
    >
      {label}
    </button>
  );
}
