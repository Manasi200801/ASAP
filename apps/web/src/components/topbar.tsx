"use client";

import type { InvoiceRow } from "@/lib/events";
import type { Locale, Translate } from "@/lib/i18n";
import { useState } from "react";
import { BellIcon, ProfileIcon, SearchIcon } from "./icons";
import { LocaleSwitch } from "./locale-switch";
import { ThemeToggle } from "./theme-toggle";

/**
 * Search filters the invoices already on screen - there is no cross-run
 * index the browser can query, so it never pretends to search further than
 * the current run's own table.
 *
 * The bell is the exception queue, not a general notification feed: it lists
 * exactly the invoices a rule actually blocked (or failed to park), because
 * that is the one thing on this screen a person has to act on. Empty is a
 * real state, not a loading one - a clean batch has nothing to show here.
 */
export function Topbar({
  search,
  onSearch,
  blocked,
  onSelectInvoice,
  theme,
  onToggleTheme,
  locale,
  onLocale,
  t,
}: {
  search: string;
  onSearch: (value: string) => void;
  blocked: InvoiceRow[];
  onSelectInvoice: (invoiceId: string) => void;
  theme: "dark" | "light";
  onToggleTheme: () => void;
  locale: Locale;
  onLocale: (locale: Locale) => void;
  t: Translate;
}) {
  const [open, setOpen] = useState(false);

  return (
    <header className="flex flex-none items-center gap-4 border-outline-variant border-b bg-surface px-6 py-3">
      <div className="relative w-full max-w-[420px]">
        <SearchIcon className="-translate-y-1/2 pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 text-on-surface-faint" />
        <input
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder={t("searchPlaceholder")}
          aria-label={t("searchPlaceholder")}
          className="min-h-[42px] w-full rounded-full border border-outline-variant bg-surface-container-low pr-4 pl-10 text-[15px] text-on-surface outline-none transition-colors placeholder:text-on-surface-faint focus:border-primary"
        />
      </div>

      <div className="ml-auto flex flex-none items-center gap-2.5">
        <div className="relative">
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            aria-label={t("blockedCount", { count: blocked.length })}
            title={t("blockedCount", { count: blocked.length })}
            className="state-layer pressable relative flex h-10 w-10 flex-none cursor-pointer items-center justify-center rounded-full border border-outline-variant bg-surface-container text-on-surface-variant transition-colors hover:border-outline hover:text-on-surface focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            <BellIcon className="h-[18px] w-[18px]" />
            {blocked.length > 0 ? (
              <span className="-top-1 -right-1 absolute flex h-4 min-w-4 items-center justify-center rounded-full bg-error px-1 font-semibold text-[10px] text-on-error tabular-nums">
                {blocked.length}
              </span>
            ) : null}
          </button>

          {open ? (
            <>
              <button
                type="button"
                tabIndex={-1}
                aria-hidden="true"
                onClick={() => setOpen(false)}
                className="fixed inset-0 z-40 cursor-default"
              />
              <div className="elevated-2 absolute top-full right-0 z-50 mt-2 w-[320px] rounded-[12px] border border-outline-variant bg-surface py-2">
                <div className="px-4 py-2 font-semibold text-[13px] text-on-surface-variant uppercase tracking-[0.08em]">
                  {t("exceptions")}
                </div>
                {blocked.length === 0 ? (
                  <p className="px-4 py-3 text-[14px] text-on-surface-faint">{t("noExceptions")}</p>
                ) : (
                  <div className="flex max-h-[320px] flex-col overflow-y-auto">
                    {blocked.map((invoice) => (
                      <button
                        key={invoice.invoiceId}
                        type="button"
                        onClick={() => {
                          onSelectInvoice(invoice.invoiceId);
                          setOpen(false);
                        }}
                        className="state-layer flex cursor-pointer flex-col gap-0.5 px-4 py-2.5 text-left transition-colors hover:bg-surface-container"
                      >
                        <span className="font-medium text-[14px] text-on-surface tabular-nums">
                          {invoice.supplierInvoiceId}
                        </span>
                        <span className="truncate text-[13px] text-on-surface-faint">
                          {invoice.headline ?? invoice.vendorName ?? invoice.vendor}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : null}
        </div>

        <div className="mx-1 h-6 w-px flex-none bg-outline-variant" aria-hidden="true" />

        <LocaleSwitch locale={locale} onChange={onLocale} />
        <ThemeToggle theme={theme} onToggle={onToggleTheme} t={t} />

        <span className="flex h-10 w-10 flex-none items-center justify-center rounded-full border border-outline-variant bg-surface-container-high text-on-surface-variant">
          <ProfileIcon className="h-[18px] w-[18px]" />
        </span>
      </div>
    </header>
  );
}
