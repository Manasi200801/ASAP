import type { RunEvent } from "./events";

/**
 * Scripted replay of the real Lab 06 batch, at the pacing floors from
 * `contract/events.md`. Two jobs:
 *
 *  - the interface is buildable and demonstrable before the agent exists
 *  - `?mock=1` is the fallback if SAP or the venue network fails on the day
 *
 * Same event shapes as the live agent, so swapping is one environment variable.
 */

const FLOOR = { invoice: 110, rule: 60, posting: 60, beat: 520 };

const RULES = [
  "PO exists",
  "PO is open",
  "PO line item exists",
  "Supplier matches",
  "Company code matches",
  "Currency matches",
  "Material matches",
  "Quantity within tolerance",
  "Unit price within tolerance",
  "Line = qty x price",
  "Gross = lines + tax",
  "Goods receipt exists",
  "GR quantity sufficient",
  "Tax code valid",
  "Posting period open",
  "Not a duplicate",
];

/** Rule indexes (0-based) where deterministic comparison gives up. */
const AGENT_RULES = new Set([3, 6, 8]);

const BATCH = [
  {
    id: "FPL-SAMPLE-0001",
    file: "fpl-invoice-01.pdf",
    po: "4500001463",
    vendor: "10300006",
    net: "50.00",
    gross: "59.50",
    tax: "V1",
    mat: "QM003",
    qty: "5",
  },
  {
    id: "FPL-1563",
    file: "fpl-invoice-02.pdf",
    po: "4500001563",
    vendor: "17401710",
    net: "113.50",
    gross: "113.50",
    tax: "V0",
    mat: "TG12",
    qty: "10",
  },
  {
    id: "FPL-1638",
    file: "fpl-invoice-03.pdf",
    po: "4500001638",
    vendor: "17401710",
    net: "113.50",
    gross: "113.50",
    tax: "V0",
    mat: "TG12",
    qty: "10",
  },
  {
    id: "FPL-1650",
    file: "fpl-invoice-04.pdf",
    po: "4500001650",
    vendor: "17401710",
    net: "113.50",
    gross: "113.50",
    tax: "V0",
    mat: "TG12",
    qty: "10",
  },
  {
    id: "FPL-1697",
    file: "fpl-invoice-05.pdf",
    po: "4500001697",
    vendor: "17401710",
    net: "113.50",
    gross: "113.50",
    tax: "V0",
    mat: "TG12",
    qty: "10",
  },
  // The deliberate failure the workshop ships: this purchase order does not exist.
  {
    id: "FPL-9999",
    file: "fpl-invoice-06.pdf",
    po: "4500009999",
    vendor: "17401710",
    net: "113.50",
    gross: "113.50",
    tax: "V0",
    mat: "TG12",
    qty: "10",
    failAt: 0,
  },
];

