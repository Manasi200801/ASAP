import { mockPost } from "@/lib/mock-run";
import { eventStream } from "@/lib/sse";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * The only endpoint that writes to SAP.
 *
 * Approval is a separate request rather than a chat message on purpose: it makes
 * the single human approval gate structural. Nothing reaches SAP without a
 * distinct second call from the client, and the orchestrator rejects this unless
 * the run is in `awaiting-approval`.
 */
export async function POST(request: Request) {
  const body = await request.json();
  const runId: string = body.runId;
  const readyIds: string[] = body.readyIds ?? [];
  const endpoint = process.env.AGENT_ENDPOINT;

  if (!runId) {
    return Response.json({ type: "error", message: "No run to approve." }, { status: 400 });
  }

  if (!endpoint || process.env.MOCK === "1") {
    return eventStream(mockPost(runId, readyIds));
  }

  const upstream = await fetch(`${endpoint}/approve`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(process.env.AGENT_TOKEN ? { Authorization: `Bearer ${process.env.AGENT_TOKEN}` } : {}),
    },
    body: JSON.stringify({ runId, readyIds }),
  });

  if (!upstream.ok || !upstream.body) {
    return Response.json(
      {
        type: "error",
        message: `Parking failed (${upstream.status}). Nothing was written to SAP.`,
      },
      { status: 502 },
    );
  }

  return new Response(upstream.body, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform" },
  });
}
