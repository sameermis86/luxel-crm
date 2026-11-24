import { fmtDateTime, fmtMoney, human } from "@/lib/format";
import { STATUS_LABELS } from "@/lib/status";
import type { Status } from "@/db/schema";

export interface TimelineEvent {
  id: string;
  at: string;
  type: string;
  field: string | null;
  oldValue: string | null;
  newValue: string | null;
  payload: any;
  actorName: string | null;
  actorKind: string;
  recordId: string;
}

const FIELD_LABELS: Record<string, string> = {
  firstName: "First name", lastName: "Last name", partnerName: "Partner", email: "Email", phone: "Phone", emailNormalized: "Email (normalized)",
  phoneE164: "Phone (E.164)", eventType: "Event type", eventDate: "Event date", venueName: "Venue", venueCity: "Venue city", guestCount: "Guests",
  budgetMin: "Budget min", budgetMax: "Budget max", estimateTotal: "Quote Builder estimate", servicesRequested: "Services", tierInterest: "Tier",
  message: "Message", source: "Source", captureChannel: "Channel", sourceDetail: "Source detail", campaignId: "Campaign", status: "Status",
  lostReason: "Lost reason", lostReasonDetail: "Lost detail", unqualifiedReason: "Unqualified reason", qualification: "Qualification",
  qualificationOverride: "Qualification override", qualificationOverrideReason: "Override reason", ownerId: "Owner", nextFollowUpAt: "Next follow-up",
  lastContactedAt: "Last contacted", firstReplyAt: "First reply", quoteValue: "Quote", contractValue: "Contract value", collectedAmount: "Collected",
  contactedAt: "Contacted at", consultScheduledAt: "Consult scheduled at", consultHeldAt: "Consult held at", proposalSentAt: "Proposal sent at",
  wonAt: "Won at", lostAt: "Lost at", furthestStage: "Furthest stage", duplicateOfId: "Merged into", returningInquiry: "Returning inquiry",
  archivedAt: "Archived", utmSource: "utm_source", utmMedium: "utm_medium", utmCampaign: "utm_campaign", utmContent: "utm_content", utmTerm: "utm_term",
};
const MONEY = new Set(["budgetMin", "budgetMax", "estimateTotal", "quoteValue", "contractValue", "collectedAmount"]);
const DATETIME = new Set(["nextFollowUpAt", "lastContactedAt", "firstReplyAt", "contactedAt", "consultScheduledAt", "consultHeldAt", "proposalSentAt", "wonAt", "lostAt", "archivedAt"]);
const SYSTEM_DETAIL = new Set(["emailNormalized", "phoneE164", "furthestStage", "contactedAt", "consultScheduledAt", "consultHeldAt", "proposalSentAt", "wonAt", "lostAt"]);

function fmtVal(field: string | null, v: string | null, users: Record<string, string>) {
  if (v === null || v === "") return <span className="text-muted">empty</span>;
  if (!field) return v;
  if (MONEY.has(field)) return fmtMoney(Number(v));
  if (DATETIME.has(field)) return fmtDateTime(v);
  if (field === "status") return STATUS_LABELS[v as Status] ?? v;
  if (field === "ownerId") return users[v] ?? "someone";
  if (field === "servicesRequested") {
    try { return (JSON.parse(v) as string[]).join(", ") || "none"; } catch { return v; }
  }
  if (["eventType", "source", "captureChannel", "qualification", "tierInterest", "lostReason"].includes(field)) return human(v);
  return v.length > 140 ? v.slice(0, 140) + "…" : v;
}

const ICON: Record<string, string> = {
  created: "✦", imported: "⇣", call_logged: "☏", email_logged: "✉", meeting_logged: "◷", note_added: "✎", follow_up_set: "⏲", follow_up_done: "✓",
  status_changed: "→", assigned: "◉", scored: "#", qualified: "◆", field_changed: "·", merged: "⇄", converted: "★", returning_inquiry: "↺", archived: "▢",
};

