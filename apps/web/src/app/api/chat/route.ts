import { mockAnswer, mockRun } from "@/lib/mock-run";
import { eventStream } from "@/lib/sse";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Read-only. Extracts and validates; never writes to SAP.
 *
 * With AGENT_ENDPOINT unset, or MOCK=1, this replays the scripted run - which is
 * how the interface is built before the agent exists, and the fallback on the day.
 */
export async function POST(request: Request) {
  const body = await request.json();
  const runId: string = body.runId ?? `r_${Date.now()}`;
  const endpoint = process.env.AGENT_ENDPOINT;

  if (!endpoint || process.env.MOCK === "1") {
    // A question is a question here too. Replaying the batch for every typed
    // message is the bug the agent had, and having it only in the fallback is
    // worse, because the fallback is what a stranger opening the public URL
    // sees.
    const message: string | undefined = body.message;
    return eventStream(message && !body.sample ? mockAnswer(message) : mockRun(runId));
  }

  const upstream = await fetch(`${endpoint}/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(process.env.AGENT_TOKEN ? { Authorization: `Bearer ${process.env.AGENT_TOKEN}` } : {}),
    },
    body: JSON.stringify(body),
  });

  if (!upstream.ok || !upstream.body) {
    return Response.json(
      { type: "error", message: `The agent is not responding (${upstream.status}).` },
      { status: 502 },
    );
  }

  // The orchestrator already emits our event shapes, paced. Pass it straight through.
  return new Response(upstream.body, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
    },
  });
}
