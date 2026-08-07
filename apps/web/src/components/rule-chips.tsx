import type { RuleEvent } from "@/lib/events";
import type { Translate } from "@/lib/i18n";
import { CheckIcon, CrossIcon, JudgedIcon } from "./icons";
import { Spinner } from "./spinner";

/**
 * One line per thing worth reading, nothing else.
 *
 * Twelve of sixteen checks are arithmetic or lookup - a clerk does not need
 * sixteen chips to trust that. A judged check earns its own line so the
 * provenance (the ◆) stays visible, but the label alone is the claim; "supplier
 * matches" does not need a sentence proving two numbers are equal. Only a
 * failure earns prose, because that is the one line someone has to act on.
 *
 * Motion note: every line below animates on mount and only on mount, because
 * React keeps the DOM node once it exists and the keys are stable rule ids. The
 * rhythm of the cascade is therefore the rhythm the agent actually emits rules
 * at - there is no CSS delay anywhere in here, and adding one would both
 * desynchronise from the stream and assume a rule count nobody knows up front.
 * The single exception is the passed-checks counter, which is re-keyed on its
 * own value so the number re-plays a short pulse each time it climbs; that is
 * the one place where the interesting event is a change, not an arrival.
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
    <div className="flex flex-col items-start gap-3 px-4 pt-1 pb-4">
      {automatic.length > 0 ? (
        <div className="rule-in flex items-center gap-2.5 text-[17px] text-success">
          <span className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-success/15">
            <CheckIcon className="h-3.5 w-3.5" />
          </span>
          {/* Re-keyed on the count: the node is replaced each time a check lands,
              which replays the pulse. Keying on anything stable would show the
              number silently swapping, which at projector distance is invisible. */}
          <span key={automatic.length} className="tick">
            {t("autoChecksPassed", { count: automatic.length })}
          </span>
        </div>
      ) : null}

      {judged.map((rule) => (
        <div
          key={rule.ruleId}
          className="rule-in flex items-center gap-2.5 text-[17px] text-secondary"
        >
          <span className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-secondary/15">
            <JudgedIcon className="h-3.5 w-3.5" />
          </span>
          <span className="font-medium">{rule.label}</span>
          <span className="text-[13px] text-on-surface-faint uppercase tracking-[0.08em]">
            {t("decidedByAgent")}
          </span>
        </div>
      ))}

      {/* A failure is the only line anyone has to act on, so it is the only one
          that gets a container. Border and fill rather than a thick coloured
          rail: the block itself is the emphasis. */}
      {failed.map((rule) => (
        <div
          key={rule.ruleId}
          className="rule-in flex max-w-[74ch] items-start gap-2.5 rounded-[10px] border border-error/40 bg-error/[0.08] px-3.5 py-3 text-[17px] text-on-surface"
        >
          <span className="mt-0.5 flex h-6 w-6 flex-none items-center justify-center rounded-full bg-error/20 text-error">
            <CrossIcon className="h-3.5 w-3.5" />
          </span>
          <p className="leading-7">
            <b className="font-semibold text-error">{rule.label}</b>
            <span className="text-on-surface-variant"> — {rule.detail ?? t("stBlocked")}</span>
          </p>
        </div>
      ))}

      {pending ? (
        <div
          className="flex items-center gap-2.5 text-[17px] text-on-surface-faint"
          aria-live="polite"
        >
          <span className="flex h-6 w-6 flex-none items-center justify-center">
            <Spinner className="h-4 w-4" />
          </span>
          {t("stPending")}…
        </div>
      ) : null}
    </div>
  );
}
