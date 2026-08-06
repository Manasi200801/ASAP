"use client";

import type { Translate } from "@/lib/i18n";

export function ThemeToggle({
  theme,
  onToggle,
  t,
}: {
  theme: "dark" | "light";
  onToggle: () => void;
  t: Translate;
}) {
  const isLight = theme === "light";

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={t("toggleTheme")}
      title={isLight ? t("themeLight") : t("themeDark")}
      className="pressable relative flex h-8 w-8 flex-none cursor-pointer items-center justify-center rounded-full border border-on-header/25 bg-on-header/10 text-on-header/70 transition-colors hover:bg-on-header/15 hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
    >
      <span className="relative block h-4 w-4" aria-hidden="true">
        <span
          className="absolute inset-0 flex items-center justify-center transition-all duration-200 ease-out"
          style={{
            opacity: isLight ? 0 : 1,
            transform: isLight ? "scale(0.5) rotate(-90deg)" : "scale(1) rotate(0deg)",
          }}
        >
          {/* moon */}
          <svg aria-hidden="true" viewBox="0 0 16 16" width="14" height="14" fill="currentColor">
            <path d="M14 9.7A6.3 6.3 0 0 1 6.3 2a6.3 6.3 0 1 0 7.7 7.7Z" />
          </svg>
        </span>
        <span
          className="absolute inset-0 flex items-center justify-center transition-all duration-200 ease-out"
          style={{
            opacity: isLight ? 1 : 0,
            transform: isLight ? "scale(1) rotate(0deg)" : "scale(0.5) rotate(90deg)",
          }}
        >
          {/* sun */}
          <svg aria-hidden="true" viewBox="0 0 16 16" width="14" height="14" fill="currentColor">
            <circle cx="8" cy="8" r="3.4" />
            <g stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
              <path d="M8 0.8v1.8M8 13.4v1.8M15.2 8h-1.8M2.6 8H0.8M13 3l-1.3 1.3M4.3 11.7 3 13M13 13l-1.3-1.3M4.3 4.3 3 3" />
            </g>
          </svg>
        </span>
      </span>
    </button>
  );
}
