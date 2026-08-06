import type { ToolCallEvent } from "@/lib/events";
import type { Translate } from "@/lib/i18n";

/**
 * The agent's actual SAP reads, as they happen.
 *
 * Cheapest possible proof that a run is live rather than simulated - which is
 * exactly what a technical jury wants to see.
 */
export function CallRail({
  calls,
  live,
  t,
}: {
  calls: ToolCallEvent[];
  live: boolean;
  t: Translate;
}) {
  return (
    <aside className="flex flex-col gap-[3px] overflow-hidden border-line border-l bg-[#0c0c0f] px-3 pt-3 pb-5">
      <div className="flex items-center gap-1.5 pb-2 font-data text-[9.5px] text-ink-faint uppercase tracking-[0.14em]">
        <span
          className={`h-[5px] w-[5px] flex-none rounded-full transition-colors ${
            live ? "bg-ok" : "bg-pending"
          }`}
        />
        {t("railHead")}
      </div>

      {calls.map((call, index) => (
        <div
          key={`${call.resource}-${index}`}
          className={`call-in flex gap-1.5 break-all font-data text-[10.5px] text-ink-dim leading-[1.45] ${
            index < calls.length - 6 ? "opacity-40" : ""
          }`}
        >
          <span className="flex-none text-brass">{call.method}</span>
          <span>{call.resource}</span>
          {call.ms ? <span className="ml-auto flex-none text-ink-faint">{call.ms}ms</span> : null}
        </div>
      ))}
    </aside>
  );
}
