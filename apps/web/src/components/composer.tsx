"use client";

import type { Translate } from "@/lib/i18n";
import { useRef, useState } from "react";

/**
 * Never an empty chat box.
 *
 * An empty composer asks a clerk to be inventive at the end of a close day. The
 * drop target, three concrete prompts, and a sample batch remove that demand -
 * and the sample button doubles as the demo's fallback.
 */
export function Composer({
  onSubmit,
  onFiles,
  disabled,
  uploading,
  t,
}: {
  onSubmit: (message?: string) => void;
  onFiles: (files: File[]) => void;
  disabled: boolean;
  uploading: boolean;
  t: Translate;
}) {
  const [value, setValue] = useState("");
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  return (
    <div className="flex flex-col gap-2.5 border-line border-t bg-surface-2 px-4 py-3">
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: the file input below is the keyboard path */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          onFiles(Array.from(e.dataTransfer.files));
        }}
        onClick={() => input.current?.click()}
        className={`flex cursor-pointer flex-wrap items-center gap-3 rounded-md border border-dashed px-3.5 py-3 transition-colors ${
          dragging ? "border-brass bg-brass/[0.06]" : "border-line-strong"
        }`}
      >
        <p className="text-[13px] text-ink-dim">{uploading ? t("uploading") : t("dropHint")}</p>
        <input
          ref={input}
          type="file"
          multiple
          accept="application/pdf,image/png,image/jpeg,image/gif,image/webp"
          className="hidden"
          onChange={(e) => onFiles(Array.from(e.target.files ?? []))}
        />
        <button
          type="button"
          disabled={disabled}
          onClick={(e) => {
            e.stopPropagation();
            onSubmit();
          }}
          className="pressable ml-auto cursor-pointer rounded-full border border-brass-deep bg-brass/[0.08] px-2.5 py-1 font-medium text-[12px] text-brass disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brass"
        >
          {t("loadBatch")}
        </button>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {(["seed1", "seed2", "seed3"] as const).map((key) => (
          <button
            key={key}
            type="button"
            disabled={disabled}
            onClick={() => onSubmit(t(key))}
            className="pressable cursor-pointer rounded-full border border-line bg-surface-3 px-2.5 py-1 text-[12px] text-ink-dim transition-colors hover:border-ink-faint hover:text-ink disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brass"
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
        className="flex items-center gap-2.5 rounded-md border border-line-strong bg-surface-1 px-3 py-2.5 transition-colors focus-within:border-brass-deep"
      >
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={t("askPlaceholder")}
          aria-label={t("askPlaceholder")}
          className="flex-1 bg-transparent text-ink outline-none placeholder:text-ink-faint"
        />
      </form>
    </div>
  );
}
