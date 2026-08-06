"""Shared Bedrock plumbing for the two model-backed layers.

One place that knows how to call Converse and get JSON back, so `extract.py` and
`judge.py` only have to care about their prompts.
"""

from __future__ import annotations

import json
import logging
import os
import re
import time
from typing import AsyncIterator

log = logging.getLogger("app.bedrock")

# Sonnet 5 and Opus 5 appear in list-inference-profiles but are not enabled on the
# workshop account - Converse returns AccessDenied. 4.6 is the newest that works,
# and is already ahead of the 4.5 the workshop pins.
DEFAULT_MODEL = "us.anthropic.claude-sonnet-4-6"

# A malformed answer must never become a silent pass. One retry, then raise, and
# the orchestrator turns that into a blocked invoice with an honest message.
RETRIES = 1

# Anything not listed here is sent as a PDF document block.
IMAGE_FORMATS = {"png": "png", "jpg": "jpeg", "jpeg": "jpeg", "gif": "gif", "webp": "webp"}


class JudgementError(RuntimeError):
    """The model did not answer in a usable shape."""


def model_id() -> str:
    return os.getenv("BEDROCK_MODEL_ID", DEFAULT_MODEL)


def _client():
    import boto3

    return boto3.client("bedrock-runtime", region_name=os.getenv("AWS_REGION", "us-east-1"))


def _text(response: dict) -> str:
    blocks = response.get("output", {}).get("message", {}).get("content", [])
    return "".join(b.get("text", "") for b in blocks)


def _as_json(raw: str) -> dict:
    """Parse the model's answer, tolerating a fenced block or surrounding prose."""
    fenced = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", raw, re.S)
    candidate = fenced.group(1) if fenced else raw

    if not fenced:
        start, end = candidate.find("{"), candidate.rfind("}")
        if start == -1 or end <= start:
            raise JudgementError("The model did not return JSON.")
        candidate = candidate[start : end + 1]

    try:
        return json.loads(candidate)
    except json.JSONDecodeError as error:
        raise JudgementError(f"The model returned malformed JSON: {error}") from error


async def stream_text(system: str, prompt: str) -> AsyncIterator[str]:
    """Converse with streaming, as text deltas.

    Everything else here answers in JSON, which has to arrive whole. An answer to
    a typed question is prose a person reads as it lands, and a five-second pause
    before a paragraph appears at once reads as a hang.

    boto3's event stream is a blocking iterator, so it is pumped on a worker
    thread into an asyncio queue. Errors cross the boundary as a value and are
    re-raised here, so a failure surfaces as a normal exception rather than a
    stream that silently stops.
    """
    import asyncio
    import threading

    loop = asyncio.get_running_loop()
    queue: asyncio.Queue[str | Exception | None] = asyncio.Queue()

    def pump() -> None:
        try:
            response = _client().converse_stream(
                modelId=model_id(),
                system=[{"text": system}],
                messages=[{"role": "user", "content": [{"text": prompt}]}],
                inferenceConfig={"maxTokens": 1200, "temperature": 0},
            )
            for event in response["stream"]:
                delta = event.get("contentBlockDelta", {}).get("delta", {}).get("text")
                if delta:
                    loop.call_soon_threadsafe(queue.put_nowait, delta)
        except Exception as error:  # noqa: BLE001 - re-raised on the consumer side
            loop.call_soon_threadsafe(queue.put_nowait, error)
        finally:
            loop.call_soon_threadsafe(queue.put_nowait, None)

    threading.Thread(target=pump, daemon=True).start()

    while (item := await queue.get()) is not None:
        if isinstance(item, Exception):
            raise item
        yield item


