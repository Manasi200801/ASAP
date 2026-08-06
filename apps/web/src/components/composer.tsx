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
  t,
}: {
  onSubmit: (message?: string) => void;
  onFiles: (files: File[]) => void;
  disabled: boolean;
  t: Translate;
}) {
  const [value, setValue] = useState("");
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  return (
    <div className="flex flex-col gap-3 border-outline-variant border-t bg-surface-container-low px-6 py-4">
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
        className={`flex cursor-pointer flex-wrap items-center gap-3 rounded-[8px] border border-dashed px-4 py-3.5 transition-colors ${
          dragging ? "border-primary bg-primary/[0.06]" : "border-outline"
        }`}
      >
        <p className="text-[15px] text-on-surface-variant">{t("dropHint")}</p>
        <input
          ref={input}
          type="file"
          multiple
          accept="application/pdf"
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
          className="state-layer pressable ml-auto cursor-pointer rounded-full bg-secondary-container px-3.5 py-1.5 font-medium text-[14px] text-on-secondary-container disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
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
