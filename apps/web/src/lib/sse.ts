import type { RunEvent } from "./events";
import { parseEvent } from "./events";

/**
 * Server-side: turn an async generator of events into an SSE response.
 *
 * The generator controls pacing. That is deliberate - the validation cascade in
 * the interface is driven by event arrival, so the backend owns the rhythm and
 * the client writes no stagger logic.
 */
export function eventStream(events: AsyncGenerator<RunEvent>): Response {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const event of events) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Run failed.";
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ type: "error", message, recoverable: false })}\n\n`,
          ),
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

/**
 * Client-side: read an SSE response and yield parsed events.
 *
 * Unrecognised events are dropped rather than thrown, so a newer agent build
 * cannot blank the interface mid-demo.
 */
export async function* readEventStream(response: Response): AsyncGenerator<RunEvent> {
  if (!response.body) return;

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";

    for (const frame of frames) {
      const line = frame.trim();
      if (!line.startsWith("data:")) continue;
      const event = parseEvent(line.slice(5).trim());
      if (event) yield event;
    }
  }
}
