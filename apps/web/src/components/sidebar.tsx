"use client";

import type { MessageKey, Translate } from "@/lib/i18n";
import { BatchIcon, GridIcon, HistoryIcon, QueueIcon, WorkflowIcon } from "./icons";

export type View = "command" | "upload" | "queue" | "approval" | "history";

const ITEMS: { view: View; icon: typeof GridIcon; label: MessageKey }[] = [
  { view: "command", icon: GridIcon, label: "navCommand" },
  { view: "upload", icon: BatchIcon, label: "navUpload" },
  { view: "queue", icon: QueueIcon, label: "navQueue" },
  { view: "approval", icon: WorkflowIcon, label: "navApproval" },
  { view: "history", icon: HistoryIcon, label: "navHistory" },
];

/**
 * The persistent left rail. Active-item styling is the same `primary` accent
 * used for status pills and the approval gate elsewhere in the app - one
 * accent color, reused as "this is the important/selected thing" everywhere
 * it appears, rather than a second palette invented for navigation.
 */
export function Sidebar({
  view,
  onNavigate,
  active,
  queueCount,
  approvalCount,
  t,
}: {
  view: View;
  onNavigate: (view: View) => void;
  /** True while a run is extracting/validating/posting - the "agent active" dot. */
  active: boolean;
  queueCount: number;
  approvalCount: number;
  t: Translate;
}) {
  const badges: Partial<Record<View, number>> = {
    queue: queueCount,
    approval: approvalCount,
  };

  return (
    <aside className="flex w-[248px] flex-none flex-col gap-6 border-outline-variant border-r bg-surface-container-low px-4 py-6">
      <div className="flex items-center gap-3 px-2">
        <span className="flex h-9 w-9 flex-none items-center justify-center rounded-[10px] bg-primary text-on-primary">
          <GridIcon className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <div className="truncate font-semibold text-[16px] text-on-surface leading-tight">
            {t("brand")}
          </div>
          <div className="flex items-center gap-1.5 text-[12px] text-on-surface-faint leading-tight">
            <span
              aria-hidden="true"
              className={`h-1.5 w-1.5 flex-none rounded-full ${active ? "bg-success" : "bg-outline"}`}
            />
            {active ? t("agentActive") : t("agentIdle")}
          </div>
        </div>
      </div>

      <nav className="flex flex-col gap-1">
        {ITEMS.map(({ view: itemView, icon: Icon, label }) => {
          const isActive = view === itemView;
          const badge = badges[itemView];
          return (
            <button
              key={itemView}
              type="button"
              onClick={() => onNavigate(itemView)}
              aria-current={isActive ? "page" : undefined}
              className={`state-layer pressable flex min-h-[42px] cursor-pointer items-center gap-3 rounded-[10px] px-3 text-[15px] transition-colors ${
                isActive
                  ? "bg-primary-container font-semibold text-on-primary-container"
                  : "text-on-surface-variant hover:bg-surface-container hover:text-on-surface"
              }`}
            >
              <Icon className="h-[18px] w-[18px] flex-none" />
              <span className="min-w-0 flex-1 truncate text-left">{t(label)}</span>
              {badge ? (
                <span
                  className={`flex h-5 min-w-5 flex-none items-center justify-center rounded-full px-1.5 font-semibold text-[12px] tabular-nums ${
                    itemView === "approval"
                      ? "bg-primary text-on-primary"
                      : "bg-surface-container-highest text-on-surface-variant"
                  }`}
                >
                  {badge}
                </span>
              ) : null}
            </button>
          );
        })}
      </nav>
    </aside>
  );
}
