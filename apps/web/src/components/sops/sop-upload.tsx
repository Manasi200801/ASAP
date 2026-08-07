"use client";

import type { Translate } from "@/lib/i18n";
import { useRef, useState } from "react";

export function SopUpload({
  existingKeys,
  onUpload,
  t,
}: {
  existingKeys: string[];
  onUpload: (key: string, content: string) => Promise<void>;
  t: Translate;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [pending, setPending] = useState<{ key: string; content: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleFiles(files: File[]) {
    setError(null);
    const file = files[0];
    if (!file) return;
    if (!file.name.endsWith(".md")) {
      setError(t("sopsOnlyMd"));
      return;
    }
    const content = await file.text();
    if (existingKeys.includes(file.name)) {
      setPending({ key: file.name, content });
      return;
    }
    await onUpload(file.name, content);
  }

  async function confirmOverwrite() {
    if (!pending) return;
    await onUpload(pending.key, pending.content);
    setPending(null);
  }

  return (
    <div className="flex flex-col gap-2">
      <input
        ref={input}
        type="file"
        accept=".md"
        className="hidden"
        onChange={(e) => handleFiles(Array.from(e.target.files ?? []))}
      />
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: the file input above is the keyboard path */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          handleFiles(Array.from(e.dataTransfer.files));
        }}
        onClick={() => input.current?.click()}
        className={`cursor-pointer rounded-md border border-dashed px-3.5 py-3 text-left text-[13px] transition-colors ${
          dragging
            ? "border-primary bg-primary/[0.06] text-on-surface"
            : "border-outline text-on-surface-variant"
        }`}
      >
        {t("sopsUploadHint")}
      </div>
      {error ? <p className="text-[12px] text-error">{error}</p> : null}
      {pending ? (
        <div className="flex items-center gap-2.5 rounded-md border border-error/40 bg-error/[0.06] px-3 py-2 text-[12.5px]">
          <span className="text-on-surface-variant">
            {t("sopsOverwriteWarn", { key: pending.key })}
          </span>
          <button
            type="button"
            onClick={confirmOverwrite}
            className="pressable cursor-pointer rounded-full border border-error px-2.5 py-1 text-[11.5px] text-error"
          >
            {t("sopsOverwrite")}
          </button>
          <button
            type="button"
            onClick={() => setPending(null)}
            className="cursor-pointer text-[11.5px] text-on-surface-faint"
          >
            {t("sopsCancel")}
          </button>
        </div>
      ) : null}
    </div>
  );
}
