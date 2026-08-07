"use client";

import { useEffect, useState } from "react";

export function SopEditor({
  fileKey,
  content,
  onSave,
}: {
  fileKey: string;
  content: string;
  onSave: (key: string, content: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState(content);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  // A newly selected file replaces the draft; re-renders of the same file must
  // not clobber an unsaved edit, so this only resets when the key changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally keyed on fileKey only
  useEffect(() => {
    setDraft(content);
    setState("idle");
    setError(null);
  }, [fileKey]);

  async function save() {
    setState("saving");
    setError(null);
    try {
      await onSave(fileKey, draft);
      setState("saved");
    } catch (err) {
      setState("error");
      setError(err instanceof Error ? err.message : "Save failed.");
    }
  }

  return (
    <div className="flex flex-1 flex-col gap-2.5">
      <div className="flex items-center justify-between">
        <div className="font-mono text-[10.5px] text-on-surface-faint uppercase tracking-[0.14em]">
          {fileKey}
        </div>
        <div className="flex items-center gap-2.5">
          {state === "saved" ? (
            <span className="text-[12px] text-on-success-container">Saved</span>
          ) : null}
          {state === "error" && error ? (
            <span className="text-[12px] text-on-error-container">{error}</span>
          ) : null}
          <button
            type="button"
            onClick={save}
            disabled={state === "saving"}
            className="pressable cursor-pointer rounded-full border border-primary/45 bg-primary-container px-3 py-1 font-medium text-[12px] text-on-primary-container disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
          >
            {state === "saving" ? "Saving…" : "Save"}
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
        className="min-h-[420px] flex-1 rounded-md border border-outline bg-surface-container-low p-3 font-mono text-[12.5px] text-on-surface outline-none focus:border-primary/45"
      />
    </div>
  );
}
