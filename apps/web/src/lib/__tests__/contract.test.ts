import de from "@/messages/de.json";
import en from "@/messages/en.json";
import { describe, expect, it } from "vitest";
import { type RuleEvent, deriveStatus, parseEvent } from "../events";

/**
 * Three checks, each chosen because its failure mode would otherwise surface
 * during the demo rather than in CI.
 */

describe("parseEvent", () => {
  it("parses a well-formed event", () => {
    const event = parseEvent('{"type":"text","delta":"hello"}');
    expect(event).toEqual({ type: "text", delta: "hello" });
  });

  it("returns null rather than throwing on junk", () => {
    // A newer agent build emitting an unknown event must never blank the UI.
    expect(parseEvent("not json")).toBeNull();
    expect(parseEvent('{"type":"from-the-future","x":1}')).toBeNull();
    expect(parseEvent('{"type":"rule"}')).toBeNull();
  });
});

describe("deriveStatus", () => {
  const rule = (status: RuleEvent["status"], ruleId: number): RuleEvent => ({
    type: "rule",
    invoiceId: "FPL-1563",
    ruleId,
    label: `rule ${ruleId}`,
    status,
    decidedBy: "rule",
  });

  it("is pending while checks are still arriving", () => {
    expect(deriveStatus([rule("pass", 1), rule("pass", 2)])).toBe("pending");
  });

  it("is ready once all sixteen pass", () => {
    const all = Array.from({ length: 16 }, (_, i) => rule("pass", i + 1));
    expect(deriveStatus(all)).toBe("ready");
  });

  it("is blocked on any failure, even mid-cascade", () => {
    expect(deriveStatus([rule("pass", 1), rule("fail", 2)])).toBe("blocked");
  });

  it("does not count skipped checks towards ready", () => {
    const one = rule("pass", 1);
    const skipped = Array.from({ length: 15 }, (_, i) => rule("skip", i + 2));
    expect(deriveStatus([one, ...skipped])).toBe("pending");
  });
});

describe("locale parity", () => {
  it("has the same keys in en and de", () => {
    // Catches a missing German string before it appears on stage.
    expect(Object.keys(de).sort()).toEqual(Object.keys(en).sort());
  });

  it("has no empty translations", () => {
    for (const [key, value] of Object.entries(de)) {
      expect(value, `de.${key} is empty`).not.toBe("");
    }
  });
});
