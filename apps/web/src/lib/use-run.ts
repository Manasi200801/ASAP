"use client";

import { useCallback, useRef, useState } from "react";
import type { InvoiceRow, RunEvent, RunState, ToolCallEvent } from "./events";
import { deriveStatus } from "./events";
import { readEventStream } from "./sse";

export type Summary = Extract<RunEvent, { type: "summary" }>;

/**
 * `streaming` marks the one bubble an answer is currently being typed into.
 * The run's own `text` events are whole sentences and each deserves its own
 * paragraph; an answer arrives as deltas that all have to land in one. Marking
 * the message rather than the run is what makes that safe when a second
 * question arrives before the first answer has finished.
 *
 * `kind` separates the run's own narration from the conversation, so the two
 * can be styled apart.
 */
export type Message = {
  role: "you" | "agent";
  text: string;
  streaming?: boolean;
  kind?: "status" | "chat";
};

/** A file identical to one already seen, and the file it repeats. */
export type Duplicate = { name: string; of: string };

export type UploadResult = { keys: string[]; duplicates: Duplicate[] };

async function sha256(file: File): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export type Run = {
  state: RunState;
  runId: string | null;
  reference: string | null;
  invoices: InvoiceRow[];
  calls: ToolCallEvent[];
  messages: Message[];
  summary: Summary | null;
  readyIds: string[];
  blockedIds: string[];
  error: string | null;
  /** True while an answer is streaming back. Drives the disabled state, nothing else. */
  answering: boolean;
  // Invoice ids currently mid-park, from either the "approve all" button or a
  // single row's own approve button. Drives the per-row spinner.
  parkingIds: string[];
};

const EMPTY: Run = {
  state: "idle",
  runId: null,
  reference: null,
  invoices: [],
  calls: [],
  messages: [],
  summary: null,
  readyIds: [],
  blockedIds: [],
  error: null,
  answering: false,
  parkingIds: [],
};

/**
 * Presign, then PUT each PDF straight to S3, and return the keys the agent
 * should read.
 *
 * Files never touch the Next.js server: no body-size limit and no function
 * payload cap, which is what makes a twenty-invoice batch work at all.
 *
 * Every failure throws. A partial batch is worse than none - the run would
 * validate whatever happened to land and report a clean result over an
 * incomplete set.
 */
async function upload(runId: string, files: File[]): Promise<string[]> {
  const response = await fetch("/api/upload", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ runId, files: files.map((f) => ({ name: f.name, size: f.size })) }),
  });
  if (!response.ok) {
    throw new Error(`Could not prepare the upload (${response.status}).`);
  }

  const { uploads } = (await response.json()) as {
    uploads: { name: string; key: string; url: string }[];
  };
  const byName = new Map(uploads.map((u) => [u.name, u]));

  await Promise.all(
    files.map(async (file) => {
      const target = byName.get(file.name);
      if (!target) throw new Error(`No upload URL for ${file.name}.`);
      const put = await fetch(target.url, {
        method: "PUT",
        headers: { "Content-Type": "application/pdf" },
        body: file,
      });
      // A CORS failure rejects rather than returning a status, and the message
      // the browser gives is "Failed to fetch" - which reads as the server being
      // down. The bucket needs a PUT rule for this origin; see contract/events.md.
      if (!put.ok) throw new Error(`${file.name} did not upload (${put.status}).`);
    }),
  );

  return uploads.map((u) => u.key);
}

