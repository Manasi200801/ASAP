"use client";

import { useRef, useState } from "react";

type Phase = "idle" | "starting" | "syncing" | "synced" | "failed" | "timeout";

const POLL_INTERVAL_MS = 3000;
const MAX_POLLS = 120; // ~6 minutes, matching apps/agent/scripts/make_kb.py

export function KbSyncBar({
  unsyncedCount,
  onSynced,
}: {
  unsyncedCount: number;
  onSynced: () => void;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const pollsRef = useRef(0);

  async function sync() {
    setPhase("starting");
    setError(null);
    pollsRef.current = 0;
    try {
      const response = await fetch("/api/sops/sync", { method: "POST" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message ?? "Could not start the sync.");
      setPhase("syncing");
      poll(body.jobId, body.dataSourceId);
    } catch (err) {
      setPhase("failed");
      setError(err instanceof Error ? err.message : "Could not start the sync.");
    }
  }

  async function poll(jobId: string, dataSourceId: string) {
    if (pollsRef.current >= MAX_POLLS) {
      setPhase("timeout");
      return;
    }
    pollsRef.current += 1;
    const response = await fetch(
      `/api/sops/sync?jobId=${encodeURIComponent(jobId)}&dataSourceId=${encodeURIComponent(dataSourceId)}`,
    );
    const body = await response.json();
    if (!response.ok) {
      setPhase("failed");
      setError(body.message ?? "Sync failed.");
      return;
    }
    if (body.status === "COMPLETE") {
      setPhase("synced");
      onSynced();
      return;
    }
    if (body.status === "FAILED") {
      setPhase("failed");
      setError("The ingestion job failed.");
      return;
    }
    setTimeout(() => poll(jobId, dataSourceId), POLL_INTERVAL_MS);
  }

  const busy = phase === "starting" || phase === "syncing";

  return (
    <div className="flex items-center gap-3 rounded-md border border-outline-variant bg-surface-container px-3.5 py-2.5">
      <button
        type="button"
        onClick={sync}
        disabled={busy}
        className="pressable cursor-pointer rounded-full border border-primary/45 bg-primary-container px-3 py-1 font-medium text-[12px] text-on-primary-container disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
      >
        {busy ? "Syncing…" : "Sync knowledge base"}
      </button>
      {unsyncedCount > 0 && !busy ? (
        <span className="font-mono text-[11px] text-on-surface-faint">
          {unsyncedCount} unsynced change{unsyncedCount === 1 ? "" : "s"}
        </span>
      ) : null}
      {phase === "synced" ? (
        <span className="text-[12px] text-on-success-container">Synced</span>
      ) : null}
      {phase === "timeout" ? (
        <span className="text-[12px] text-on-surface-variant">Still running — check back</span>
      ) : null}
      {phase === "failed" && error ? (
        <span className="text-[12px] text-on-error-container">{error}</span>
      ) : null}
    </div>
  );
}
