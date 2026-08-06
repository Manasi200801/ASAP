"use client";

import { useCallback, useRef, useState } from "react";
import type { InvoiceRow, RunEvent, RunState, ToolCallEvent } from "./events";
import { deriveStatus } from "./events";
import { readEventStream } from "./sse";

export type Summary = Extract<RunEvent, { type: "summary" }>;

export type Message = { role: "you" | "agent"; text: string };

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
      if (run.answering && last?.role === "agent") {
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

  const reset = useCallback(() => {
    token.current += 1;
    setRun(EMPTY);
  }, []);

  return { run, start, ask, approve, reset };
}
