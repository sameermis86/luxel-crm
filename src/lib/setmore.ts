import { normalizeEmail, normalizePhone } from "./normalize";
import type { Status } from "@/db/schema";
import { FUNNEL_RANK } from "./status";

/** Setmore API v2 shapes (only the fields we read). */
export interface SmBooking {
  id: string;
  type?: string; // APPOINTMENT | SESSION | EVENT
  provider_id?: string;
  consumer_ids?: string[];
  service_id?: string;
  start_at: string;
  end_at?: string;
  title?: string;
  notes?: string;
  status?: string; // CONFIRMED | CANCELLED
  label?: string;
}
export interface SmContactValue { value?: string; primary?: boolean; deleted?: boolean }
export interface SmCustomer {
  id: string;
  first_name?: string;
  last_name?: string;
  email_addresses?: SmContactValue[];
  phone_numbers?: SmContactValue[];
}
export interface SmNamed { id: string; name?: string; first_name?: string; last_name?: string }

/** Primary, non-deleted value first. */
export function pickValue(list?: SmContactValue[]): string | null {
  const live = (list ?? []).filter((v) => v.value && !v.deleted);
  return (live.find((v) => v.primary) ?? live[0])?.value?.trim() || null;
}

export interface AppointmentRow {
  externalId: string;
  customerExternalId: string | null;
  customerName: string | null;
  email: string | null;
  emailNormalized: string | null;
  phoneE164: string | null;
  serviceName: string | null;
  staffName: string | null;
  startsAt: Date;
  endsAt: Date | null;
  status: "confirmed" | "cancelled";
  label: string | null;
  notes: string | null;
}

const nameOf = (n?: SmNamed) => (n ? n.name ?? ([n.first_name, n.last_name].filter(Boolean).join(" ") || null) : null);

/** One appointment → the row we store. Events (no customer) and class sessions are skipped. */
export function bookingToRow(b: SmBooking, customer: SmCustomer | undefined, service?: SmNamed, staff?: SmNamed): AppointmentRow | null {
  if (b.type && b.type !== "APPOINTMENT") return null;
  const start = new Date(b.start_at);
  if (Number.isNaN(start.getTime())) return null;
  const email = pickValue(customer?.email_addresses);
  return {
    externalId: b.id,
    customerExternalId: b.consumer_ids?.[0] ?? null,
    customerName: customer ? [customer.first_name, customer.last_name].filter(Boolean).join(" ").trim() || null : null,
    email,
    emailNormalized: normalizeEmail(email),
    phoneE164: normalizePhone(pickValue(customer?.phone_numbers)),
    serviceName: nameOf(service) ?? b.title ?? null,
    staffName: nameOf(staff),
    startsAt: start,
    endsAt: b.end_at ? new Date(b.end_at) : null,
    status: (b.status ?? "CONFIRMED").toUpperCase() === "CANCELLED" ? "cancelled" : "confirmed",
    label: b.label ?? null,
    notes: b.notes?.slice(0, 2000) ?? null,
  };
}

/** Match by exact email or phone against live leads (merged duplicates resolve to the survivor). */
export function matchLead(
  row: Pick<AppointmentRow, "emailNormalized" | "phoneE164">,
  leads: { id: string; emailNormalized: string | null; phoneE164: string | null }[],
): string | null {
  if (row.emailNormalized) {
    const m = leads.find((l) => l.emailNormalized === row.emailNormalized);
    if (m) return m.id;
  }
  if (row.phoneE164) {
    const m = leads.find((l) => l.phoneE164 === row.phoneE164);
    if (m) return m.id;
  }
  return null;
}

/** Lead statuses a Setmore booking may move forward. Won/lost/unqualified/on hold are human decisions. */
const BOOKING_MOVABLE: Status[] = ["new", "contacted", "not_reachable", "consult_scheduled"];

/**
 * Forward-only status a lead's bookings support, or null to leave it.
 * A confirmed booking that has ended → Consult held; one still ahead → Consult scheduled.
 * Cancelled bookings never move a lead.
 */
export function plannedConsultStatus(
  current: Status,
  bookings: { startsAt: Date; endsAt: Date | null; status: string }[],
  now: Date,
): { to: Status; startsAt: Date } | null {
  if (!BOOKING_MOVABLE.includes(current)) return null;
  const live = bookings.filter((b) => b.status === "confirmed");
  const held = live.filter((b) => (b.endsAt ?? b.startsAt) <= now).sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime())[0];
  if (held && current !== "consult_held") return { to: "consult_held", startsAt: held.startsAt };
  const ahead = live.filter((b) => (b.endsAt ?? b.startsAt) > now).sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())[0];
  if (ahead && FUNNEL_RANK[current] < FUNNEL_RANK.consult_scheduled) return { to: "consult_scheduled", startsAt: ahead.startsAt };
  return null;
}

export interface BookingTypeRules { wonServices: string[]; proposalServices: string[] }
type BookingLike = { startsAt: Date; endsAt: Date | null; status: string; serviceName: string | null };
const has = (name: string | null, list: string[]) => !!name && list.some((x) => x.trim() && name.toLowerCase().includes(x.trim().toLowerCase()));

/**
 * Status for a lead created from Setmore bookings (someone not in the CRM yet): the furthest stage
 * any confirmed booking shows. "Existing booking" services → Won, quote reviews → Proposal sent,
 * consultations → Consult held (ended) or Consult scheduled (ahead). Null when nothing is confirmed.
 */
export function statusForNewLead(bookings: BookingLike[], now: Date, rules: BookingTypeRules): Status | null {
  let best: Status | null = null;
  for (const b of bookings) {
    if (b.status !== "confirmed") continue;
    const s: Status = has(b.serviceName, rules.wonServices)
      ? "won"
      : has(b.serviceName, rules.proposalServices)
        ? "proposal_sent"
        : (b.endsAt ?? b.startsAt) <= now ? "consult_held" : "consult_scheduled";
    if (!best || FUNNEL_RANK[s] > FUNNEL_RANK[best]) best = s;
  }
  return best;
}

/** Name fallback when email and phone don't match: only when exactly one live lead has that full name. */
export function matchLeadByName(
  name: string | null,
  leads: { id: string; firstName: string | null; lastName: string | null }[],
): string | null {
  const norm = (x: string) => x.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
  const n = name ? norm(name) : "";
  if (!n.includes(" ")) return null; // a first name alone is too weak
  const hits = leads.filter((l) => norm(`${l.firstName ?? ""} ${l.lastName ?? ""}`) === n);
  return hits.length === 1 ? hits[0].id : null;
}
