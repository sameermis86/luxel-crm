import type { Status } from "@/db/schema";
import { STATUS_LABELS } from "@/lib/status";

const STATUS_STYLE: Record<Status, string> = {
  new: "border-bloom/30 bg-bloom-soft text-bloom",
  contacted: "border-edge bg-paper text-ink",
  consult_scheduled: "border-stem/30 bg-stem-soft text-stem",
  consult_held: "border-stem/40 bg-stem-soft text-stem",
  proposal_sent: "border-amber/30 bg-amber-soft text-amber",
  won: "border-stem bg-stem text-white",
  lost: "border-edge bg-paper text-muted",
  unqualified: "border-edge bg-paper text-muted",
  on_hold: "border-edge bg-paper text-muted",
};

export function StatusPill({ status }: { status: Status }) {
  return <span className={`chip ${STATUS_STYLE[status]}`}>{STATUS_LABELS[status]}</span>;
}
