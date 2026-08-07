"use client";

import type { InvoiceRow } from "@/lib/events";
import type { Translate } from "@/lib/i18n";
import type { ReactNode } from "react";
import { ApprovalCard } from "./approval-card";
import { CheckIcon, CrossIcon } from "./icons";
import { Spinner } from "./spinner";
import { STATUS_PILL } from "./validation-queue";

/**
 * The single approval gate, plus the two lists it decides between: what a
 * approving-all click actually parks, and what it deliberately leaves out.
 * Nothing here can post anything that is not `ready` - the gate is the same
 * `ApprovalCard` used everywhere else in the app, not a second path to SAP.
 */
export function ApprovalWorkflowView({
  invoices,
  readyIds,
  blockedIds,
  parkingIds,
  working,
  onApproveAll,
  onApproveOne,
  approvable,
  t,
}: {
  invoices: InvoiceRow[];
  readyIds: string[];
  blockedIds: string[];
  parkingIds: string[];
  working: boolean;
  onApproveAll: () => void;
  onApproveOne: (id: string) => void;
  approvable: boolean;
  t: Translate;
}) {
  const ready = invoices.filter((i) => readyIds.includes(i.invoiceId));
  const blocked = invoices.filter((i) => blockedIds.includes(i.invoiceId));
  const parked = invoices.filter((i) => i.status === "parked");

  if (invoices.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center px-8 text-[15px] text-on-surface-faint">
        {t("noInvoicesYet")}
      </div>
    );
  }

  return (
    <div className="enter mx-auto flex w-full max-w-[900px] flex-col gap-6 px-8 py-8">
      {approvable && ready.length > 0 ? (
        <ApprovalCard
          readyCount={parkingIds.length > 1 ? parkingIds.length : ready.length}
          blockedCount={blocked.length}
          working={working}
          onApprove={onApproveAll}
          t={t}
        />
      ) : null}

      <InvoiceGroup
        title={t("sumReady")}
        invoices={ready}
        emptyLabel={t("noneReady")}
        action={(invoice) =>
          approvable && !parkingIds.includes(invoice.invoiceId) ? (
            <ApproveButton
              onClick={() => onApproveOne(invoice.invoiceId)}
              label={t("approveOne")}
            />
          ) : parkingIds.includes(invoice.invoiceId) ? (
            <Spinner className="h-4 w-4 text-on-surface-faint" />
          ) : null
        }
        t={t}
      />

      <InvoiceGroup
        title={t("sumBlocked")}
        invoices={blocked}
        emptyLabel={t("noneBlocked")}
        action={() => null}
        t={t}
      />

      {parked.length > 0 ? (
        <InvoiceGroup
          title={t("stParked")}
          invoices={parked}
          emptyLabel=""
          action={() => null}
          t={t}
        />
      ) : null}
    </div>
  );
}

function InvoiceGroup({
  title,
  invoices,
  emptyLabel,
  action,
  t,
}: {
  title: string;
  invoices: InvoiceRow[];
  emptyLabel: string;
  action: (invoice: InvoiceRow) => ReactNode;
  t: Translate;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-[12px] border border-outline-variant bg-surface p-5">
      <div className="font-semibold text-[13px] text-on-surface-variant uppercase tracking-[0.1em]">
        {title} ({invoices.length})
      </div>
      {invoices.length === 0 ? (
        <p className="text-[14px] text-on-surface-faint">{emptyLabel}</p>
      ) : (
        <div className="flex flex-col divide-y divide-outline-variant">
          {invoices.map((invoice) => (
            <div key={invoice.invoiceId} className="flex items-center gap-3 py-2.5">
              <span
                className={`flex h-6 w-6 flex-none items-center justify-center rounded-full border ${STATUS_PILL[invoice.status]}`}
              >
                {invoice.status === "blocked" || invoice.status === "parkError" ? (
                  <CrossIcon className="h-3 w-3" />
                ) : (
                  <CheckIcon className="h-3 w-3" />
                )}
              </span>
              <span className="min-w-0 flex-1 truncate font-medium text-[15px] text-on-surface tabular-nums">
                {invoice.supplierInvoiceId}
              </span>
              <span className="hidden min-w-0 flex-1 truncate text-[14px] text-on-surface-faint sm:block">
                {invoice.vendorName ?? invoice.vendor}
              </span>
              <span className="flex-none text-[14px] text-on-surface-variant tabular-nums">
                {invoice.netAmount} {invoice.currency}
              </span>
              {invoice.headline ? (
                <span className="hidden max-w-[28ch] flex-none truncate text-[13px] text-on-surface-faint xl:block">
                  {invoice.headline}
                </span>
              ) : null}
              {action(invoice)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ApproveButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="state-layer pressable flex-none cursor-pointer rounded-[8px] border border-outline px-3 py-1.5 text-[13px] text-on-surface-variant transition-colors hover:border-primary hover:text-primary"
    >
      {label}
    </button>
  );
}
