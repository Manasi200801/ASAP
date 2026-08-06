import type { RuleEvent } from "@/lib/events";
import type { Translate } from "@/lib/i18n";
import { Spinner } from "./spinner";

/**
 * One line per thing worth reading, nothing else.
 *
 * Twelve of sixteen checks are arithmetic or lookup - a clerk does not need
 * sixteen chips to trust that. A judged check earns its own line so the
 * provenance (the ◆) stays visible, but the label alone is the claim; "supplier
 * matches" does not need a sentence proving two numbers are equal. Only a
 * failure earns prose, because that is the one line someone has to act on.
 */
export function RuleChips({
  rules,
  pending,
  t,
}: {
  rules: RuleEvent[];
  pending: boolean;
  t: Translate;
}) {
  const automatic = rules.filter((r) => r.status === "pass" && r.decidedBy === "rule");
  const judged = rules.filter((r) => r.status === "pass" && r.decidedBy === "agent");
  const failed = rules.filter((r) => r.status === "fail");

  if (rules.length === 0 && !pending) return null;

  return (
    <div className="flex flex-col gap-2.5 pt-0.5 pr-3 pb-3.5 pl-3">
      {automatic.length > 0 ? (
        <div className="flex items-center gap-2 text-[15px] text-success">
          <span className="flex h-4 w-4 flex-none items-center justify-center rounded-full bg-success/15 text-[10px]">
            ✓
          </span>
          {t("autoChecksPassed", { count: automatic.length })}
        </div>
      ) : null}

      {judged.map((rule) => (
        <div key={rule.ruleId} className="flex items-center gap-2 text-[15px] text-secondary">
          <span className="flex-none text-[9px]">◆</span>
          <span className="font-medium">{rule.label}</span>
        </div>
      ))}

      {failed.map((rule) => (
        <div key={rule.ruleId} className="flex items-baseline gap-2 text-[15px] text-error">
          <span className="flex-none text-[9px]">✕</span>
          <p>
            <b className="font-medium">{rule.label}</b> — {rule.detail ?? t("stBlocked")}
          </p>
        </div>
      ))}

      {pending ? (
        <div className="flex items-center gap-2 text-[15px] text-on-surface-faint">
          <Spinner />
          {t("stPending")}…
        </div>
      ) : null}
    </div>
  );
}