const ACCOUNT = "516359819848";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function* mockRun(runId: string): AsyncGenerator<RunEvent> {
  yield { type: "text", delta: "Six files received. Reading them now." };
  await sleep(FLOOR.beat);

  yield { type: "batch", runId, reference: `${ACCOUNT}-11`, count: BATCH.length };

  for (const inv of BATCH) {
    yield {
      type: "invoice",
      invoiceId: inv.id,
      file: inv.file,
      supplierInvoiceId: inv.id,
      vendor: inv.vendor,
      purchaseOrder: inv.po,
      purchaseOrderItem: "10",
      material: inv.mat,
      quantity: inv.qty,
      unit: "PC",
      netAmount: inv.net,
      taxCode: inv.tax,
      grossAmount: inv.gross,
      currency: "EUR",
      companyCode: "1010",
    };
    await sleep(FLOOR.invoice);
  }

  yield {
    type: "text",
    delta: "Extracted 6 invoices, company code 1010. Checking each against SAP master data.",
  };
  await sleep(FLOOR.beat);

  let rulesRun = 0;
  let agentDecided = 0;
  const readyIds: string[] = [];
  const blockedIds: string[] = [];

  for (const inv of BATCH) {
    yield {
      type: "tool-call",
      invoiceId: inv.id,
      method: "GET",
      resource: `A_PurchaseOrder('${inv.po}')`,
      status: "ok",
      ms: 380,
    };

    for (let i = 0; i < RULES.length; i++) {
      if (inv.failAt !== undefined && i > inv.failAt) {
        yield {
          type: "rule",
          invoiceId: inv.id,
          ruleId: i + 1,
          label: RULES[i],
          status: "skip",
          decidedBy: "rule",
        };
        continue;
      }

      const failed = inv.failAt === i;
      const byAgent = AGENT_RULES.has(i);
      rulesRun += 1;
      if (byAgent) agentDecided += 1;

      yield {
        type: "rule",
        invoiceId: inv.id,
        ruleId: i + 1,
        label: RULES[i],
        status: failed ? "fail" : "pass",
        decidedBy: byAgent ? "agent" : "rule",
        detail: failed ? `Purchase order ${inv.po} not found` : undefined,
        reasoning:
          byAgent && i === 3 && inv.vendor === "17401710"
            ? "Invoice says 17401710, the purchase order reports BP1710. Read the Business Partner record - same entity, S/4HANA numbering. Match confirmed."
            : undefined,
      };
      await sleep(FLOOR.rule);
    }

    if (inv.failAt !== undefined) {
      blockedIds.push(inv.id);
      yield {
        type: "tool-call",
        invoiceId: inv.id,
        method: "GET",
        resource: `A_PurchaseOrder?$filter=Supplier eq '${inv.vendor}'`,
        status: "ok",
        ms: 410,
      };
      yield {
        type: "invoice-status",
        invoiceId: inv.id,
        status: "blocked",
        headline: `Purchase order ${inv.po} does not exist in SAP.`,
        impact:
          "This invoice cannot be matched to an order, so it cannot be parked. The remaining 5 are unaffected.",
        suggestion: {
          text: `Supplier ${inv.vendor} has one open, goods-receipted order for the same material and amount: 4500001712.`,
          action: "reassign-po",
          value: "4500001712",
        },
      };
      // Deliberate pause: the room is still reading the explanation.
      await sleep(FLOOR.beat * 1.6);
    } else {
      readyIds.push(inv.id);
      yield { type: "invoice-status", invoiceId: inv.id, status: "ready" };
      await sleep(FLOOR.invoice);
    }
  }

  yield {
    type: "summary",
    runId,
    ready: readyIds.length,
    blocked: blockedIds.length,
    rulesRun,
    agentDecided,
    minutesSaved: readyIds.length * 17,
  };
  await sleep(FLOOR.beat * 0.7);

  yield { type: "approval", runId, readyIds, blockedIds };
}

const UPLOAD_BUCKET = "516359819848-uploaded-invoice";
const PROCESSED_BUCKET = "516359819848-processed-invoice";
const BLOCKED_BUCKET = "516359819848-blocked-invoice";

export async function* mockPost(
  runId: string,
  postIds: string[],
  rejectIds: string[] = [],
): AsyncGenerator<RunEvent> {
  yield {
    type: "text",
    delta: `Parking approved invoices as status A, reference ${ACCOUNT}-11 onward.`,
  };
  await sleep(FLOOR.beat * 0.7);

  let doc = 5100001500;
  let seq = 11;

  for (const id of postIds) {
    const reference = `${ACCOUNT}-${seq}`;
    yield {
      type: "tool-call",
      invoiceId: id,
      method: "POST",
      resource: `A_SupplierInvoice - ${reference}`,
      status: "ok",
      ms: 640,
    };
    yield {
      type: "posting",
      invoiceId: id,
      status: "parked",
      reference,
      sapDocument: String(doc),
      fiscalYear: "2025",
    };
    doc += 1;
    seq += 1;
    await sleep(FLOOR.posting);
  }

  // Filing, same rules as the agent: parked goes to the processed archive,
  // an explicit rejection to the blocked one, and anything undecided stays in
  // the upload bucket and is therefore not mentioned at all.
  for (const id of postIds) {
    yield { type: "filed", invoiceId: id, status: "moved", bucket: PROCESSED_BUCKET };
    await sleep(FLOOR.posting);
  }
  for (const id of rejectIds) {
    yield { type: "filed", invoiceId: id, status: "moved", bucket: BLOCKED_BUCKET };
    await sleep(FLOOR.posting);
  }

  const open = 6 - postIds.length - rejectIds.length;
  const tail =
    open > 0 ? `${open} still open in ${UPLOAD_BUCKET}, waiting on the buyer.` : "Nothing left open.";
  yield {
    type: "text",
    delta: `${postIds.length} parked documents in SAP, fiscal year 2025. ${tail}`,
  };
}
