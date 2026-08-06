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
 */
export type Message = { role: "you" | "agent"; text: string; streaming?: boolean };

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
};

function apply(run: Run, event: RunEvent): Run {
  switch (event.type) {
    case "batch":
      return { ...run, state: "extracting", runId: event.runId, reference: event.reference };

    case "invoice":
      return {
        ...run,
        invoices: [...run.invoices, { ...event, rules: [], status: "pending" }],
      };

    case "tool-call":
      // Keep the rail short; it is a live indicator, not a log viewer.
      return { ...run, calls: [...run.calls, event].slice(-14) };

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
          return {
            ...i,
            rules,
            status: i.status === "parked" ? i.status : deriveStatus(rules),
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
        invoices: run.invoices.map((i) =>
          i.invoiceId === event.invoiceId
            ? {
                ...i,
                status: event.status === "parked" ? "parked" : i.status,
                sapDocument: event.sapDocument,
                fiscalYear: event.fiscalYear,
                reference: event.reference,
              }
            : i,
        ),
      };

    case "text": {
      const last = run.messages.at(-1);
      if (last?.role === "agent" && last.streaming) {
        return {
          ...run,
          messages: [...run.messages.slice(0, -1), { ...last, text: last.text + event.delta }],
        };
      }
      return { ...run, messages: [...run.messages, { role: "agent", text: event.delta }] };
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
        if (!put.ok) throw new Error(`${file.name} could not be uploaded.`);
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
          { role: "agent", text: "", streaming: true },
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

  const approve = useCallback(async () => {
    const current = token.current;
    if (!run.runId) return;
    setRun((prev) => ({ ...prev, state: "posting" }));

    const response = await fetch("/api/approve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ runId: run.runId, readyIds: run.readyIds }),
    });
    await consume(response, current);
    setRun((prev) => ({ ...prev, state: "done" }));
  }, [run.runId, run.readyIds, consume]);

  /** Surface a client-side failure in the same place the agent's errors appear. */
  const fail = useCallback((message: string) => {
    setRun((prev) => ({ ...prev, state: "failed", error: message }));
  }, []);

  const reset = useCallback(() => {
    token.current += 1;
    setRun(EMPTY);
  }, []);

  return { run, start, upload, ask, approve, reset, fail };
}
