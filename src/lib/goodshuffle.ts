import type { Status } from "@/db/schema";
import { normalizeEmail, normalizePhone } from "./normalize";
import { trigramSimilarity } from "./duplicates";
import { addDaysToDate } from "./dates";
import { FUNNEL_RANK } from "./status";

/**
 * Goodshuffle Pro has no public API, but it syncs every project to Google Calendar,
 * one calendar per project status. The CRM reads those calendars through their
 * private iCal links and moves matching leads forward.
 */

export const GS_STATUSES = ["new", "quote_sent", "action_needed", "signed", "lost"] as const;
export type GsStatus = (typeof GS_STATUSES)[number];

export const GS_LABELS: Record<GsStatus, string> = {
  new: "New",
  quote_sent: "Quote Sent",
  action_needed: "Action Needed",
  signed: "Signed",
  lost: "Lost",
};

/** Env var holding each status calendar's "Secret address in iCal format". */
export const GS_ENV: Record<GsStatus, string> = {
  new: "GOODSHUFFLE_ICAL_NEW",
  quote_sent: "GOODSHUFFLE_ICAL_QUOTE_SENT",
  action_needed: "GOODSHUFFLE_ICAL_ACTION_NEEDED",
  signed: "GOODSHUFFLE_ICAL_SIGNED",
  lost: "GOODSHUFFLE_ICAL_LOST",
};

/** Goodshuffle status → CRM status. New = quote still being built: no change. */
export const GS_TO_CRM: Record<GsStatus, Status | null> = {
  new: null,
  quote_sent: "proposal_sent",
  action_needed: "won", // a signed contract that was edited and needs re-signing
  signed: "won",
  lost: "lost",
};

export interface IcsEvent {
  uid: string;
  summary: string;
  description: string;
  location: string;
  /** calendar date (YYYY-MM-DD) the event starts, in the studio's zone */
  startDate: string | null;
}

const unescape = (v: string) => v.replace(/\\n/gi, "\n").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\\\/g, "\\");

/** Minimal RFC 5545 parser: unfolds lines, reads VEVENT UID/SUMMARY/DESCRIPTION/LOCATION/DTSTART. */
export function parseIcs(text: string, tz = "America/Toronto"): IcsEvent[] {
  const lines = text.replace(/\r\n/g, "\n").replace(/\n[ \t]/g, "").split("\n");
  const out: IcsEvent[] = [];
  let cur: Record<string, string> | null = null;
  for (const line of lines) {
    if (line === "BEGIN:VEVENT") cur = {};
    else if (line === "END:VEVENT" && cur) {
      out.push({
        uid: cur.UID ?? "",
        summary: unescape(cur.SUMMARY ?? "").trim(),
        description: unescape(cur.DESCRIPTION ?? "").trim(),
        location: unescape(cur.LOCATION ?? "").trim(),
        startDate: icsDate(cur.DTSTART ?? "", cur.DTSTART_PARAMS ?? "", tz),
      });
      cur = null;
    } else if (cur) {
      const i = line.indexOf(":");
      if (i < 0) continue;
      const [name, ...params] = line.slice(0, i).split(";");
      if (name === "DTSTART") cur.DTSTART_PARAMS = params.join(";");
      if (!(name in cur)) cur[name] = line.slice(i + 1);
    }
  }
  return out.filter((e) => e.uid);
}

/** DTSTART value → local calendar date. Handles all-day dates, UTC times and TZID times. */
export function icsDate(value: string, params: string, tz: string): string | null {
  const m = value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?/);
  if (!m) return null;
  const [, y, mo, d, hh, mm, ss, z] = m;
  if (!hh || !z) return `${y}-${mo}-${d}`; // all-day, or a wall-clock time in its own TZID
  const utc = new Date(Date.UTC(+y, +mo - 1, +d, +hh, +mm, +ss));
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(utc);
}

