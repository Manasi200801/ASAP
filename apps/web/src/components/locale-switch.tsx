"use client";

import type { Locale } from "@/lib/i18n";

const OPTIONS: readonly Locale[] = ["en", "de"];

/**
 * Sits on the header bar, not the page surface.
 *
 * The active language is a solid `primary` pill - the same yellow-family
 * accent as everywhere else - so it reads clearly whether the bar behind it
 * is dark navy or AWS blue. The frame and the idle label are on-header
 * opacity steps rather than surface tokens, since surface colors (built for
 * the white/navy page background) would go muddy against a blue header.
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
    <div className="relative flex rounded-full border border-on-header/25 bg-on-header/10 p-0.5">
      <span
        aria-hidden="true"
        className="absolute inset-y-0.5 left-0.5 w-9 rounded-full bg-primary shadow-sm transition-transform duration-200 [transition-timing-function:var(--ease-in-out)]"
        style={{ transform: `translateX(${index * 100}%)` }}
      />
      {OPTIONS.map((code) => (
        <button
          key={code}
          type="button"
          aria-pressed={locale === code}
          onClick={() => onChange(code)}
          className={`pressable relative z-10 w-9 cursor-pointer rounded-full py-1.5 text-center font-semibold text-[13px] tracking-[0.04em] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary ${
            locale === code
              ? "text-on-primary"
              : "text-on-header/70 hover:bg-on-header/15 hover:text-on-header"
          }`}
        >
          {code.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
