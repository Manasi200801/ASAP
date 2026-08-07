import type { RuleEvent } from "@/lib/events";
import type { Translate } from "@/lib/i18n";
import Link from "next/link";
import { CheckIcon, CrossIcon, JudgedIcon } from "./icons";
import { Spinner } from "./spinner";

// The icon column is 24px wide with a 10px gap, so everything that belongs to a
// rule rather than to the list hangs at 34px - label, reasoning and chip share
// one left edge.
const INDENT = "ml-[34px]";

// The `Action` buttons in batch-table.tsx one card below, at the size this
// column can afford: three of these stack inside a single expanded row, so a
// 40px control per rule turns the check list into a form.
const CHIP =
  "inline-flex min-h-[28px] items-center rounded-[8px] border border-outline bg-surface-container-high px-2.5 text-[13px] text-on-surface-variant";
const CHIP_LINK =
  "state-layer pressable cursor-pointer transition-colors hover:border-on-surface-variant hover:text-on-surface focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary";

/**
 * A citation is either a document a person can open or a record the agent read.
 *
 * SAP exposes its OData entity sets as `A_<Entity>` - `A_BusinessPartner('...')`
 * is where the supplier identity came from, not a rule anyone wrote down. Only a
 * real policy belongs in the policy manager, so only a real policy links there;
 * labelling a read record "Policy:" and pointing it at a page that does not
 * contain it is the kind of detail an SAP consultant catches in one glance.
 */
function isSapSource(citation: string) {
  return /^A_[A-Za-z]/.test(citation);
}

/**
 * One line per thing worth reading, nothing else.
 *
 * Thirteen of sixteen checks are arithmetic or lookup - a clerk does not need
 * sixteen chips to trust that, and they collapse to a single counted line. The
 * three a model judged are the ones a person cannot re-derive, so each shows
 * its reasoning and, where it consulted policy, the document it cited. A
 * failure earns prose too, because that is the one line someone has to act on.
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
    // gap-4 between rules against gap-1 inside one: a judged rule is a label, a
    // paragraph and a chip that have to read as a single item, and even spacing
    // made three rules look like nine.
    <div className="flex flex-col items-start gap-4 px-4 pt-1 pb-4">
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

      {/* A judged line is the only claim on this screen a person cannot re-derive
          themselves, so it is the only one that has to show its working. The
          reasoning and the policy it cites hang under the label, indented past
          the icon so they read as that rule's justification and not as a new
          item in the list. Both are optional on the wire and nothing renders
          when they are absent - no empty container, no placeholder. */}
      {judged.map((rule) => (
        <div key={rule.ruleId} className="rule-in flex flex-col items-start gap-1">
          <div className="flex items-center gap-2.5 text-[17px] text-secondary">
            <span className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-secondary/15">
              <JudgedIcon className="h-3.5 w-3.5" />
            </span>
            <span className="font-medium">{rule.label}</span>
            <span className="text-[13px] text-on-surface-faint uppercase tracking-[0.08em]">
              {t("decidedByAgent")}
            </span>
          </div>

          {rule.reasoning || rule.evidence ? (
            <p className={`${INDENT} max-w-[74ch] text-[14px] text-on-surface-variant leading-6`}>
              {rule.reasoning}
              {/* Evidence is the record the agent read, not a second sentence -
                  it trails the reasoning quietly rather than getting a heading. */}
              {rule.evidence ? (
                <span className="ml-2 text-on-surface-faint">{rule.evidence}</span>
              ) : null}
            </p>
          ) : null}

          {rule.citation ? (
            isSapSource(rule.citation) ? (
              <span className={`${CHIP} ${INDENT} mt-0.5`}>
                <span className="text-on-surface-faint">{t("citedSource")}&nbsp;</span>
                {rule.citation}
              </span>
            ) : (
              <Link href="/sops" className={`${CHIP} ${CHIP_LINK} ${INDENT} mt-0.5`}>
                <span className="text-on-surface-faint">{t("citedPolicy")}&nbsp;</span>
                {rule.citation}
              </Link>
            )
          ) : null}
        </div>
      ))}

      {/* A failure is the only line anyone has to act on, so it is the only one
          that gets a container. Border and fill rather than a thick coloured
          rail: the block itself is the emphasis.

          The negative margin is its own padding plus border, cancelled: without
          it this block's cross sits 15px right of every other status icon and
          the column of ticks, diamonds and crosses visibly stair-steps. */}
      {failed.map((rule) => (
        <div
          key={rule.ruleId}
          className="rule-in -ml-[15px] flex max-w-[74ch] items-start gap-2.5 rounded-[10px] border border-error/40 bg-error/[0.08] px-3.5 py-3 text-[17px] text-on-surface"
        >
          <span className="mt-0.5 flex h-6 w-6 flex-none items-center justify-center rounded-full bg-error/20 text-error">
            <CrossIcon className="h-3.5 w-3.5" />
          </span>
          {/* The detail, not the label. Every rule is named as the assertion
              that should hold - "PO exists", "Not a duplicate", "Posting period
              open" - which reads correctly beside a green tick and inverts
              beside a red cross: "✗ Not a duplicate" parses as the verdict when
              it means the check of that name failed. The detail is already a
              whole sentence and says the true thing. */}
          <p className="leading-7">{rule.detail ?? `${rule.label}: ${t("stBlocked")}`}</p>
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
