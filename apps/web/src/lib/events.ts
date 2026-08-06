import { z } from "zod";

/**
 * Mirror of `contract/events.md`. The Python orchestrator mirrors the same shapes
 * in Pydantic. Change the contract document first, then both sides.
 */

export const RULE_COUNT = 16;

const Batch = z.object({
  type: z.literal("batch"),
  runId: z.string(),
  reference: z.string(),
  count: z.number(),
});

const Invoice = z.object({
  type: z.literal("invoice"),
  invoiceId: z.string(),
  file: z.string(),
  supplierInvoiceId: z.string(),
  vendor: z.string(),
  vendorName: z.string().optional(),
  purchaseOrder: z.string(),
  purchaseOrderItem: z.string().optional(),
  material: z.string().optional(),
  quantity: z.string().optional(),
  unit: z.string().optional(),
  unitPrice: z.string().optional(),
  netAmount: z.string(),
  taxCode: z.string().optional(),
  grossAmount: z.string().optional(),
  currency: z.string(),
  companyCode: z.string(),
  confidence: z.record(z.number()).optional(),
});

const ToolCall = z.object({
  type: z.literal("tool-call"),
  invoiceId: z.string().optional(),
  method: z.string(),
  resource: z.string(),
  status: z.enum(["pending", "ok", "error"]),
  ms: z.number().optional(),
});

const Rule = z.object({
  type: z.literal("rule"),
  invoiceId: z.string(),
  ruleId: z.number(),
  label: z.string(),
  status: z.enum(["pass", "fail", "skip"]),
  decidedBy: z.enum(["rule", "agent"]),
  detail: z.string().optional(),
  evidence: z.string().optional(),
  reasoning: z.string().optional(),
  citation: z.string().optional(),
});

const InvoiceStatus = z.object({
  type: z.literal("invoice-status"),
  invoiceId: z.string(),
  status: z.enum(["ready", "blocked"]),
  headline: z.string().optional(),
  impact: z.string().optional(),
  detail: z.string().optional(),
  suggestion: z.object({ text: z.string(), action: z.string(), value: z.string() }).optional(),
});

const Summary = z.object({
  type: z.literal("summary"),
  runId: z.string(),
  ready: z.number(),
  blocked: z.number(),
  rulesRun: z.number(),
  agentDecided: z.number(),
  minutesSaved: z.number(),
});

const Approval = z.object({
  type: z.literal("approval"),
  runId: z.string(),
  readyIds: z.array(z.string()),
  blockedIds: z.array(z.string()),
});

const Posting = z.object({
  type: z.literal("posting"),
  invoiceId: z.string(),
  status: z.enum(["parking", "parked", "error"]),
  reference: z.string().optional(),
  sapDocument: z.string().optional(),
  fiscalYear: z.string().optional(),
  message: z.string().optional(),
});

const Text = z.object({ type: z.literal("text"), delta: z.string() });

const ErrorEvent = z.object({
  type: z.literal("error"),
  message: z.string(),
  recoverable: z.boolean().default(false),
});

export const RunEvent = z.discriminatedUnion("type", [
  Batch,
  Invoice,
  ToolCall,
  Rule,
  InvoiceStatus,
  Summary,
  Approval,
  Posting,
  Text,
  ErrorEvent,
]);

export type RunEvent = z.infer<typeof RunEvent>;
export type InvoiceEvent = z.infer<typeof Invoice>;
export type RuleEvent = z.infer<typeof Rule>;
export type ToolCallEvent = z.infer<typeof ToolCall>;

/**
 * Parse one event off the wire.
 *
 * Returns null for anything unrecognised rather than throwing. An unknown event
 * type from a newer agent build must never blank the interface mid-demo.
 */
export function parseEvent(raw: string): RunEvent | null {
  try {
    const result = RunEvent.safeParse(JSON.parse(raw));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

export type RunState =
  | "idle"
  | "uploading"
  | "extracting"
  | "validating"
  | "awaiting-approval"
  | "posting"
  | "done"
  | "failed";

export type InvoiceRow = InvoiceEvent & {
  rules: RuleEvent[];
  status: "pending" | "ready" | "blocked" | "parked";
  headline?: string;
  impact?: string;
  detail?: string;
  suggestion?: { text: string; action: string; value: string };
  sapDocument?: string;
  fiscalYear?: string;
  reference?: string;
};

/** Derive an invoice's overall status from its rule results. */
export function deriveStatus(rules: RuleEvent[]): "pending" | "ready" | "blocked" {
  if (rules.some((r) => r.status === "fail")) return "blocked";
  const evaluated = rules.filter((r) => r.status !== "skip").length;
  return evaluated >= RULE_COUNT ? "ready" : "pending";
}