function apply(run: Run, event: RunEvent): Run {
  switch (event.type) {
    case "batch":
      return { ...run, state: "extracting", runId: event.runId, reference: event.reference };

    case "invoice":
      return {
        ...run,
        invoices: [...run.invoices, { ...event, rules: [], status: "pending" }],
      };

    case "tool-call": {
      // Keep the rail short; it is a live indicator, not a log viewer.
      const calls = [...run.calls, event].slice(-14);
      if (!event.invoiceId) return { ...run, calls };
      return {
        ...run,
        calls,
        // Started on this invoice's first tool call, not its first rule. The
        // orchestrator does the SAP lookups and every judge call for an invoice
        // *before* it yields a single rule event, then emits all sixteen back to
        // back - timing from the first rule would measure only that final burst
        // and miss the real wait entirely. The tool call fires the moment the
        // orchestrator actually starts on this invoice.
        invoices: run.invoices.map((i) =>
          i.invoiceId === event.invoiceId ? { ...i, startedAt: i.startedAt ?? Date.now() } : i,
        ),
      };
    }

    case "rule":
      return {
        ...run,
        state: "validating",
        invoices: run.invoices.map((i) => {
          if (i.invoiceId !== event.invoiceId) return i;
          const rules = [...i.rules, event];
          // Derive from the chips rather than waiting for `invoice-status`. A row
          // must turn red on the failing chip, mid-cascade — that is the moment
          // the whole interface exists to show. Parked never regresses.
          // Settled verdicts never regress to a derived one.
          const settled = i.status === "parked" || i.status === "parkError";
          const status = settled ? i.status : deriveStatus(rules);
          return {
            ...i,
            rules,
            status,
            // Fallback only - normally already set by this invoice's tool call.
            startedAt: i.startedAt ?? Date.now(),
            finishedAt: i.finishedAt ?? (status === "pending" ? undefined : Date.now()),
          };
        }),
      };

    case "invoice-status":
      return {
        ...run,
        invoices: run.invoices.map((i) =>
          i.invoiceId === event.invoiceId
            ? {
                ...i,
                status: event.status,
                headline: event.headline,
                impact: event.impact,
                detail: event.detail,
                suggestion: event.suggestion,
                startedAt: i.startedAt ?? Date.now(),
                finishedAt: i.finishedAt ?? Date.now(),
              }
            : i,
        ),
      };

    case "summary":
      return { ...run, summary: event };

    case "approval":
      return {
        ...run,
        state: "awaiting-approval",
        readyIds: event.readyIds,
        blockedIds: event.blockedIds,
      };

    case "posting":
      return {
        ...run,
        state: "posting",
        parkingIds: run.parkingIds.filter((id) => id !== event.invoiceId),
        invoices: run.invoices.map((i) => {
          if (i.invoiceId !== event.invoiceId) return i;
          // "error" must land as its own visible status - leaving it on "ready"
          // is what made a failed park look identical to one nobody had touched
          // yet, even though the row's own approve button had already fired. The
          // message is the only thing that says why, and it was being dropped.
          if (event.status === "error") {
            return { ...i, status: "parkError", parkError: event.message };
          }
          if (event.status === "parked") {
            return {
              ...i,
              status: "parked",
              sapDocument: event.sapDocument,
              fiscalYear: event.fiscalYear,
              reference: event.reference,
            };
          }
          return i;
        }),
      };

    case "filed":
      return {
        ...run,
        invoices: run.invoices.map((i) =>
          i.invoiceId === event.invoiceId
            ? {
                ...i,
                filed: { status: event.status, bucket: event.bucket, message: event.message },
              }
            : i,
        ),
      };

    case "text": {
      // Narration emitted while the batch is running (files received, extraction,
      // validation) is process status, not conversation - it renders in its own
      // live-status panel. Anything else is a real answer to a question asked.
      const kind: Message["kind"] =
        run.state === "extracting" || run.state === "validating" || run.state === "posting"
          ? "status"
          : "chat";
      const last = run.messages.at(-1);
      if (last?.role === "agent" && last.streaming) {
        return {
          ...run,
          messages: [...run.messages.slice(0, -1), { ...last, text: last.text + event.delta }],
        };
      }
      return { ...run, messages: [...run.messages, { role: "agent", text: event.delta, kind }] };
    }

    case "error":
      return { ...run, state: "failed", error: event.message };
  }
}

/**
 * One id per browser tab, kept across reloads.
 *
 * A run is a batch of invoices; a session is the person talking, and they keep
 * talking after the batch on screen has been replaced. The agent stores the
 * conversation under this, so "and the others?" still resolves after a reload or
 * a second batch.
 */
