import type { EventType, Status } from "@/db/schema";
import { CLOSED_STATUSES } from "./status";

/** SMS reminders sent one-tap from the office iPhone (sms: link → Messages). Pure rules, no I/O. */

export interface SmsSettings { senderName: string; consentDays: number; minDaysBetween: number; templates: { label: string; body: string }[] }
export interface SmsLead {
  firstName: string | null;
  phoneE164: string | null;
  status: Status;
  createdAt: Date;
  smsOptOutAt: Date | null;
  eventType: EventType;
  eventDate: string | null;
  venueName: string | null;
}

export const STOP_LINE = "Reply STOP to opt out.";
const DAY = 86_400_000;

/** Can we text this lead now? CASL: consent from an inquiry lasts 6 months; an opt-out is final. */
export function smsEligibility(l: SmsLead, now: Date, s: SmsSettings, lastTextAt: Date | null): { ok: true } | { ok: false; reason: string } {
  if (!l.phoneE164) return { ok: false, reason: "No mobile number" };
  if (l.smsOptOutAt) return { ok: false, reason: "Asked not to be texted" };
  if (CLOSED_STATUSES.includes(l.status)) return { ok: false, reason: "Lead is closed" };
  if (now.getTime() - l.createdAt.getTime() > s.consentDays * DAY) return { ok: false, reason: `Inquired over ${Math.round(s.consentDays / 30)} months ago (no consent to text)` };
  if (lastTextAt && now.getTime() - lastTextAt.getTime() < s.minDaysBetween * DAY) return { ok: false, reason: `Texted ${Math.max(0, Math.floor((now.getTime() - lastTextAt.getTime()) / DAY))} day(s) ago` };
  return { ok: true };
}

const EVENT_WORD: Record<EventType, string> = { wedding: "wedding", corporate: "event", social: "celebration", rental_only: "rental", other: "event" };

/** Fill a template; always identifies the sender and ends with the opt-out line. */
export function renderSms(body: string, l: SmsLead, s: Pick<SmsSettings, "senderName">): string {
  const date = l.eventDate
    ? " on " + new Date(l.eventDate + "T12:00:00Z").toLocaleDateString("en-CA", { month: "long", day: "numeric", timeZone: "UTC" })
    : "";
  const out = body
    .replace(/\{first_name\}/g, l.firstName?.trim() || "there")
    .replace(/\{sender\}/g, s.senderName)
    .replace(/\{event\}/g, EVENT_WORD[l.eventType] ?? "event")
    .replace(/\{event_date\}/g, date)
    .replace(/\{venue\}/g, l.venueName ? ` at ${l.venueName}` : "")
    .replace(/\s+/g, " ")
    .trim();
  const named = out.includes(s.senderName) ? out : `${out} – ${s.senderName}`;
  return /\bSTOP\b/.test(named) ? named : `${named} ${STOP_LINE}`;
}

/** sms: link that opens Messages with the text filled in ("?&body=" works on iPhone and Android). */
export const smsHref = (phoneE164: string, text: string) => `sms:${phoneE164}?&body=${encodeURIComponent(text)}`;

/** Is this a mobile-looking Canadian/US number? (We can't know for sure: landlines just won't receive.) */
export const textable = (phoneE164: string | null) => !!phoneE164 && /^\+1\d{10}$/.test(phoneE164);

/* ----------------------------- email reminders ----------------------------- */

export interface EmailLead extends Omit<SmsLead, "phoneE164" | "smsOptOutAt"> { email: string | null; emailOptOutAt: Date | null }

/** Same rules as texts (CASL consent window, opt-out, open lead, spacing), for the email address. */
export function emailEligibility(l: EmailLead, now: Date, s: Pick<SmsSettings, "consentDays" | "minDaysBetween">, lastReminderAt: Date | null): { ok: true } | { ok: false; reason: string } {
  if (!l.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(l.email)) return { ok: false, reason: "No email address" };
  if (l.emailOptOutAt) return { ok: false, reason: "Unsubscribed from emails" };
  return smsEligibility({ ...l, phoneE164: "+10000000000", smsOptOutAt: null }, now, { ...s, senderName: "", templates: [] }, lastReminderAt);
}

/** Fill an email template: subject + plain-text body with the sign-off and the unsubscribe line. */
export function renderEmail(t: { subject: string; body: string }, l: Omit<SmsLead, "phoneE164" | "smsOptOutAt" | "createdAt" | "status">, o: { senderName: string; signature: string; unsubscribeUrl: string }) {
  const fill = (x: string) => {
    const date = l.eventDate ? " on " + new Date(l.eventDate + "T12:00:00Z").toLocaleDateString("en-CA", { month: "long", day: "numeric", timeZone: "UTC" }) : "";
    return x
      .replace(/\{first_name\}/g, l.firstName?.trim() || "there")
      .replace(/\{sender\}/g, o.senderName)
      .replace(/\{event\}/g, EVENT_WORD[l.eventType] ?? "event")
      .replace(/\{event_date\}/g, date)
      .replace(/\{venue\}/g, l.venueName ? ` at ${l.venueName}` : "");
  };
  return { subject: fill(t.subject).replace(/\s+/g, " ").trim(), body: fill(t.body).trim() };
}

/** What goes after the body in every reminder email (not editable per message). */
export const emailFooter = (o: { senderName: string; signature: string; unsubscribeUrl: string }) =>
  `\n\n${o.senderName}\n${o.signature}\n\nDon't want these emails? Unsubscribe: ${o.unsubscribeUrl}`;
