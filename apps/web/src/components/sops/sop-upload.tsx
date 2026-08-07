"use client";

import { useRef, useState } from "react";

export function SopUpload({
  existingKeys,
  onUpload,
}: {
  existingKeys: string[];
  onUpload: (key: string, content: string) => Promise<void>;
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
      setError("Only .md files are supported.");
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
            ? "border-primary/45 bg-primary-container text-on-surface"
            : "border-outline text-on-surface-variant"
        }`}
      >
        Upload a new SOP (.md) — click or drop a file
      </div>
      {error ? <p className="text-[12px] text-on-error-container">{error}</p> : null}
      {pending ? (
        <div className="flex items-center gap-2.5 rounded-md border border-error/45 bg-error-container px-3 py-2 text-[12.5px]">
          <span className="text-on-surface-variant">
            This will overwrite <b className="text-on-surface">{pending.key}</b>.
          </span>
          <button
            type="button"
            onClick={confirmOverwrite}
            className="pressable cursor-pointer rounded-full border border-error/45 px-2.5 py-1 text-[11.5px] text-on-error-container"
          >
            Overwrite
          </button>
          <button
            type="button"
            onClick={() => setPending(null)}
            className="cursor-pointer text-[11.5px] text-on-surface-faint"
          >
            Cancel
          </button>
        </div>
      ) : null}
    </div>
  );
}
