"use client";

import type { Translate } from "@/lib/i18n";
import { useEffect, useState } from "react";

export function SopEditor({
  fileKey,
  content,
  onSave,
  t,
}: {
  fileKey: string;
  content: string;
  onSave: (key: string, content: string) => Promise<void>;
  t: Translate;
}) {
  const [draft, setDraft] = useState(content);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  // A newly selected file replaces the draft; re-renders of the same file must
  // not clobber an unsaved edit, so this only resets when the key changes.
  useEffect(() => {
    setDraft(content);
    setState("idle");
    setError(null);
    // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally keyed on fileKey only
  }, [fileKey]);

  async function save() {
    setState("saving");
    setError(null);
    try {
      await onSave(fileKey, draft);
      setState("saved");
    } catch (err) {
      setState("error");
      setError(err instanceof Error ? err.message : t("sopsSaveFailed"));
    }
  }

  return (
    <div className="flex flex-1 flex-col gap-2.5">
      <div className="flex items-center justify-between">
        <div className="text-[10.5px] text-on-surface-faint uppercase tracking-[0.14em]">
          {fileKey}
        </div>
        <div className="flex items-center gap-2.5">
          {state === "saved" ? (
            <span className="text-[12px] text-success">{t("sopsSaved")}</span>
          ) : null}
          {state === "error" && error ? (
            <span className="text-[12px] text-error">{error}</span>
          ) : null}
          <button
            type="button"
            onClick={save}
            disabled={state === "saving"}
            className="pressable cursor-pointer rounded-full border border-primary/40 bg-primary/[0.08] px-3 py-1 font-medium text-[12px] text-primary disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
          >
            {state === "saving" ? t("sopsSaving") : t("sopsSave")}
          </button>
        </div>
      </div>
      <textarea
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          setState("idle");
        }}
        spellCheck={false}
        className="min-h-[420px] flex-1 rounded-md border border-outline bg-surface p-3 text-[12.5px] text-on-surface outline-none focus:border-primary/40"
      />
    </div>
  );
}
