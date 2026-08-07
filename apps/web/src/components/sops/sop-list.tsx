"use client";

import type { SopFile } from "@/lib/sop-types";

export function SopList({
  files,
  selectedKey,
  onSelect,
}: {
  files: SopFile[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="font-data text-[10.5px] text-ink-faint uppercase tracking-[0.14em]">
        Files
      </div>
      {files.length === 0 ? (
        <p className="text-[12.5px] text-ink-dim">No SOP files yet.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {files.map((file) => (
            <li key={file.key}>
              <button
                type="button"
                onClick={() => onSelect(file.key)}
                className={`pressable w-full cursor-pointer rounded-md border px-3 py-2 text-left transition-colors ${
                  file.key === selectedKey
                    ? "border-brass-deep bg-brass/[0.08]"
                    : "border-line bg-surface-2 hover:border-ink-faint"
                }`}
              >
                <div className="truncate text-[13px] text-ink">{file.key}</div>
                <div className="font-data text-[11px] text-ink-faint">
                  {formatSize(file.size)} · {formatDate(file.lastModified)}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}
