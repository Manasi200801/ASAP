"use client";

import { useCallback, useRef, useState } from "react";
import type { InvoiceRow, RunEvent, RunState, ToolCallEvent } from "./events";
import { deriveStatus } from "./events";
import { readEventStream } from "./sse";

export type Summary = Extract<RunEvent, { type: "summary" }>;

export type Message = { role: "you" | "agent"; text: string; kind?: "status" | "chat" };

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
  // True while an answer is streaming back token by token. The run's own `text`
  // events are whole sentences and each deserves its own paragraph; an answer
  // arrives as deltas that have to land in one.
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
          const status = i.status === "parked" ? i.status : deriveStatus(rules);
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
          // yet, even though the row's own approve button had already fired.
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

    case "text": {
      // Narration emitted while the batch is running (files received, extraction,
      // validation) is process status, not conversation - it renders in its own
      // live-status panel. Anything else is a real answer to a question asked.
      const kind: Message["kind"] =
        run.state === "extracting" || run.state === "validating" || run.state === "posting"
          ? "status"
          : "chat";
      const last = run.messages.at(-1);
      if (run.answering && last?.role === "agent") {
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

export function useRun() {
  const [run, setRun] = useState<Run>(EMPTY);
  const token = useRef(0);

  const consume = useCallback(async (response: Response, currentToken: number) => {
    for await (const event of readEventStream(response)) {
      if (token.current !== currentToken) return;
      setRun((prev) => apply(prev, event));
    }
  }, []);

  const start = useCallback(
    async (locale: "en" | "de", message?: string) => {
      const current = ++token.current;
      const runId = `r_${Math.random().toString(36).slice(2, 8)}`;
      setRun({ ...EMPTY, state: "extracting", runId });

      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId, keys: [], locale, message }),
      });
      await consume(response, current);
    },
    [consume],
  );

  const ask = useCallback(
    async (locale: "en" | "de", message: string) => {
      const current = token.current;
      const runId = run.runId;
      if (!runId) return;

      // Keep the run exactly as it is. A question must never clear the table the
      // question is about, and must never re-trigger validation.
      setRun((prev) => ({
        ...prev,
        answering: true,
        messages: [...prev.messages, { role: "you", text: message }],
      }));

      try {
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ runId, keys: [], locale, message }),
        });
        await consume(response, current);
      } finally {
        setRun((prev) => ({ ...prev, answering: false }));
      }
    },
    [run.runId, consume],
  );

  const approve = useCallback(
    async (ids?: string[]) => {
      const current = token.current;
      if (!run.runId) return;
      const targetIds = ids ?? run.readyIds;
      if (targetIds.length === 0) return;
      setRun((prev) => ({
        ...prev,
        state: "posting",
        parkingIds: [...prev.parkingIds, ...targetIds],
      }));

      const response = await fetch("/api/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId: run.runId, readyIds: targetIds }),
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
    [run.runId, run.readyIds, consume],
  );

  const reset = useCallback(() => {
    token.current += 1;
    setRun(EMPTY);
  }, []);

  return { run, start, ask, approve, reset };
}
