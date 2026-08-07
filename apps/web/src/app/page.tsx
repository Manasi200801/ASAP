"use client";

import { ApprovalWorkflowView } from "@/components/approval-workflow";
import { BatchUploadView } from "@/components/batch-upload-view";
import { ChatPanel } from "@/components/chat-panel";
import { CommandCenterView } from "@/components/command-center";
import { HistoryView } from "@/components/history-view";
import type { HistoryEntry } from "@/components/history-view";
import { AlertIcon } from "@/components/icons";
import { Sidebar } from "@/components/sidebar";
import type { View } from "@/components/sidebar";
import { Topbar } from "@/components/topbar";
import { ValidationQueueView } from "@/components/validation-queue";
import { MAX_FILES } from "@/lib/events";
import { useLocale } from "@/lib/i18n";
import type { Duplicate, Run } from "@/lib/use-run";
import { useRun } from "@/lib/use-run";
import { useEffect, useRef, useState } from "react";

export default function Page() {
  const { locale, setLocale, t } = useLocale();
  const { run, start, upload, ask, approve, reset, fail } = useRun();
  const [files, setFiles] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [repeats, setRepeats] = useState<Duplicate[]>([]);
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [view, setView] = useState<View>("command");
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [chatOpen, setChatOpen] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [isSample, setIsSample] = useState(false);
  // Blocked invoice ids the clerk has already opened the bell dropdown for -
  // the badge counts what is new since the last time it was opened, not "how
  // many are blocked right now" forever.
  const [seenBlockedIds, setSeenBlockedIds] = useState<Set<string>>(new Set());
  // Invoice id -> presigned S3 GET, for documents this browser tab did not
  // itself drop (a page reload, or a run someone else's upload started) but
  // that genuinely exist in the bucket `/api/upload` wrote them to.
  const [s3Previews, setS3Previews] = useState<Record<string, string>>({});
  const fileInput = useRef<HTMLInputElement>(null);
  // Filename -> object URL, for documents actually dropped in this browser
  // session. Cheaper than a round trip to S3 and available before the upload
  // has even finished, so it is tried first; the presigned fetch below only
  // runs for invoices it does not cover.
  const previewUrls = useRef<Map<string, string>>(new Map());
  const previewRequested = useRef<Set<string>>(new Set());
  // Which runs have already been written to history - a run logged the
  // moment it finishes parking must not be logged again when it is replaced
  // by the next one.
  const loggedRunIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    const saved = window.localStorage.getItem("theme");
    if (saved === "light" || saved === "dark") setTheme(saved);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem("theme", theme);
  }, [theme]);

  useEffect(() => {
    const map = previewUrls.current;
    return () => {
      for (const url of map.values()) URL.revokeObjectURL(url);
    };
  }, []);

  // A real batch's documents live at `runs/<runId>/<file>`; the sample
  // batch's live at the bucket root - the workshop stack provisions all six
  // `fpl-invoice-0{1..6}.pdf` originals there, so this needs no run to scope
  // a key to and no copy of its own.
  useEffect(() => {
    if (!isSample && !run.runId) return;
    for (const invoice of run.invoices) {
      if (previewUrls.current.has(invoice.file)) continue;
      if (previewRequested.current.has(invoice.invoiceId)) continue;
      previewRequested.current.add(invoice.invoiceId);

      const query = isSample
        ? `sample=true&file=${encodeURIComponent(invoice.file)}`
        : `runId=${encodeURIComponent(run.runId ?? "")}&file=${encodeURIComponent(invoice.file)}`;

      fetch(`/api/preview?${query}`)
        .then((response) => (response.ok ? response.json() : null))
        .then((body: { url: string } | null) => {
          if (!body) return;
          setS3Previews((prev) => ({ ...prev, [invoice.invoiceId]: body.url }));
        })
        .catch(() => {
          // No preview beats a broken one - the "not available" state already
          // covers this.
        });
    }
  }, [run.runId, run.invoices, isSample]);

  // The first invoice a run produces is opened automatically - a queue with
  // six rows and nothing selected makes the clerk click before they can read
  // anything, and the mockup this screen follows never shows that state.
  useEffect(() => {
    if (selectedInvoiceId === null && run.invoices.length > 0) {
      setSelectedInvoiceId(run.invoices[0].invoiceId);
    }
  }, [run.invoices, selectedInvoiceId]);

  const busy =
    uploading ||
    run.state === "extracting" ||
    run.state === "validating" ||
    run.state === "posting";
  const started = run.state !== "idle" || uploading || run.messages.length > 0;
  const statusMessages = run.messages.filter((m) => m.role === "agent" && m.kind === "status");
  const chatMessages = run.messages.filter((m) => !(m.role === "agent" && m.kind === "status"));

  const remainingReadyIds = run.readyIds.filter(
    (id) => run.invoices.find((i) => i.invoiceId === id)?.status !== "parked",
  );
  const approvable = run.state === "awaiting-approval" || run.state === "posting";
  const blockedInvoices = run.invoices.filter(
    (i) => i.status === "blocked" || i.status === "parkError",
  );
  const unseenBlockedCount = blockedInvoices.filter((i) => !seenBlockedIds.has(i.invoiceId)).length;

  const queryMatches = (invoice: (typeof run.invoices)[number]) => {
    const query = search.trim().toLowerCase();
    if (!query) return true;
    return [invoice.supplierInvoiceId, invoice.vendor, invoice.vendorName, invoice.purchaseOrder]
      .filter(Boolean)
      .some((field) => field?.toLowerCase().includes(query));
  };
  const queueInvoices = run.invoices.filter(queryMatches);

  function clearPreviews() {
    for (const url of previewUrls.current.values()) URL.revokeObjectURL(url);
    previewUrls.current = new Map();
    previewRequested.current = new Set();
    setS3Previews({});
    setSeenBlockedIds(new Set());
  }

  // Logged once per run, from whichever happens first: the run finishing on
  // its own (every ready invoice parked) or the clerk replacing it with a new
  // one before that ever happened. Either way a run is never logged twice -
  // `loggedRunIds` is what the "done" watcher and a reset agree on.
  function logToHistory(toLog: Run) {
    if (toLog.invoices.length === 0 || !toLog.runId) return;
    if (loggedRunIds.current.has(toLog.runId)) return;
    loggedRunIds.current.add(toLog.runId);
    setHistory((prev) => [
      {
        runId: toLog.runId ?? "unknown",
        reference: toLog.reference,
        at: Date.now(),
        invoices: toLog.invoices,
        summary: toLog.summary,
      },
      ...prev,
    ]);
  }

  // The moment every ready invoice has actually been parked - not "approved",
  // parked - this run is complete and belongs in history whether or not the
  // clerk ever starts another one. `logToHistory` is not memoized, but it
  // only touches a ref and a setter, both stable, so omitting it here never
  // hides a real dependency.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see above
  useEffect(() => {
    if (run.state === "done") logToHistory(run);
  }, [run]);

  function resetForNewRun() {
    logToHistory(run);
    clearPreviews();
    setSelectedInvoiceId(null);
    reset();
  }

  async function begin() {
    resetForNewRun();
    setFiles([]);
    setRepeats([]);
    setIsSample(true);
    setView("queue");
    await start(locale, undefined, { sample: true });
  }

  async function onFiles(dropped: File[]) {
    if (dropped.length === 0) return;

    if (dropped.length > MAX_FILES) {
      resetForNewRun();
      fail(t("tooMany", { max: MAX_FILES }));
      return;
    }

    const runId = `r_${Math.random().toString(36).slice(2, 8)}`;
    resetForNewRun();
    setRepeats([]);
    setIsSample(false);
    setFiles(dropped.map((f) => f.name));
    for (const file of dropped) {
      previewUrls.current.set(file.name, URL.createObjectURL(file));
    }
    setUploading(true);
    setView("queue");

    try {
      const { keys, duplicates } = await upload(runId, dropped);
      setUploading(false);
      setRepeats(duplicates);

      if (keys.length === 0) {
        fail(t("allDuplicates"));
        return;
      }

      await start(locale, undefined, { keys, runId });
    } catch (error) {
      setUploading(false);
      fail(error instanceof Error ? error.message : t("uploadFailed"));
    }
  }

  const previewMap: Record<string, string> = {};
  for (const invoice of run.invoices) {
    const url = previewUrls.current.get(invoice.file) ?? s3Previews[invoice.invoiceId];
    if (url) previewMap[invoice.invoiceId] = url;
  }

  return (
    <div className="flex h-screen w-full overflow-hidden bg-surface">
      <Sidebar
        view={view}
        onNavigate={setView}
        active={busy}
        queueCount={run.invoices.length}
        approvalCount={approvable ? remainingReadyIds.length : 0}
        t={t}
      />

      <div className="flex min-h-0 flex-1 flex-col">
        <div className="h-[3px] flex-none">
          {busy ? (
            <div className="progress-track h-full w-full">
              <div className="progress-indicator h-full w-1/3" />
            </div>
          ) : null}
        </div>

        <Topbar
          search={search}
          onSearch={setSearch}
          blocked={blockedInvoices}
          unseenCount={unseenBlockedCount}
          onOpenNotifications={() =>
            setSeenBlockedIds(new Set(blockedInvoices.map((i) => i.invoiceId)))
          }
          onSelectInvoice={(id) => {
            setSelectedInvoiceId(id);
            setView("queue");
          }}
          theme={theme}
          onToggleTheme={() => setTheme((p) => (p === "dark" ? "light" : "dark"))}
          locale={locale}
          onLocale={setLocale}
          t={t}
        />

        {run.error ? (
          <div
            role="alert"
            className="enter flex flex-none items-start gap-3 border-error/40 border-b bg-error/[0.08] px-6 py-3"
          >
            <AlertIcon className="mt-0.5 h-5 w-5 flex-none text-error" />
            <p className="max-w-[70ch] text-[15px] text-on-surface leading-6">{run.error}</p>
          </div>
        ) : null}

        {run.state === "awaiting-approval" &&
        remainingReadyIds.length > 0 &&
        view !== "approval" ? (
          <button
            type="button"
            onClick={() => setView("approval")}
            className="state-layer flex flex-none cursor-pointer items-center justify-between gap-3 border-primary/30 border-b bg-primary/[0.06] px-6 py-2.5 text-left text-[14px] text-on-surface"
          >
            <span>{t("approveLabel", { count: remainingReadyIds.length })}</span>
            <span className="font-semibold text-primary">{t("navApproval")} →</span>
          </button>
        ) : null}

        <div className="flex min-h-0 flex-1 overflow-hidden">
          {view === "command" ? (
            <div className="min-h-0 flex-1 overflow-y-auto">
              <CommandCenterView
                state={run.state}
                started={started}
                invoices={run.invoices}
                summary={run.summary}
                statusMessages={statusMessages}
                onUpload={() => setView("upload")}
                onSample={begin}
                onOpenQueue={() => setView("queue")}
                t={t}
              />
            </div>
          ) : null}

          {view === "upload" ? (
            <div className="min-h-0 flex-1 overflow-y-auto">
              <BatchUploadView
                files={files}
                repeats={repeats}
                dragging={dragging}
                uploading={uploading}
                disabled={busy || run.answering}
                fileInput={fileInput}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragging(false);
                  onFiles(Array.from(e.dataTransfer.files));
                }}
                onPick={() => fileInput.current?.click()}
                onFiles={onFiles}
                onSample={begin}
                t={t}
              />
            </div>
          ) : null}

          {view === "queue" ? (
            <ValidationQueueView
              invoices={queueInvoices}
              selectedId={selectedInvoiceId}
              onSelect={setSelectedInvoiceId}
              approvable={approvable}
              parkingIds={run.parkingIds}
              onApprove={(id) => approve([id])}
              onAsk={(question) => {
                // These buttons put a real question to the agent, and the
                // answer lands in the chat panel - opening it is what makes
                // that visible instead of a click that appears to do nothing
                // while the panel sits closed off-screen.
                setChatOpen(true);
                ask(locale, question);
              }}
              asking={busy || run.answering}
              previewUrls={previewMap}
              t={t}
            />
          ) : null}

          {view === "approval" ? (
            <div className="min-h-0 flex-1 overflow-y-auto">
              <ApprovalWorkflowView
                invoices={run.invoices}
                readyIds={remainingReadyIds}
                blockedIds={run.blockedIds}
                parkingIds={run.parkingIds}
                working={run.state === "posting"}
                onApproveAll={() => approve(remainingReadyIds)}
                onApproveOne={(id) => approve([id])}
                approvable={approvable}
                t={t}
              />
            </div>
          ) : null}

          {view === "history" ? (
            <div className="min-h-0 flex-1 overflow-y-auto">
              <HistoryView entries={history} t={t} />
            </div>
          ) : null}
        </div>
      </div>

      <ChatPanel
        open={chatOpen}
        onToggle={() => setChatOpen((o) => !o)}
        messages={chatMessages}
        onSubmit={(message) => (message ? ask(locale, message) : begin())}
        hasRun={Boolean(run.runId)}
        disabled={busy || run.answering}
        t={t}
      />
    </div>
  );
}
