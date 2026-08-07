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
import type { Duplicate } from "@/lib/use-run";
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
  const fileInput = useRef<HTMLInputElement>(null);
  // Filename -> object URL, for documents actually dropped in this browser
  // session. The sample batch and anything from an earlier reload has no
  // File object to build one from, and the detail view says so rather than
  // showing a placeholder image in its place.
  const previewUrls = useRef<Map<string, string>>(new Map());

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
  }

  // The run on screen becomes a history entry the moment it is about to be
  // replaced, never before - a run still being watched is not history yet.
  function resetForNewRun() {
    if (run.invoices.length > 0) {
      setHistory((prev) => [
        {
          runId: run.runId ?? "unknown",
          reference: run.reference,
          at: Date.now(),
          invoices: run.invoices,
          summary: run.summary,
        },
        ...prev,
      ]);
    }
    clearPreviews();
    setSelectedInvoiceId(null);
    reset();
  }

  async function begin() {
    resetForNewRun();
    setFiles([]);
    setRepeats([]);
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
    const url = previewUrls.current.get(invoice.file);
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
              onAsk={(question) => ask(locale, question)}
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
