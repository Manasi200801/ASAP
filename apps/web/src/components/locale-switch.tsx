"use client";

import type { Locale } from "@/lib/i18n";

const OPTIONS: readonly Locale[] = ["en", "de"];

/**
 * The active language is a solid `primary` pill - the same accent used for
 * status pills and the approval gate everywhere else - so "this is the
 * selected one" reads the same way here as it does anywhere else in the app.
 */
export function LocaleSwitch({
  locale,
  onChange,
}: {
  locale: Locale;
  onChange: (locale: Locale) => void;
}) {
  const index = OPTIONS.indexOf(locale);

  return (
    <div className="relative flex rounded-full border border-outline-variant bg-surface-container p-0.5">
      <span
        aria-hidden="true"
        className="absolute inset-y-0.5 left-0.5 w-11 rounded-full bg-primary transition-transform duration-200 [transition-timing-function:var(--ease-in-out)]"
        style={{ transform: `translateX(${index * 100}%)` }}
      />
      {OPTIONS.map((code) => (
        <button
          key={code}
          type="button"
          aria-pressed={locale === code}
          onClick={() => onChange(code)}
          className={`pressable relative z-10 min-h-[36px] w-11 cursor-pointer rounded-full text-center font-semibold text-[14px] tracking-[0.04em] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${
            locale === code
              ? "text-on-primary"
              : "text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface"
          }`}
        >
          {code.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
