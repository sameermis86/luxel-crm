import type { Status } from "@/db/schema";
import { STATUS_LABELS } from "@/lib/status";

/** One tone per status, shared by every pill and the inline status dropdown. */
export const STATUS_TONE: Record<Status, { pill: string; dot: string }> = {
  new: { pill: "border-bloom/25 bg-bloom-soft text-bloom-strong", dot: "bg-bloom" },
  contacted: { pill: "border-edge-strong bg-card text-ink", dot: "bg-ink/60" },
  consult_scheduled: { pill: "border-stem/25 bg-stem-soft text-stem-strong", dot: "bg-stem" },
  consult_held: { pill: "border-stem/25 bg-stem-soft text-stem-strong", dot: "bg-stem-strong" },
  proposal_sent: { pill: "border-amber/25 bg-amber-soft text-amber", dot: "bg-amber" },
  won: { pill: "border-stem-strong bg-stem-strong text-white", dot: "bg-white" },
  lost: { pill: "border-edge bg-paper-2/70 text-muted", dot: "bg-faint" },
  unqualified: { pill: "border-edge bg-paper-2/70 text-muted", dot: "bg-faint" },
  on_hold: { pill: "border-edge bg-paper-2/70 text-muted", dot: "bg-amber/70" },
  not_reachable: { pill: "border-dashed border-edge-strong bg-card text-muted", dot: "bg-faint" },
};

export function StatusPill({ status }: { status: Status }) {
  const t = STATUS_TONE[status];
  return (
    <span className={`chip ${t.pill}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${t.dot}`} aria-hidden />
      {STATUS_LABELS[status]}
    </span>
  );
}
