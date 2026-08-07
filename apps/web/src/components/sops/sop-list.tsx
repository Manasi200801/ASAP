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
      <div className="font-mono text-[10.5px] text-on-surface-faint uppercase tracking-[0.14em]">
        Files
      </div>
      {files.length === 0 ? (
        <p className="text-[12.5px] text-on-surface-variant">No SOP files yet.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {files.map((file) => (
            <li key={file.key}>
              <button
                type="button"
                onClick={() => onSelect(file.key)}
                className={`pressable w-full cursor-pointer rounded-md border px-3 py-2 text-left transition-colors ${
                  file.key === selectedKey
                    ? "border-primary/45 bg-primary-container"
                    : "border-outline-variant bg-surface-container hover:border-on-surface-variant"
                }`}
              >
                <div className="truncate text-[13px] text-on-surface">{file.key}</div>
                <div className="font-mono text-[11px] text-on-surface-faint">
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
