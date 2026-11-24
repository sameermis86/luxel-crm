import Link from "next/link";
import { withPage } from "@/server/page";
import { textQueue } from "@/server/sms";
import { PageHeader } from "@/components/page-header";
import { StatusPill } from "@/components/badges";
import { fmtDate, fmtRelative, fullName } from "@/lib/format";
import { TextComposer } from "../leads/text-composer";

export const dynamic = "force-dynamic";
export const metadata = { title: "Texts to send" };

/** Leads waiting on a follow-up that we may text, for whoever has the office iPhone. */
export default async function TextsPage() {
  const { rows, skipped, page } = await withPage(async (tx, p) => textQueue(tx, p.now, p.settings));
  const s = page.settings.sms;
  const skippedList = Object.entries(skipped).sort((a, b) => b[1] - a[1]);
  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Sales & CRM"
        title="Texts to send"
        description={
          <>
            Open this on the office iPhone: <strong className="font-medium text-ink">Open in Messages</strong> fills in the text, send it, then tap{" "}
            <strong className="font-medium text-ink">Mark as sent</strong>. {rows.length} lead{rows.length === 1 ? "" : "s"} waiting on a follow-up can be texted now.
          </>
        }
      />
      {skippedList.length > 0 && (
        <p className="text-sm text-muted">
          Left out: {skippedList.map(([why, n]) => `${n} · ${why.toLowerCase()}`).join("; ")}. Canada&apos;s anti-spam law (CASL) allows texting someone for {Math.round(s.consentDays / 30)} months after they inquire,
          and every text names {s.senderName} and says how to opt out.
        </p>
      )}
      {rows.length === 0 ? (
        <div className="card px-5 py-12 text-center text-sm text-muted">No texts to send right now.</div>
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
                    {r.lastTextAt ? ` · last texted ${fmtRelative(r.lastTextAt, page.now)}` : " · never texted"}
                  </p>
                </div>
                <StatusPill status={r.status} />
              </div>
              <TextComposer
                compact
                lead={{ id: r.id, firstName: r.firstName, phoneE164: r.phoneE164!, status: r.status, eventType: r.eventType, eventDate: r.eventDate, venueName: r.venueName }}
                templates={s.templates}
                senderName={s.senderName}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
