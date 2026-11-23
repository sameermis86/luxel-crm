import type { LostReason, Status } from "@/db/schema";

/** The one place that defines which status moves are allowed. */
const OPEN: Status[] = ["new", "contacted", "consult_scheduled", "consult_held", "proposal_sent", "on_hold"];

export const TRANSITIONS: Record<Status, Status[]> = {
  new: ["contacted", "consult_scheduled", "consult_held", "proposal_sent", "won", "lost", "unqualified", "on_hold"],
  contacted: ["new", "consult_scheduled", "consult_held", "proposal_sent", "won", "lost", "unqualified", "on_hold"],
  consult_scheduled: ["contacted", "consult_held", "proposal_sent", "won", "lost", "unqualified", "on_hold"],
  consult_held: ["consult_scheduled", "proposal_sent", "won", "lost", "unqualified", "on_hold"],
  proposal_sent: ["consult_held", "won", "lost", "on_hold"],
  on_hold: ["new", "contacted", "consult_scheduled", "consult_held", "proposal_sent", "won", "lost", "unqualified"],
  won: ["lost"], // cancellation
  lost: ["new", "contacted", "consult_scheduled", "proposal_sent"], // reopen
  unqualified: ["new", "contacted"], // reopen
};

export const OPEN_STATUSES = OPEN;
export const CLOSED_STATUSES: Status[] = ["won", "lost", "unqualified"];
export const isOpen = (s: Status) => !CLOSED_STATUSES.includes(s);

/** Funnel order. on_hold/lost/unqualified don't advance the funnel. */
export const FUNNEL_RANK: Record<Status, number> = {
  new: 0, contacted: 1, consult_scheduled: 2, consult_held: 3, proposal_sent: 4, won: 5,
  on_hold: 0, lost: 0, unqualified: 0,
};
export const FUNNEL_STAGES = [
  { key: "new", label: "New", rank: 0 },
  { key: "contacted", label: "Contacted", rank: 1 },
  { key: "consult", label: "Consult", rank: 2 },
  { key: "proposal", label: "Proposal", rank: 4 },
  { key: "won", label: "Won", rank: 5 },
] as const;

/** Column on `leads` that records when a lead first entered a stage. */
export const STAGE_TIMESTAMP: Partial<Record<Status, string>> = {
  contacted: "contactedAt",
  consult_scheduled: "consultScheduledAt",
  consult_held: "consultHeldAt",
  proposal_sent: "proposalSentAt",
  won: "wonAt",
  lost: "lostAt",
};

export const STATUS_LABELS: Record<Status, string> = {
  new: "New", contacted: "Contacted", consult_scheduled: "Consult scheduled", consult_held: "Consult held",
  proposal_sent: "Proposal sent", won: "Won", lost: "Lost", unqualified: "Unqualified", on_hold: "On hold",
};
export const LOST_REASON_LABELS: Record<LostReason, string> = {
  price: "Price", date_unavailable: "Date unavailable", went_with_competitor: "Went with competitor",
  no_response: "No response", out_of_scope: "Out of scope", other: "Other",
};

export function canTransition(from: Status, to: Status): boolean {
  return from !== to && TRANSITIONS[from].includes(to);
}

export type TransitionField = "contractValue" | "lostReason" | "unqualifiedReason";
export function transitionRequirements(to: Status): TransitionField[] {
  if (to === "won") return ["contractValue"];
  if (to === "lost") return ["lostReason"];
  if (to === "unqualified") return ["unqualifiedReason"];
  return [];
}

export interface TransitionExtras {
  contractValue?: number | null;
  lostReason?: LostReason | null;
  unqualifiedReason?: string | null;
}

export function validateTransition(from: Status, to: Status, extras: TransitionExtras): { ok: true } | { ok: false; error: string } {
  if (!canTransition(from, to)) return { ok: false, error: `Can't move a lead from ${STATUS_LABELS[from]} to ${STATUS_LABELS[to]}` };
  if (to === "won" && !(extras.contractValue != null && extras.contractValue > 0))
    return { ok: false, error: "Contract value is required to mark a lead won" };
  if (to === "lost" && !extras.lostReason) return { ok: false, error: "A lost reason is required" };
  if (to === "unqualified" && !extras.unqualifiedReason?.trim()) return { ok: false, error: "An unqualified reason is required" };
  return { ok: true };
}
