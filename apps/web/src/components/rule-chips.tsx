import type { RuleEvent } from "@/lib/events";
import type { Translate } from "@/lib/i18n";

const TONE: Record<RuleEvent["status"], string> = {
  pass: "opacity-100",
  fail: "border-blocked-deep bg-blocked/10 text-blocked opacity-100",
  skip: "opacity-40",
};

/**
 * Every check shows who decided it.
 *
 * Twelve of sixteen are arithmetic or lookup and run in Python. The four that
 * need judgment run in the model, carry a marker, and open to their reasoning.
 * Making that boundary visible is what turns a score into something a clerk can
 * interrogate.
 */
export function RuleChips({ rules, t }: { rules: RuleEvent[]; t: Translate }) {
  const withReasoning = rules.filter((r) => r.reasoning);

  return (
    <div className="pt-0.5 pr-3 pb-3.5 pl-3">
      <div className="flex flex-wrap gap-[5px]">
        {rules.map((rule) => {
          const agent = rule.decidedBy === "agent";
          const passTone = agent
            ? "border-agent-deep bg-agent/10 text-agent"
            : "border-ok-deep bg-ok/[0.07] text-ok";

          return (
            <span
              key={rule.ruleId}
              title={rule.detail ?? (agent ? t("decidedByAgent") : undefined)}
              className={`tick inline-flex items-center gap-[5px] rounded border border-line bg-surface-2 px-2 py-[3px] font-data text-[10.5px] text-ink-faint ${
                rule.status === "pass" ? passTone : TONE[rule.status]
              }`}
            >
              {agent ? <span className="flex-none text-[8px] text-agent">◆</span> : null}
              {rule.label}
            </span>
          );
        })}
      </div>

      {withReasoning.map((rule) => (
        <div
          key={`why-${rule.ruleId}`}
          className="mt-2.5 max-w-[66ch] border-agent-deep border-l-2 pl-2.5 text-[12.5px] text-ink-dim"
        >
          <b className="font-medium text-agent">◆ {rule.label}</b> — {rule.reasoning}
          {rule.citation ? <span className="text-ink-faint"> ({rule.citation})</span> : null}
        </div>
      ))}
    </div>
  );
}