function title(e: TimelineEvent, users: Record<string, string>) {
  const p = e.payload ?? {};
  switch (e.type) {
    case "created": return `Lead created${p.mode === "webhook" ? ` from the ${p.form === "quote_builder" ? "Quote Builder" : "Contact Us form"}` : p.mode === "manual" ? " manually" : ""}`;
    case "imported": return "Imported from CSV";
    case "call_logged": return `Call ${p.direction === "inbound" ? "received" : "made"}${p.outcome ? ` · ${p.outcome}` : ""}`;
    case "email_logged": return `Email ${p.direction === "inbound" ? "received" : "sent"}${p.outcome ? ` · ${p.outcome}` : ""}`;
    case "meeting_logged": return `Meeting${p.outcome ? ` · ${p.outcome}` : ""}`;
    case "note_added": return "Note";
    case "follow_up_done": return `Follow-up done${p.reason ? ` (${p.reason})` : p.viaActivity ? ` (by logging a ${p.viaActivity})` : ""}`;
    case "follow_up_set": return `Follow-up set for ${fmtDateTime(e.newValue)}${p.note ? ` · ${p.note}` : ""}`;
    case "converted": return `Converted · ${fmtMoney(p.contractValue)} in ${p.daysToConvert} days`;
    case "returning_inquiry": return `Returning inquiry${p.form ? ` via ${p.form === "quote_builder" ? "Quote Builder" : "Contact Us"}` : ""}`;
    case "merged": return e.field === "duplicateOfId" ? "Merged into another record" : `Merged ${p.mergedRecordId ?? "a record"} into this lead`;
    case "assigned": return e.newValue ? `Assigned to ${users[e.newValue] ?? "someone"}${p.ruleName ? ` (rule: ${p.ruleName})` : p.how === "manual" ? " manually" : ""}` : "Unassigned";
    default: return FIELD_LABELS[e.field ?? ""] ?? human(e.type);
  }
}

export function Timeline({ events: all, users, leadRecordId, showSystem }: { events: TimelineEvent[]; users: Record<string, string>; leadRecordId: string; showSystem?: boolean }) {
  // derived bookkeeping (stage timestamps, normalized email/phone) is recorded but only shown under "Field changes"
  const events = showSystem ? all : all.filter((e) => !SYSTEM_DETAIL.has(e.field ?? ""));
  if (!events.length) return <p className="text-sm text-muted">Nothing here yet.</p>;
  return (
    <ol className="relative space-y-3 border-l border-edge pl-5">
      {events.map((e) => {
        const p = e.payload ?? {};
        const who = e.actorName ?? (e.actorKind === "webhook" ? "Website" : e.actorKind === "import" ? "Import" : "System");
        const isChange = e.field && e.type !== "assigned" && !["merged", "follow_up_set"].includes(e.type);
        const subtle = SYSTEM_DETAIL.has(e.field ?? "");
        return (
          <li key={e.id} className={`relative ${subtle ? "opacity-70" : ""}`}>
            <span className="absolute -left-[27px] flex h-4 w-4 items-center justify-center rounded-full border border-edge bg-card text-[9px] text-muted" aria-hidden>
              {ICON[e.type] ?? "·"}
            </span>
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
              <span className="font-medium">
                {title(e, users)}
                {e.recordId !== leadRecordId && <span className="chip ml-2 border-edge font-normal text-muted">{e.recordId}</span>}
              </span>
              <span className="text-xs text-muted tabular">
                {who} · <time dateTime={e.at}>{fmtDateTime(e.at)}</time>
              </span>
            </div>
            {isChange && (
              <p className="text-sm">
                <span className="text-muted line-through decoration-muted/50">{fmtVal(e.field, e.oldValue, users)}</span>
                <span className="mx-1.5 text-muted">→</span>
                <span>{fmtVal(e.field, e.newValue, users)}</span>
                {e.field === "qualification" && p.reasons?.length ? <span className="text-muted"> ({p.reasons.join("; ")})</span> : null}
                {e.field === "qualification" && p.override ? <span className="text-muted"> (override: {p.overrideReason})</span> : null}
              </p>
            )}
            {p.summary ? <p className="mt-0.5 text-sm whitespace-pre-wrap text-ink/90">{p.summary}</p> : null}
            {(e.type === "created" || e.type === "returning_inquiry") && (p.message || p.raw?.message || p.fields?.message) ? (
              <p className="mt-0.5 text-sm whitespace-pre-wrap text-ink/80">“{p.message ?? p.raw?.message ?? p.fields?.message}”</p>
            ) : null}
            {(e.type === "created" || e.type === "imported" || e.type === "returning_inquiry") && (p.raw || p.row) ? (
              <details className="mt-1 text-xs">
                <summary className="cursor-pointer text-muted">Raw {e.type === "imported" ? "import row" : "submission"}</summary>
                <pre className="mt-1 max-h-64 overflow-auto rounded bg-paper p-2">{JSON.stringify(p.raw ?? p.row, null, 2)}</pre>
              </details>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
