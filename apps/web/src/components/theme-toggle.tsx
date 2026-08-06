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

  // Hover brightens the label rather than turning it `primary`: orange on the
  // light theme's blue header is 2.8:1, which is a hover state nobody can read
  // across a room. Same reasoning for the focus ring, which is `on-header`
  // because an orange ring on an orange-accented blue bar disappears.
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={t("toggleTheme")}
      title={isLight ? t("themeLight") : t("themeDark")}
      className="pressable relative flex h-10 w-10 flex-none cursor-pointer items-center justify-center rounded-full border border-on-header/30 bg-on-header/10 text-on-header/80 transition-colors hover:bg-on-header/20 hover:text-on-header focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-on-header"
    >
      <span className="relative block h-[18px] w-[18px]" aria-hidden="true">
        <span
          className="absolute inset-0 flex items-center justify-center transition-all duration-200 ease-out"
          style={{
            opacity: isLight ? 0 : 1,
            transform: isLight ? "scale(0.5) rotate(-90deg)" : "scale(1) rotate(0deg)",
          }}
        >
          {/* moon */}
          <svg aria-hidden="true" viewBox="0 0 16 16" width="18" height="18" fill="currentColor">
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
          <svg aria-hidden="true" viewBox="0 0 16 16" width="18" height="18" fill="currentColor">
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
