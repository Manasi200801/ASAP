"use client";

import type { Translate } from "@/lib/i18n";
import type { SopFile } from "@/lib/sop-types";

export function SopList({
  files,
  selectedKey,
  onSelect,
  t,
}: {
  files: SopFile[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
  t: Translate;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="text-[10.5px] text-on-surface-faint uppercase tracking-[0.14em]">
        {t("sopsFiles")}
      </div>
      {files.length === 0 ? (
        <p className="text-[12.5px] text-on-surface-variant">{t("sopsEmpty")}</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {files.map((file) => (
            <li key={file.key}>
              <button
                type="button"
                onClick={() => onSelect(file.key)}
                className={`pressable w-full cursor-pointer rounded-md border px-3 py-2 text-left transition-colors ${
                  file.key === selectedKey
                    ? "border-primary/40 bg-primary/[0.08]"
                    : "border-outline-variant bg-surface-container-low hover:border-on-surface-faint"
                }`}
              >
                <div className="truncate text-[13px] text-on-surface">{file.key}</div>
                <div className="text-[11px] text-on-surface-faint">
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
