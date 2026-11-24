import Link from "next/link";
import { notFound } from "next/navigation";
import { withPage } from "@/server/page";
import { can } from "@/server/auth";
import { getLeadDetail, getTimeline, listUsers, type TimelineFilter } from "@/server/leads/queries";
import { StatusPill } from "@/components/badges";
import { MATCH_REASON_LABELS, type MatchReason } from "@/lib/duplicates";
import { LOST_REASON_LABELS, STATUS_LABELS, TRANSITIONS } from "@/lib/status";
import { fmtDate, fmtDateTime, fmtMoney, fmtRelative, fullName, titleCase, toLocalInput } from "@/lib/format";
import { suggestNextFollowUp } from "@/lib/business-hours";
import { QuickActions } from "./quick-actions";
import { Timeline } from "./timeline";
import { EditDetails } from "./edit-details";
import { CompleteFollowUpButton, DismissDuplicateButton, MarkSeen } from "./small-actions";

export const dynamic = "force-dynamic";

export default async function LeadPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const tl = (["all", "activities", "changes"].includes(sp.tl ?? "") ? sp.tl : "all") as TimelineFilter;
  const data = await withPage(async (tx) => {
    const detail = await getLeadDetail(tx, id);
    if (!detail) return { detail: null, timeline: [], users: [] };
    const [timeline, users] = await Promise.all([getTimeline(tx, id, tl), listUsers(tx)]);
    return { detail, timeline, users };
  });
  if (!data.detail) notFound();
  const { detail, timeline, users, page } = data;
  const { lead, owner, mergedInto, mergedChildren, followUps, duplicates } = detail;
  const readOnly = !!lead.duplicateOfId || !!lead.archivedAt;
  const openFollowUps = followUps.filter((f) => !f.f.doneAt);
  const overdue = lead.nextFollowUpAt && lead.nextFollowUpAt < page.now && !["won", "lost", "unqualified", "not_reachable"].includes(lead.status);
  const suggested = suggestNextFollowUp(lead.status, page.now, page.settings.followUps);

  return (
    <div className="space-y-4">
      {sp.seen && <MarkSeen id={sp.seen} />}
      {mergedInto && (
        <div className="card border-amber/50 bg-amber-soft p-3 text-sm">
          This record was merged into{" "}
          <Link className="font-medium underline" href={`/leads/${mergedInto.id}`}>{mergedInto.recordId}</Link>. It is read-only and kept so old links still work.
        </div>
      )}
      {lead.archivedAt && <div className="card border-edge bg-paper p-3 text-sm text-muted">Archived {fmtDateTime(lead.archivedAt)} (import undone). Read-only.</div>}
      {duplicates.length > 0 && !readOnly && (
        <div className="card border-amber/50 bg-amber-soft/60 p-3 text-sm">
          <p className="font-medium text-amber">Possible duplicate{duplicates.length > 1 ? "s" : ""}</p>
          <ul className="mt-1 space-y-1">
            {duplicates.map(({ d, other }) => (
              <li key={d.id} className="flex flex-wrap items-center gap-2">
                <Link href={`/leads/${other.id}`} className="underline">{other.recordId} {fullName(other)}</Link>
                <span className="text-muted">{titleCase(other.eventType)} · {fmtDate(other.eventDate)} · {d.matchReasons.map((r) => MATCH_REASON_LABELS[r as MatchReason]).join(", ")}</span>
                <span className={`chip ${d.confidence === "high" ? "border-bloom/40 text-bloom" : "border-amber/40 text-amber"}`}>{d.confidence}</span>
                {can(page.session, "leads:merge") && <Link className="btn py-0.5 text-xs" href={`/leads/merge?a=${lead.id}&b=${other.id}`}>Merge…</Link>}
                <DismissDuplicateButton candidateId={d.id} leadId={lead.id} />
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Header */}
      <header className="card p-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs tracking-wide text-muted tabular">{lead.recordId}</p>
            <h1 className="mt-0.5 truncate text-3xl">
              {fullName(lead)}
              {lead.partnerName && <span className="text-muted"> &amp; {lead.partnerName}</span>}
            </h1>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
              <StatusPill status={lead.status} />
              <span className="text-muted">·</span>
              <span>{owner ? <>Owner: <strong className="font-medium">{owner.name}</strong></> : <span className="text-bloom">Unassigned</span>}</span>
              <span className="text-muted">·</span>
              <span className={overdue ? "font-medium text-bloom" : ""}>
                Next follow-up: {lead.nextFollowUpAt ? `${fmtDateTime(lead.nextFollowUpAt)} (${fmtRelative(lead.nextFollowUpAt, page.now)})` : "none"}
              </span>
            </div>
            {lead.status === "lost" && lead.lostReason && <p className="mt-1 text-sm text-muted">Lost: {LOST_REASON_LABELS[lead.lostReason]}{lead.lostReasonDetail ? `: ${lead.lostReasonDetail}` : ""}</p>}
            {lead.status === "unqualified" && lead.unqualifiedReason && <p className="mt-1 text-sm text-muted">Unqualified: {lead.unqualifiedReason}</p>}
          </div>
        </div>
        {!readOnly && (
          <QuickActions
            leadId={lead.id}
            status={lead.status}
            allowed={TRANSITIONS[lead.status].map((s) => ({ value: s, label: STATUS_LABELS[s] }))}
            users={users.filter((u) => u.active).map((u) => ({ id: u.id, name: u.name }))}
            ownerId={lead.ownerId}
            suggestedFollowUp={toLocalInput(suggested)}
            quoteValue={lead.quoteValue}
          />
        )}
      </header>

      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        {/* Timeline */}
        <section className="card p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-xl">Timeline</h2>
            <nav className="flex gap-1 text-sm" aria-label="Timeline filter">
              {(["all", "activities", "changes"] as const).map((k) => (
                <Link key={k} href={`/leads/${lead.id}?tl=${k}`} className={`rounded-md px-2 py-1 ${tl === k ? "bg-ink text-paper" : "hover:bg-ink/5"}`}>
                  {k === "all" ? "All" : k === "activities" ? "Activities" : "Field changes"}
                </Link>
              ))}
            </nav>
          </div>
          {mergedChildren.length > 0 && (
            <p className="mb-3 text-xs text-muted">Includes history from merged record{mergedChildren.length > 1 ? "s" : ""} {mergedChildren.map((c) => c.recordId).join(", ")}.</p>
          )}
          <Timeline
            leadRecordId={lead.recordId}
            showSystem={tl === "changes"}
            users={Object.fromEntries(users.map((u) => [u.id, u.name]))}
            events={timeline.map(({ e, actorName, recordId }) => ({
              id: e.id, at: e.at.toISOString(), type: e.type, field: e.field, oldValue: e.oldValue, newValue: e.newValue,
              payload: e.payload as any, actorName, actorKind: e.actorKind, recordId,
            }))}
          />
        </section>

        {/* Sidebar */}
        <aside className="space-y-4">

          <EditDetails
            readOnly={readOnly}
            lead={{
              id: lead.id, firstName: lead.firstName, lastName: lead.lastName, partnerName: lead.partnerName, email: lead.email, phone: lead.phone,
              eventType: lead.eventType, eventDate: lead.eventDate, venueName: lead.venueName, venueCity: lead.venueCity, guestCount: lead.guestCount,
              budgetMin: lead.budgetMin, budgetMax: lead.budgetMax, estimateTotal: lead.estimateTotal, tierInterest: lead.tierInterest,
              services: lead.servicesRequested.join(", "), message: lead.message, quoteValue: lead.quoteValue,
              source: lead.source, sourceDetail: lead.sourceDetail,
            }}
          />

          <section className="card p-4 text-sm">
            <h2 className="mb-2 text-lg">Source</h2>
            <dl className="grid grid-cols-[110px_1fr] gap-x-2 gap-y-1">
              <dt className="text-muted">Origin</dt><dd>{titleCase(lead.source)}</dd>
              <dt className="text-muted">Channel</dt><dd>{titleCase(lead.captureChannel)}</dd>
              {lead.sourceDetail && <><dt className="text-muted">Detail</dt><dd>{lead.sourceDetail}</dd></>}
              {(["utmSource", "utmMedium", "utmContent", "utmTerm"] as const).map((k) =>
                lead[k] ? <Row key={k} k={k.replace("utm", "utm_").toLowerCase()} v={lead[k]} /> : null,
              )}
              {lead.landingPage && <Row k="landing page" v={lead.landingPage} />}
              {lead.referrerUrl && <Row k="referrer" v={lead.referrerUrl} />}
            </dl>
          </section>

          <section className="card p-4 text-sm">
            <h2 className="mb-2 text-lg">Quote</h2>
            <dl className="grid grid-cols-[110px_1fr] gap-x-2 gap-y-1 tabular">
              <dt className="text-muted">Quote sent</dt><dd>{lead.proposalSentAt ? fmtDateTime(lead.proposalSentAt) : "not yet"}</dd>
              <dt className="text-muted">Quote value</dt><dd>{fmtMoney(lead.quoteValue)}</dd>
              {lead.wonAt && <><dt className="text-muted">Won</dt><dd>{fmtDateTime(lead.wonAt)}</dd></>}
            </dl>
          </section>

          <section className="card p-4 text-sm">
            <h2 className="mb-2 text-lg">Follow-ups</h2>
            {followUps.length === 0 && <p className="text-muted">None yet.</p>}
            <ul className="space-y-2">
              {followUps.slice(-8).map(({ f, ownerName }) => (
                <li key={f.id} className={`flex items-start justify-between gap-2 ${f.doneAt ? "text-muted line-through" : ""}`}>
                  <div>
                    <div className={!f.doneAt && f.dueAt < page.now ? "font-medium text-bloom" : ""}>{fmtDateTime(f.dueAt)}</div>
                    <div className="text-xs text-muted">{f.note ?? ""}{ownerName ? ` · ${ownerName}` : ""}</div>
                  </div>
                  {!f.doneAt && !readOnly && <CompleteFollowUpButton followUpId={f.id} leadId={lead.id} />}
                </li>
              ))}
            </ul>
            {openFollowUps.length === 0 && !readOnly && !["won", "lost", "unqualified", "not_reachable"].includes(lead.status) && (
              <p className="mt-2 text-xs text-bloom">No follow-up set: this lead counts as awaiting follow-up.</p>
            )}
          </section>

          <section className="card p-4 text-xs text-muted">
            Created {fmtDateTime(lead.createdAt)} · Updated {fmtDateTime(lead.updatedAt)}
            {lead.lastContactedAt && <> · Last contacted {fmtDateTime(lead.lastContactedAt)}</>}
          </section>
        </aside>
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <>
      <dt className="text-muted">{k}</dt>
      <dd className="truncate" title={v}>{v}</dd>
    </>
  );
}