function sessionId(): string {
  if (typeof window === "undefined") return "default";
  const existing = window.sessionStorage.getItem("strike-session");
  if (existing) return existing;
  const fresh = `s_${Math.random().toString(36).slice(2, 10)}`;
  window.sessionStorage.setItem("strike-session", fresh);
  return fresh;
}

export function useRun() {
  const [run, setRun] = useState<Run>(EMPTY);
  const token = useRef(0);
  const session = useRef<string>("default");
  if (typeof window !== "undefined" && session.current === "default") {
    session.current = sessionId();
  }
  // Content hashes seen this session, mapped to the file they arrived as.
  const seen = useRef(new Map<string, string>());

  const consume = useCallback(async (response: Response, currentToken: number) => {
    for await (const event of readEventStream(response)) {
      if (token.current !== currentToken) return;
      setRun((prev) => apply(prev, event));
    }
  }, []);

  const start = useCallback(
    async (
      locale: "en" | "de",
      message?: string,
      options: { keys?: string[]; sample?: boolean; runId?: string } = {},
    ) => {
      const current = ++token.current;
      const runId = options.runId ?? `r_${Math.random().toString(36).slice(2, 8)}`;
      setRun({ ...EMPTY, state: "extracting", runId });

      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          runId,
          keys: options.keys ?? [],
          locale,
          message,
          // Explicit. The agent no longer treats "no keys" as "use the demo
          // batch", so a failed upload reports itself instead of quietly
          // producing six invoices nobody uploaded.
          sample: options.sample ?? false,
        }),
      });
      await consume(response, current);
    },
    [consume],
  );

  const upload = useCallback(async (runId: string, files: File[]): Promise<UploadResult> => {
    // Byte-identical files, caught before anything is uploaded or read. Dropping
    // the same document twice is an ordinary slip - two people forwarding the
    // same attachment - and there is no reason to pay S3 and a model to discover
    // it. Hashes are also remembered across drops in this session, so uploading
    // the same file again ten minutes later is still caught.
    const unique: File[] = [];
    const duplicates: Duplicate[] = [];

    for (const file of files) {
      const digest = await sha256(file);
      const original = seen.current.get(digest);
      if (original) {
        duplicates.push({ name: file.name, of: original });
        continue;
      }
      seen.current.set(digest, file.name);
      unique.push(file);
    }

    if (unique.length === 0) return { keys: [], duplicates };

    const response = await fetch("/api/upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        runId,
        files: unique.map((f) => ({ name: f.name, size: f.size, type: f.type })),
      }),
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.message ?? "The upload could not be prepared.");
    }

    const { uploads } = (await response.json()) as {
      uploads: { name: string; key: string; url: string }[];
    };

    // Straight to S3, so the documents never pass through the web server and
    // there is no request-body limit to hit.
    await Promise.all(
      uploads.map(async (target) => {
        const file = unique.find((f) => f.name === target.name);
        if (!file) return;
        const put = await fetch(target.url, {
          method: "PUT",
          headers: { "Content-Type": file.type || "application/octet-stream" },
          body: file,
        });
        if (!put.ok) {
          // S3 says why, in an XML body, and throwing it away turns a fifteen
          // second fix into a debugging session: an expired workshop token
          // presigns perfectly well and is only refused here, which reads as a
          // broken upload rather than as credentials to renew.
          const detail = await put.text().catch(() => "");
          const code = /<Code>([^<]+)<\/Code>/.exec(detail)?.[1];
          const said = /<Message>([^<]+)<\/Message>/.exec(detail)?.[1];
          const because = said ? `: ${said}` : ".";
          throw new Error(
            `${file.name} could not be uploaded (${put.status}${code ? ` ${code}` : ""})${because}`,
          );
        }
      }),
    );

    return { keys: uploads.map((u) => u.key), duplicates };
  }, []);

  const ask = useCallback(
    async (locale: "en" | "de", message: string) => {
      // A new question abandons whatever was still streaming. Without this the
      // two streams interleave, and the first one's `finally` clears the
      // streaming flag mid-answer - which is how a reply ends up split across
      // one paragraph per token, with the tail of the previous answer stranded
      // under the next question.
      const current = ++token.current;
      // No run yet is a legitimate question, not a no-op. The agent says it has
      // no batch to answer from, which beats a button that appears dead.
      const runId = run.runId ?? "none";

      // Keep the run exactly as it is. A question must never clear the table the
      // question is about, and must never re-trigger validation.
      setRun((prev) => ({
        ...prev,
        answering: true,
        messages: [
          ...prev.messages.map((m) => (m.streaming ? { ...m, streaming: false } : m)),
          { role: "you", text: message },
          // Explicitly chat: an answer is never process narration, and it is
          // created before the run state could imply that for it.
          { role: "agent", text: "", streaming: true, kind: "chat" },
        ],
      }));

      try {
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            runId,
            keys: [],
            locale,
            message,
            sessionId: session.current,
          }),
        });
        await consume(response, current);
      } finally {
        // Only the current answer may close itself. An abandoned stream that
        // cleared the flag would leave the live answer appending nowhere.
        if (token.current === current) {
          setRun((prev) => ({
            ...prev,
            answering: false,
            messages: prev.messages
              // An answer that produced nothing leaves no empty bubble behind.
              .filter((m) => m.text !== "" || !m.streaming)
              .map((m) => (m.streaming ? { ...m, streaming: false } : m)),
          }));
        }
      }
    },
    [run.runId, consume],
  );

  /**
   * Mark a blocked invoice. Nothing is sent and nothing moves - the mark is
   * carried by the single Approve press below, which is the only thing that
   * acts.
   *
   * Marking the same way twice clears it, so a misclick is undoable without a
   * third control.
   */
  const decide = useCallback((invoiceId: string, decision: "override" | "reject") => {
    setRun((prev) => ({
      ...prev,
      invoices: prev.invoices.map((i) =>
        i.invoiceId === invoiceId
          ? { ...i, decision: i.decision === decision ? undefined : decision }
          : i,
      ),
    }));
  }, []);

  const approve = useCallback(
    async (ids?: string[]) => {
      const current = token.current;
      if (!run.runId) return;

      // The marks the clerk made on blocked rows. Only the browser knows them,
      // so dropping them here posts the batch as if nobody had overridden
      // anything. A row's own approve button carries only its own mark.
      const marked = (decision: "override" | "reject") => {
        const all = run.invoices.filter((i) => i.decision === decision).map((i) => i.invoiceId);
        return ids ? all.filter((id) => ids.includes(id)) : all;
      };
      const overrideIds = marked("override");
      const rejectIds = marked("reject");

      const targetIds = ids ?? run.readyIds;
      // An override is a write of its own, and a rejection is a decision of its
      // own, so a press carrying only those still has work to do.
      if (targetIds.length === 0 && overrideIds.length === 0 && rejectIds.length === 0) return;
      setRun((prev) => ({
        ...prev,
        state: "posting",
        parkingIds: [...prev.parkingIds, ...targetIds, ...overrideIds],
      }));

      const response = await fetch("/api/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId: run.runId, readyIds: targetIds, overrideIds, rejectIds }),
      });
      await consume(response, current);
      // "Done" is earned, not assumed - a single row's approve button only parks
      // that one invoice, and the run stays awaiting-approval until every ready
      // invoice has actually been parked, however many separate calls that took.
      setRun((prev) => {
        const settled = prev.readyIds.every(
          (id) => prev.invoices.find((i) => i.invoiceId === id)?.status === "parked",
        );
        return { ...prev, state: settled ? "done" : "awaiting-approval", parkingIds: [] };
      });
    },
    [run.runId, run.readyIds, run.invoices, consume],
  );

  /** Surface a client-side failure in the same place the agent's errors appear. */
  const fail = useCallback((message: string) => {
    setRun((prev) => ({ ...prev, state: "failed", error: message }));
  }, []);

  const reset = useCallback(() => {
    token.current += 1;
    setRun(EMPTY);
  }, []);

  return { run, start, upload, ask, approve, decide, reset, fail };
}
