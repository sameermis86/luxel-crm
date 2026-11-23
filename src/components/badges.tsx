import type { Qualification, Status } from "@/db/schema";
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

export function ScoreBadge({ score, band }: { score: number; band: "hot" | "warm" | "cold" }) {
  const style =
    band === "hot" ? "border-bloom bg-bloom text-white" : band === "warm" ? "border-amber/40 bg-amber-soft text-amber" : "border-edge bg-paper text-muted";
  return (
    <span className={`chip tabular ${style}`} title={`Score ${score} (${band})`}>
      {score}
      <span className="font-normal opacity-80">{band}</span>
    </span>
  );
}

const Q_STYLE: Record<Qualification, string> = {
  qualified: "border-stem/40 bg-stem-soft text-stem",
  needs_info: "border-amber/30 bg-amber-soft text-amber",
  unqualified: "border-edge bg-paper text-muted",
};
export const Q_LABEL: Record<Qualification, string> = { qualified: "Qualified", needs_info: "Needs info", unqualified: "Unqualified" };
export function QualBadge({ q, override }: { q: Qualification; override?: boolean }) {
  return (
    <span className={`chip ${Q_STYLE[q]}`} title={override ? "Manually overridden" : undefined}>
      {Q_LABEL[q]}
      {override ? <span aria-label="overridden">*</span> : null}
    </span>
  );
}
