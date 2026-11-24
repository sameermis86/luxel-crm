import Link from "next/link";
import { ArrowLeft, CalendarClock, UserRound } from "lucide-react";
import { notFound } from "next/navigation";
import { withPage } from "@/server/page";
import { can } from "@/server/auth";
import { getLeadDetail, getTimeline, listUsers, type TimelineFilter } from "@/server/leads/queries";
import { StatusPill } from "@/components/badges";
import { MATCH_REASON_LABELS, type MatchReason } from "@/lib/duplicates";
import { LOST_REASON_LABELS, STATUS_LABELS, allowedTransitions } from "@/lib/status";
import { fmtDate, fmtDateTime, fmtMoney, fmtRelative, fullName, titleCase, toLocalInput } from "@/lib/format";
import { suggestNextFollowUp } from "@/lib/business-hours";
import { QuickActions } from "./quick-actions";
import { Timeline } from "./timeline";
import { EditDetails } from "./edit-details";
import { CompleteFollowUpButton, DismissDuplicateButton, MarkSeen } from "./small-actions";
import { PlannerButton, RestoreLeadButton } from "../planner-actions";
import { SmsOptOutToggle, TextComposer } from "../text-composer";
import { lastTexts } from "@/server/sms";
import { smsEligibility, textable } from "@/lib/sms";
import { MessageSquareText } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function LeadPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const tl = (["all", "activities", "changes"].includes(sp.tl ?? "") ? sp.tl : "all") as TimelineFilter;
  const data = await withPage(async (tx) => {
    const detail = await getLeadDetail(tx, id);
    if (!detail) return { detail: null, timeline: [], users: [], lastText: null };
    const [timeline, users, texts] = await Promise.all([getTimeline(tx, id, tl), listUsers(tx), lastTexts(tx, [id])]);
    return { detail, timeline, users, lastText: texts.get(id) ?? null };
  });
  if (!data.detail) notFound();
  const { detail, timeline, users, lastText, page } = data;
  const { lead, owner, mergedInto, mergedChildren, followUps, duplicates } = detail;
  const readOnly = !!lead.duplicateOfId || !!lead.archivedAt;
  const openFollowUps = followUps.filter((f) => !f.f.doneAt);
  const overdue = lead.nextFollowUpAt && lead.nextFollowUpAt < page.now && !["won", "lost", "unqualified", "not_reachable"].includes(lead.status);
  const suggested = suggestNextFollowUp(lead.status, page.now, page.settings.followUps);
  const isOwner = can(page.session, "settings:manage");
  const sms = textable(detail.lead.phoneE164) ? smsEligibility(detail.lead, page.now, { ...page.settings.sms, minDaysBetween: 0 }, lastText) : ({ ok: false, reason: "No Canadian/US mobile number" } as const);
  const archiveEvent = lead.archivedAt ? [...timeline].sort((a, b) => b.e.seq - a.e.seq).find((t) => t.e.field === "archivedAt" && t.e.newValue)?.e : null;
  const archiveVia = (archiveEvent?.payload as { via?: string; entry?: string } | null) ?? null;
  const archiveWhy = !archiveEvent ? null : archiveVia?.via === "planner" ? `marked as a planner/partner (${archiveVia.entry})` : "import undone";

  return (
    <div className="space-y-6">
      {sp.seen && <MarkSeen id={sp.seen} />}
      {mergedInto && (
        <div className="rounded-xl border border-amber/30 bg-amber-soft px-4 py-3 text-sm">
          This record was merged into{" "}
          <Link className="font-medium underline" href={`/leads/${mergedInto.id}`}>{mergedInto.recordId}</Link>. It is read-only and kept so old links still work.
        </div>
      )}
      {lead.archivedAt && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-edge bg-paper-2/60 px-4 py-3 text-sm text-muted">
          <span>Archived {fmtDateTime(lead.archivedAt)}{archiveWhy ? ` (${archiveWhy})` : ""}. Read-only.</span>
          {isOwner && !lead.duplicateOfId && <RestoreLeadButton leadId={lead.id} />}
        </div>
      )}
      {duplicates.length > 0 && !readOnly && (
        <div className="rounded-xl border border-amber/30 bg-amber-soft/70 px-4 py-3 text-sm">
          <p className="font-medium text-amber">Possible duplicate{duplicates.length > 1 ? "s" : ""}</p>
          <ul className="mt-1 space-y-1">
            {duplicates.map(({ d, other }) => (
              <li key={d.id} className="flex flex-wrap items-center gap-2">
                <Link href={`/leads/${other.id}`} className="underline">{other.recordId} {fullName(other)}</Link>
                <span className="text-muted">{titleCase(other.eventType)} · {fmtDate(other.eventDate)} · {d.matchReasons.map((r) => MATCH_REASON_LABELS[r as MatchReason]).join(", ")}</span>
                <span className={`chip ${d.confidence === "high" ? "border-bloom/40 text-bloom" : "border-amber/40 text-amber"}`}>{d.confidence}</span>
                {can(page.session, "leads:merge") && <Link className="btn btn-sm" href={`/leads/merge?a=${lead.id}&b=${other.id}`}>Merge…</Link>}
                <DismissDuplicateButton candidateId={d.id} leadId={lead.id} />
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Header */}
      <header className="pb-2">
        <Link href="/leads" className="inline-flex items-center gap-1 text-sm text-muted transition-colors hover:text-ink"><ArrowLeft size={14} /> Leads</Link>
        <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="font-mono text-xs text-muted">{lead.recordId}</p>
            <h1 className="mt-1 text-[30px] sm:text-[36px]">
              {fullName(lead)}
              {lead.partnerName && <span className="text-muted"> &amp; {lead.partnerName}</span>}
            </h1>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
              <StatusPill status={lead.status} />
              <span className="inline-flex h-[22px] items-center gap-1.5 rounded-full border border-edge bg-card px-2.5 text-xs">
                <UserRound size={12} className="text-muted" />{owner ? owner.name : <span className="text-bloom-strong">Unassigned</span>}
              </span>
              <span className={`inline-flex h-[22px] items-center gap-1.5 rounded-full border px-2.5 text-xs ${overdue ? "border-bloom/30 bg-bloom-soft font-medium text-bloom-strong" : "border-edge bg-card"}`}>
                <CalendarClock size={12} className={overdue ? "" : "text-muted"} />
                {lead.nextFollowUpAt ? `Follow up ${fmtRelative(lead.nextFollowUpAt, page.now)} · ${fmtDateTime(lead.nextFollowUpAt)}` : "No follow-up set"}
              </span>
            </div>
            {lead.status === "lost" && lead.lostReason && <p className="mt-1 text-sm text-muted">Lost: {LOST_REASON_LABELS[lead.lostReason]}{lead.lostReasonDetail ? `: ${lead.lostReasonDetail}` : ""}</p>}
            {lead.status === "unqualified" && lead.unqualifiedReason && <p className="mt-1 text-sm text-muted">Unqualified: {lead.unqualifiedReason}</p>}
          </div>
          {isOwner && !readOnly && lead.email && <PlannerButton leadId={lead.id} email={lead.email} />}
        </div>
        {!readOnly && (
          <QuickActions
            leadId={lead.id}
            status={lead.status}
            allowed={allowedTransitions(lead.status, can(page.session, "settings:manage")).map((s) => ({ value: s, label: STATUS_LABELS[s] }))}
            users={users.filter((u) => u.active).map((u) => ({ id: u.id, name: u.name }))}
            ownerId={lead.ownerId}
            suggestedFollowUp={toLocalInput(suggested)}
            quoteValue={lead.quoteValue}
          />
        )}
        {!readOnly && lead.phoneE164 && (
          <details className="card mt-4 max-w-2xl p-4 [&[open]>summary]:mb-3">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-2 [&::-webkit-details-marker]:hidden">
              <span className="flex items-center gap-2 text-sm font-medium"><MessageSquareText size={15} strokeWidth={1.75} className="text-muted" aria-hidden /> Text reminder</span>
              <span className="text-xs text-muted">{lastText ? `Last texted ${fmtRelative(lastText, page.now)}` : "Never texted"}{!sms.ok ? ` · ${sms.reason}` : ""}</span>
            </summary>
            {sms.ok ? (
              <TextComposer
                lead={{ id: lead.id, firstName: lead.firstName, phoneE164: lead.phoneE164, status: lead.status, eventType: lead.eventType, eventDate: lead.eventDate, venueName: lead.venueName }}
                templates={page.settings.sms.templates}
                senderName={page.settings.sms.senderName}
              />
            ) : (
              <p className="text-sm text-muted">Can&apos;t text: {sms.reason.toLowerCase()}.</p>
            )}
            <div className="mt-3 border-t border-edge pt-3"><SmsOptOutToggle leadId={lead.id} optedOut={!!lead.smsOptOutAt} /></div>
          </details>
        )}
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        {/* Timeline */}
        <section className="card p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-[19px]">Timeline</h2>
            <nav className="seg" aria-label="Timeline filter">
              {(["all", "activities", "changes"] as const).map((k) => (
                <Link key={k} href={`/leads/${lead.id}?tl=${k}`} aria-current={tl === k ? "page" : undefined} className="seg-item text-[13px]">
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
            <h2 className="mb-3 text-[17px]">Source</h2>
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
            <h2 className="mb-3 text-[17px]">Quote</h2>
            <dl className="grid grid-cols-[110px_1fr] gap-x-2 gap-y-1 tabular">
              <dt className="text-muted">Quote sent</dt><dd>{lead.proposalSentAt ? fmtDateTime(lead.proposalSentAt) : "not yet"}</dd>
              <dt className="text-muted">Quote value</dt><dd>{fmtMoney(lead.quoteValue)}</dd>
              {lead.wonAt && <><dt className="text-muted">Won</dt><dd>{fmtDateTime(lead.wonAt)}</dd></>}
            </dl>
          </section>

          <section className="card p-4 text-sm">
            <h2 className="mb-3 text-[17px]">Follow-ups</h2>
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
