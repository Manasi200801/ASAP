"use client";

import type { Translate } from "@/lib/i18n";
import type { Duplicate } from "@/lib/use-run";
import type { RefObject } from "react";
import { BatchIcon, UploadIcon } from "./icons";
import { Spinner } from "./spinner";

export function BatchUploadView({
  files,
  repeats,
  dragging,
  uploading,
  disabled,
  fileInput,
  onDragOver,
  onDragLeave,
  onDrop,
  onPick,
  onFiles,
  onSample,
  t,
}: {
  files: string[];
  repeats: Duplicate[];
  dragging: boolean;
  uploading: boolean;
  disabled: boolean;
  fileInput: RefObject<HTMLInputElement | null>;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent) => void;
  onPick: () => void;
  onFiles: (files: File[]) => void;
  onSample: () => void;
  t: Translate;
}) {
  return (
    <div className="enter mx-auto flex w-full max-w-[820px] flex-col gap-6 px-8 py-10">
      <div className="flex flex-col gap-2">
        <h1 className="font-semibold text-[26px] text-on-surface tracking-[-0.01em]">
          {t("navUpload")}
        </h1>
        <p className="max-w-[64ch] text-[16px] text-on-surface-variant leading-6">
          {t("dropHint")}
        </p>
      </div>

      <input
        ref={fileInput}
        type="file"
        multiple
        accept="application/pdf,image/png,image/jpeg,image/gif,image/webp"
        className="hidden"
        onChange={(e) => {
          onFiles(Array.from(e.target.files ?? []));
          e.target.value = "";
        }}
      />

      <div
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        className={`flex flex-col items-center gap-4 rounded-[16px] border-2 border-dashed px-8 py-14 text-center transition-colors ${
          dragging
            ? "border-primary bg-primary/[0.06]"
            : "border-outline-variant bg-surface-container-low"
        }`}
      >
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-primary-container text-on-primary-container">
          {uploading ? <Spinner className="h-5 w-5" /> : <UploadIcon className="h-5 w-5" />}
        </span>
        <p className="text-[16px] text-on-surface-variant">{t("dropHint")}</p>

        <div className="flex flex-wrap justify-center gap-3">
          <button
            type="button"
            disabled={disabled}
            onClick={onPick}
            className="state-layer pressable flex min-h-[44px] cursor-pointer items-center gap-2 rounded-full bg-primary px-5 font-semibold text-[15px] text-on-primary transition-opacity disabled:opacity-50"
          >
            {uploading ? <Spinner className="h-4 w-4" /> : <UploadIcon className="h-4 w-4" />}
            {uploading ? t("uploading") : t("uploadFiles")}
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={onSample}
            className="state-layer pressable flex min-h-[44px] cursor-pointer items-center gap-2 rounded-full border border-outline px-5 font-semibold text-[15px] text-on-surface-variant transition-colors hover:border-on-surface-variant hover:text-on-surface disabled:opacity-50"
          >
            <BatchIcon className="h-4 w-4" />
            {t("loadBatch")}
          </button>
        </div>
      </div>

      {files.length > 0 ? (
        <div className="flex flex-col gap-2.5">
          <div className="font-semibold text-[13px] text-on-surface-faint uppercase tracking-[0.12em]">
            {t("you")}
          </div>
          <div className="flex flex-wrap gap-2">
            {files.map((name, index) => {
              const repeat = repeats.find((d) => d.name === name);
              return (
                <span
                  key={name}
                  style={{ animationDelay: `${index * 30}ms` }}
                  className={`chip-in rounded-[8px] border border-outline-variant bg-surface-container px-2.5 py-1.5 text-[15px] ${
                    repeat ? "text-on-surface-faint line-through" : "text-on-surface-variant"
                  }`}
                  title={repeat ? t("duplicateOf", { of: repeat.of }) : undefined}
                >
                  {name}
                </span>
              );
            })}
          </div>
          {repeats.length > 0 ? (
            <p className="max-w-[70ch] text-[16px] text-on-surface-variant">
              {t("duplicatesSkipped", { count: repeats.length })}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
