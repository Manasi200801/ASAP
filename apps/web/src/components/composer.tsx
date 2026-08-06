"use client";

import type { Translate } from "@/lib/i18n";
import { useState } from "react";

/**
 * Never an empty chat box.
 *
 * An empty composer asks a clerk to be inventive at the end of a close day.
 * The three concrete prompts remove that demand - uploading itself lives in
 * the action bar at the top of the screen, not down here.
 */
export function Composer({
  onSubmit,
  hasRun,
  disabled,
  t,
}: {
  /** A message asks a question. No message runs the sample batch. */
  onSubmit: (message?: string) => void;
  /** Whether there is a batch to ask questions about. */
  hasRun: boolean;
  disabled: boolean;
  t: Translate;
}) {
  const [value, setValue] = useState("");

  return (
    <div className="flex flex-col gap-3 border-outline-variant border-t bg-surface-container-low px-6 py-4">
      {/* Before a batch: the one thing worth doing. After it: the two questions
          worth asking. Offering "why was FPL-9999 blocked?" on an empty screen
          invites a click that can only be answered by first running a batch the
          user never asked for. */}
      <div className="flex flex-wrap gap-1.5">
        {(hasRun ? (["seed2", "seed3"] as const) : (["seed1"] as const)).map((key) => (
          <button
            key={key}
            type="button"
            disabled={disabled}
            // seed1 is the batch itself, not a question about one.
            onClick={() => onSubmit(key === "seed1" ? undefined : t(key))}
            className="state-layer pressable cursor-pointer rounded-[8px] border border-outline px-3.5 py-1.5 text-[14px] text-on-surface-variant transition-colors hover:text-on-surface disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
          >
            {t(key)}
          </button>
        ))}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!value.trim()) return;
          onSubmit(value);
          setValue("");
        }}
        className="flex items-center gap-2.5 rounded-[4px] border border-outline bg-surface-container-low px-4 py-3.5 transition-colors focus-within:border-primary"
      >
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={t("askPlaceholder")}
          aria-label={t("askPlaceholder")}
          className="flex-1 bg-transparent text-[16px] text-on-surface outline-none placeholder:text-on-surface-faint"
        />
      </form>
    </div>
  );
}
