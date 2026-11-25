import Link from "next/link";
import { withPage } from "@/server/page";
import { myFollowUps, myLeadsWithoutFollowUp, newUnassignedLeads, type FollowUpRow } from "@/server/followups";
import { can } from "@/server/auth";
import { StatusPill } from "@/components/badges";
import { fmtDate, fmtShortDateTime, fmtRelative, fullName } from "@/lib/format";
import type { Status } from "@/db/schema";
import { DoneButton } from "./done-button";
import { PageHeader } from "@/components/page-header";

export const dynamic = "force-dynamic";

export default async function FollowUpsPage() {
  const data = await withPage(async (tx, p) => {
    const f = await myFollowUps(tx, p.session.userId, p.now, p.settings.businessHours.timezone);
    return {
      ...f,
      none: await myLeadsWithoutFollowUp(tx, p.session.userId),
      unassigned: can(p.session, "leads:read_all") ? await newUnassignedLeads(tx) : [],
    };
  }, "sales:view");
  const { overdue, today, upcoming, none, unassigned, page } = data;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Sales & CRM"
        title="My follow-ups"
        description={<><span className="font-medium text-bloom-strong">{overdue.length} overdue</span> · {today.length} due today · {upcoming.length} upcoming</>}
        actions={<Link href="/leads?owner=me&awaiting=1" className="btn">All my leads awaiting follow-up</Link>}
      />

      <Section title="Overdue" tone="bloom" rows={overdue} now={page.now} empty="Nothing overdue." />
      <Section title="Due today" tone="ink" rows={today} now={page.now} empty="Nothing else due today." />
      <Section title="Upcoming" tone="muted" rows={upcoming.slice(0, 50)} now={page.now} empty="Nothing scheduled." />

      {none.length > 0 && (
        <section className="card p-5">
          <h2 className="text-xl text-amber">My open leads with no follow-up <span className="text-sm text-muted">({none.length})</span></h2>
          <ul className="mt-2 divide-y divide-edge text-sm">
            {none.map((l) => (
              <li key={l.id} className="flex items-center justify-between gap-2 py-2">
                <Link href={`/leads/${l.id}`} className="hover:underline"><span className="text-muted tabular">{l.recordId}</span> {fullName(l)}</Link>
                <span className="flex items-center gap-2"><StatusPill status={l.status as Status} /></span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {unassigned.length > 0 && (
        <section className="card p-5">
          <h2 className="text-xl text-stem">New unassigned leads <span className="text-sm text-muted">({unassigned.length})</span></h2>
          <ul className="mt-2 divide-y divide-edge text-sm">
            {unassigned.map((l) => (
              <li key={l.id} className="flex items-center justify-between gap-2 py-2">
                <Link href={`/leads/${l.id}`} className="hover:underline"><span className="text-muted tabular">{l.recordId}</span> {fullName(l)}</Link>
                <span className="text-xs text-muted">{fmtRelative(l.createdAt, page.now)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Section({ title, tone, rows, now, empty }: { title: string; tone: "bloom" | "ink" | "muted"; rows: FollowUpRow[]; now: Date; empty: string }) {
  const color = tone === "bloom" ? "text-bloom" : tone === "ink" ? "text-ink" : "text-muted";
  return (
    <section className={`card p-4 ${tone === "bloom" && rows.length ? "border-bloom/40" : ""}`}>
      <h2 className={`text-xl ${color}`}>{title} <span className="text-sm text-muted">({rows.length})</span></h2>
      {rows.length === 0 ? (
        <p className="mt-2 text-sm text-muted">{empty}</p>
      ) : (
        <ul className="mt-2 divide-y divide-edge">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-2 text-sm">
              <div className="min-w-0">
                <Link href={`/leads/${r.leadId}`} className="font-medium hover:underline">
                  <span className="font-normal text-muted tabular">{r.recordId}</span> {fullName(r)}
                </Link>
                <div className="text-xs text-muted">
                  {r.note ?? "Follow up"} · event {fmtDate(r.eventDate)}
                </div>
              </div>
              <div className="flex items-center gap-3">
                <StatusPill status={r.status as Status} />
                <span className={`tabular ${tone === "bloom" ? "font-medium text-bloom" : ""}`} title={fmtShortDateTime(r.dueAt)}>
                  {fmtShortDateTime(r.dueAt)} <span className="text-xs text-muted">({fmtRelative(r.dueAt, now)})</span>
                </span>
                <DoneButton followUpId={r.id} leadId={r.leadId} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
