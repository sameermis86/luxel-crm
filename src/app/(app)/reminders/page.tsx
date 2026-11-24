import Link from "next/link";
import { withPage } from "@/server/page";
import { reminderQueue } from "@/server/sms";
import { emailRemindersConfigured } from "@/server/email-reminders";
import { PageHeader } from "@/components/page-header";
import { StatusPill } from "@/components/badges";
import { fmtDate, fmtRelative, fullName } from "@/lib/format";
import { ReminderComposer } from "../leads/text-composer";

export const dynamic = "force-dynamic";
export const metadata = { title: "Reminders" };

/**
 * Leads waiting on a follow-up that may get a reminder, by text (one-tap from the office iPhone) or
 * email (sent from info@ after review). Nothing is sent without someone clicking.
 */
export default async function RemindersPage() {
  const { rows, skipped, page } = await withPage(async (tx, p) => reminderQueue(tx, p.now, p.settings));
  const s = page.settings;
  const emailOn = emailRemindersConfigured();
  const skippedList = Object.entries(skipped).sort((a, b) => b[1] - a[1]);
  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Sales & CRM"
        title="Reminders"
        description={
          <>
            {rows.length} lead{rows.length === 1 ? "" : "s"} waiting on a follow-up can get a reminder. <strong className="font-medium text-ink">Text</strong>: open this on the
            office iPhone, tap Open in Messages, send, then Mark as sent. <strong className="font-medium text-ink">Email</strong>: review, then Send; it goes from info@ and lands in Sent.
          </>
        }
      />
      {skippedList.length > 0 && (
        <p className="text-sm text-muted">
          Left out: {skippedList.map(([why, n]) => `${n} · ${why.toLowerCase()}`).join("; ")}. Canada&apos;s anti-spam law (CASL) allows reminders for {Math.round(s.sms.consentDays / 30)} months
          after someone inquires; every text and email names {s.sms.senderName} and says how to opt out.
        </p>
      )}
      {rows.length === 0 ? (
        <div className="card px-5 py-12 text-center text-sm text-muted">No reminders to send right now.</div>
      ) : (
        <ul className="space-y-3">
          {rows.map((r) => (
            <li key={r.id} className="card p-4">
              <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <Link href={`/leads/${r.id}`} className="font-medium hover:text-bloom-strong">{fullName(r)}</Link>
                  <p className="text-xs text-muted">
                    <span className="font-mono">{r.recordId}</span> · {r.eventDate ? fmtDate(r.eventDate) : "no date"}{r.venueName ? ` · ${r.venueName}` : ""} · {r.ownerName ?? "Unassigned"}
                  </p>
                  <p className="mt-0.5 text-xs text-muted">
                    Follow-up {r.nextFollowUpAt ? fmtRelative(r.nextFollowUpAt, page.now) : "not set"}
                    {r.lastReminderAt ? ` · last reminded ${fmtRelative(r.lastReminderAt, page.now)}` : " · no reminder yet"}
                  </p>
                </div>
                <StatusPill status={r.status} />
              </div>
              <ReminderComposer
                compact
                canText={r.canText}
                canEmail={r.canEmail && emailOn}
                textLead={r.canText ? { id: r.id, firstName: r.firstName, phoneE164: r.phoneE164!, status: r.status, eventType: r.eventType, eventDate: r.eventDate, venueName: r.venueName } : null}
                emailLead={r.canEmail ? { id: r.id, email: r.email!, firstName: r.firstName, eventType: r.eventType, eventDate: r.eventDate, venueName: r.venueName } : null}
                sms={{ templates: s.sms.templates, senderName: s.sms.senderName }}
                email={{ templates: s.emailReminders.templates, signature: s.emailReminders.signature }}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