export function extractContacts(text: string) {
  const emails = [...new Set((text.match(/[^\s@<>()"',;:]+@[^\s@<>()"',;:]+\.[a-z]{2,}/gi) ?? []).map((e) => normalizeEmail(e)).filter(Boolean) as string[])];
  const phones = [...new Set((text.match(/\+?1?[\s.-]?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/g) ?? []).map((p) => normalizePhone(p)).filter(Boolean) as string[])];
  return { emails, phones };
}

export interface CandidateLead {
  id: string;
  firstName: string | null;
  lastName: string | null;
  partnerName: string | null;
  emailNormalized: string | null;
  phoneE164: string | null;
  eventDate: string | null;
}

export interface GsMatch {
  leadId: string | null;
  how: "contact" | "date_and_name" | null;
  confidence: number;
  reason: string;
}

const tokens = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^\p{L}\s]/gu, " ").split(/\s+/).filter((t) => t.length >= 3);
const leadNames = (l: CandidateLead) => [`${l.firstName ?? ""} ${l.lastName ?? ""}`, l.partnerName ?? ""].map((s) => s.trim()).filter(Boolean);

/**
 * Match a Goodshuffle project (calendar event) to one lead.
 * 1. an email or phone in the event that belongs to exactly one lead → match
 * 2. otherwise: leads whose event date is within ±1 day, scored on name overlap with the event text;
 *    the best one wins only if it's clearly ahead of the runner-up. Anything else goes to review.
 */
export function matchEvent(ev: IcsEvent, leads: CandidateLead[]): GsMatch {
  const text = `${ev.summary}\n${ev.description}`;
  const { emails, phones } = extractContacts(text);
  if (emails.length || phones.length) {
    const hits = leads.filter((l) => (l.emailNormalized && emails.includes(l.emailNormalized)) || (l.phoneE164 && phones.includes(l.phoneE164)));
    if (hits.length === 1) return { leadId: hits[0].id, how: "contact", confidence: 1, reason: "Same email or phone" };
    if (hits.length > 1) return { leadId: null, how: null, confidence: 0, reason: `Email/phone matches ${hits.length} leads` };
  }
  if (!ev.startDate) return { leadId: null, how: null, confidence: 0, reason: "Event has no date" };
  const window = new Set([addDaysToDate(ev.startDate, -1), ev.startDate, addDaysToDate(ev.startDate, 1)]);
  const evTokens = new Set(tokens(ev.summary + " " + ev.description.slice(0, 300)));
  const scored = leads
    .filter((l) => l.eventDate && window.has(l.eventDate))
    .map((l) => {
      let best = 0;
      for (const n of leadNames(l)) {
        const nt = tokens(n);
        const overlap = nt.length ? nt.filter((t) => evTokens.has(t)).length / nt.length : 0;
        best = Math.max(best, overlap, trigramSimilarity(n, ev.summary));
      }
      const lastHit = !!l.lastName && tokens(l.lastName).some((t) => evTokens.has(t));
      return { l, score: lastHit ? Math.max(best, 0.75) : best };
    })
    .sort((a, b) => b.score - a.score);
  const [top, second] = scored;
  if (!top || top.score < 0.5) return { leadId: null, how: null, confidence: top?.score ?? 0, reason: scored.length ? "No lead with a matching name on that date" : "No lead with that event date" };
  if (second && second.score >= top.score - 0.15) return { leadId: null, how: null, confidence: top.score, reason: "More than one lead could match" };
  return { leadId: top.l.id, how: "date_and_name", confidence: top.score, reason: "Same event date and name" };
}

/**
 * Forward-only: returns the CRM status to move to, or null to leave it.
 * Never touches merged/unqualified leads, never un-wins a lead except for an explicit Goodshuffle "Lost".
 */
export function plannedStatus(current: Status, gs: GsStatus): Status | null {
  const target = GS_TO_CRM[gs];
  if (!target || target === current) return null;
  if (current === "unqualified") return null;
  if (target === "lost") return current === "lost" ? null : "lost";
  if (current === "lost") return null; // reopening a lost lead is a human decision
  if (target === "won") return current === "won" ? null : "won";
  // proposal_sent: only if the lead hasn't got that far yet
  return FUNNEL_RANK[current] < FUNNEL_RANK.proposal_sent && current !== "won" ? "proposal_sent" : null;
}