async def stream_tools(
    system: str,
    messages: list[dict],
    tools: list[dict],
    dispatch,
    max_turns: int = 5,
) -> AsyncIterator[str]:
    """Converse with tools, streamed, until the model stops asking for data.

    The model decides what it needs and fetches it. That is the difference
    between an assistant and a template: nothing about the current batch is
    written into the prompt, so a question about an invoice from an hour ago is
    answered the same way as one about the batch on screen.

    `dispatch(name, arguments) -> dict` is called on the worker thread, so it
    must be an ordinary blocking function. `max_turns` is a stop, not a target:
    a model that keeps calling tools without answering would otherwise loop.
    """
    import asyncio
    import threading

    loop = asyncio.get_running_loop()
    queue: asyncio.Queue[str | Exception | None] = asyncio.Queue()
    emit = lambda text: loop.call_soon_threadsafe(queue.put_nowait, text)  # noqa: E731

    def pump() -> None:
        try:
            client = _client()
            for turn in range(max_turns):
                started = time.perf_counter()
                response = client.converse_stream(
                    modelId=model_id(),
                    system=[{"text": system}],
                    messages=messages,
                    toolConfig={"tools": tools},
                    inferenceConfig={"maxTokens": 1200, "temperature": 0},
                )

                spoken: list[str] = []
                # Keyed by content block index: a tool call's arguments arrive as
                # a stream of partial JSON that has to be reassembled per block.
                calls: dict[int, dict] = {}
                stop_reason = None

                for event in response["stream"]:
                    if "contentBlockStart" in event:
                        block = event["contentBlockStart"]
                        start = block.get("start", {})
                        if "toolUse" in start:
                            calls[block["contentBlockIndex"]] = {
                                "toolUseId": start["toolUse"]["toolUseId"],
                                "name": start["toolUse"]["name"],
                                "input": "",
                            }
                    elif "contentBlockDelta" in event:
                        block = event["contentBlockDelta"]
                        delta = block.get("delta", {})
                        if "text" in delta:
                            spoken.append(delta["text"])
                            emit(delta["text"])
                        elif "toolUse" in delta:
                            call = calls.get(block["contentBlockIndex"])
                            if call is not None:
                                call["input"] += delta["toolUse"].get("input", "")
                    elif "messageStop" in event:
                        stop_reason = event["messageStop"].get("stopReason")

                log.info(
                    "converse turn %d -> %.0fms, stop=%s, %d tool call(s)",
                    turn,
                    (time.perf_counter() - started) * 1000,
                    stop_reason,
                    len(calls),
                )

                if stop_reason != "tool_use" or not calls:
                    return

                # Rebuild the assistant turn, run what it asked for, and hand the
                # results back as the next user turn. This is the whole protocol.
                assistant: list[dict] = []
                text = "".join(spoken)
                if text.strip():  # Bedrock rejects an empty text block
                    assistant.append({"text": text})
                results: list[dict] = []

                for call in calls.values():
                    try:
                        arguments = json.loads(call["input"] or "{}")
                    except json.JSONDecodeError:
                        arguments = {}
                    log.info("tool %s(%s)", call["name"], arguments)
                    try:
                        output = dispatch(call["name"], arguments)
                    except Exception as error:  # noqa: BLE001 - the model is told and can recover
                        log.warning("tool %s failed: %s", call["name"], error)
                        output = {"error": str(error)}

                    assistant.append(
                        {
                            "toolUse": {
                                "toolUseId": call["toolUseId"],
                                "name": call["name"],
                                "input": arguments,
                            }
                        }
                    )
                    results.append(
                        {
                            "toolResult": {
                                "toolUseId": call["toolUseId"],
                                "content": [{"json": output}],
                            }
                        }
                    )

                messages.append({"role": "assistant", "content": assistant})
                messages.append({"role": "user", "content": results})

            log.warning("tool loop hit %d turns without a final answer", max_turns)
        except Exception as error:  # noqa: BLE001 - re-raised on the consumer side
            loop.call_soon_threadsafe(queue.put_nowait, error)
        finally:
            loop.call_soon_threadsafe(queue.put_nowait, None)

    threading.Thread(target=pump, daemon=True).start()

    while (item := await queue.get()) is not None:
        if isinstance(item, Exception):
            raise item
        yield item


def ask_json(system: str, prompt: str, document: bytes | None = None, name: str = "invoice") -> dict:
    """One Converse call that must come back as a JSON object."""
    client = _client()

    content: list[dict] = []
    if document is not None:
        # A photographed invoice is as ordinary as a PDF one, and Converse wants
        # an image block for it rather than a document block.
        suffix = name.rsplit(".", 1)[-1].lower() if "." in name else ""
        image_format = IMAGE_FORMATS.get(suffix)
        if image_format:
            content.append({"image": {"format": image_format, "source": {"bytes": document}}})
        else:
            content.append(
                {
                    "document": {
                        # Converse rejects most punctuation in document names.
                        "name": re.sub(r"[^A-Za-z0-9 ]+", " ", name)[:60] or "invoice",
                        "format": "pdf",
                        "source": {"bytes": document},
                    }
                }
            )
    content.append({"text": prompt})

    last: Exception | None = None
    for attempt in range(RETRIES + 1):
        started = time.perf_counter()
        response = client.converse(
            modelId=model_id(),
            system=[{"text": system}],
            messages=[{"role": "user", "content": content}],
            inferenceConfig={"maxTokens": 2000, "temperature": 0},
        )
        usage = response.get("usage", {})
        log.info(
            "converse %s -> %.0fms, %d in / %d out tokens%s",
            model_id(),
            (time.perf_counter() - started) * 1000,
            usage.get("inputTokens", 0),
            usage.get("outputTokens", 0),
            f" (retry {attempt})" if attempt else "",
        )
        try:
            return _as_json(_text(response))
        except JudgementError as error:
            last = error
            # Worth a warning: a retry doubles the latency of whatever rule is
            # waiting on it, and a pattern of them means the prompt has drifted.
            log.warning("model did not return usable JSON: %s", error)
            if attempt == RETRIES:
                break

    raise JudgementError(str(last))
