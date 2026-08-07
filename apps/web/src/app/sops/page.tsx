"use client";

import { KbSyncBar } from "@/components/sops/kb-sync-bar";
import { SopEditor } from "@/components/sops/sop-editor";
import { SopList } from "@/components/sops/sop-list";
import { SopUpload } from "@/components/sops/sop-upload";
import type { SopFile } from "@/lib/sop-types";
import Link from "next/link";
import { useEffect, useState } from "react";

export default function SopsPage() {
  const [files, setFiles] = useState<SopFile[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [unsyncedCount, setUnsyncedCount] = useState(0);

  useEffect(() => {
    refreshList();
  }, []);

  async function refreshList() {
    const response = await fetch("/api/sops");
    const body = await response.json();
    if (!response.ok) {
      setLoadError(body.message ?? "Could not load SOP files.");
      return;
    }
    setLoadError(null);
    setFiles(body.files);
  }

  async function selectFile(key: string) {
    setSelectedKey(key);
    const response = await fetch(`/api/sops/${encodeURIComponent(key)}`);
    const body = await response.json();
    if (!response.ok) {
      setLoadError(body.message ?? "Could not load the file.");
      return;
    }
    setLoadError(null);
    setContent(body.content);
  }

  async function save(key: string, nextContent: string) {
    const response = await fetch(`/api/sops/${encodeURIComponent(key)}`, {
      method: "PUT",
      body: nextContent,
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.message ?? "Save failed.");
    setUnsyncedCount((count) => count + 1);
    await refreshList();
  }

  async function upload(key: string, uploadContent: string) {
    await save(key, uploadContent);
    setSelectedKey(key);
    setContent(uploadContent);
  }

  return (
    <main className="mx-auto max-w-[1080px] px-5 pb-24">
      <section className="mt-10 overflow-hidden rounded-lg border border-line bg-surface-1">
        <header className="flex flex-wrap items-center gap-4 border-line border-b bg-surface-2 px-4 py-3">
          <div className="font-data text-[12px] uppercase tracking-[0.12em]">
            STRIKE <span className="text-brass">AP</span> · SOPs
          </div>
          <Link href="/" className="ml-auto font-data text-[11.5px] text-ink-dim hover:text-ink">
            ← Back
          </Link>
        </header>

        <div className="flex flex-col gap-4 px-4 py-5">
          <KbSyncBar unsyncedCount={unsyncedCount} onSynced={() => setUnsyncedCount(0)} />

          {loadError ? <p className="text-[12.5px] text-blocked">{loadError}</p> : null}

          <SopUpload existingKeys={files.map((f) => f.key)} onUpload={upload} />

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[260px_1fr]">
            <SopList files={files} selectedKey={selectedKey} onSelect={selectFile} />
            {selectedKey ? (
              <SopEditor fileKey={selectedKey} content={content} onSave={save} />
            ) : (
              <p className="text-[13px] text-ink-dim">Select a file to edit it.</p>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}
