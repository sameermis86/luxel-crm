import Link from "next/link";
import { eq } from "drizzle-orm";
import { savedViews, SOURCES, STATUSES, EVENT_TYPES } from "@/db/schema";
import { withPage } from "@/server/page";
import { can } from "@/server/auth";
import { listLeads, listUsers } from "@/server/leads/queries";
import { parseLeadFilter, parseListParams, filterToParams, describeFilter, FILTER_KEYS, type LeadFilter } from "@/lib/lead-filters";
import { STATUS_LABELS } from "@/lib/status";
import { titleCase } from "@/lib/format";
import { LeadsTable } from "./leads-table";
import { PageHeader } from "@/components/page-header";
import { Download, Plus, Search, SlidersHorizontal } from "lucide-react";
import { ConsultationsPanel, type ConsultPanelData } from "./consultations";
import { countLeads } from "@/server/leads/queries";
import { getSetmoreState, listAppointments, planConsultStatuses, setmoreConfigured } from "@/server/integrations/setmore";
import { leadsHref } from "@/lib/lead-filters";
import { SaveViewForm, DeleteViewButton } from "./saved-views";

export const dynamic = "force-dynamic";

type SP = Promise<Record<string, string | string[] | undefined>>;

const FORM_KEYS = new Set(["q", "status", "source", "event_type", "owner", "created_from", "created_to", "awaiting"]);

export default async function LeadsPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const filter = parseLeadFilter(sp);
  const params = parseListParams(sp);
  const data = await withPage(async (tx, p) => {
    const [{ rows, total }, users, views] = await Promise.all([
      listLeads(tx, filter, p.wc, params),
      listUsers(tx),
      tx.select().from(savedViews).where(eq(savedViews.userId, p.session.userId)),
    ]);
    const configured = setmoreConfigured();
    const day = 86_400_000;
    const upcomingFilter: LeadFilter = { consult: "upcoming" };
    const isOwner = can(p.session, "settings:manage");
    const [upcoming, recent, upcomingTotal, sm, statusPlan] = configured
      ? await Promise.all([
          listAppointments(tx, p.now, new Date(p.now.getTime() + 30 * day), "asc", 6),
          listAppointments(tx, new Date(p.now.getTime() - 14 * day), p.now, "desc", 6),
          countLeads(tx, upcomingFilter, p.wc),
          getSetmoreState(p.session.orgId),
          isOwner ? planConsultStatuses(tx, p.now) : Promise.resolve([]),
        ])
      : [[], [], 0, {}, []];
    const ser = (a: (typeof upcoming)[number]) => ({ ...a, startsAt: a.startsAt.toISOString() });
    const consult: ConsultPanelData = {
      configured,
      lastRunAt: (sm as { lastRunAt?: string }).lastRunAt ?? null,
      lastError: (sm as { lastError?: string | null }).lastError ?? null,
      upcoming: upcoming.map(ser),
      upcomingTotal,
      recent: recent.map(ser),
      upcomingHref: leadsHref(upcomingFilter),
      statusPlan: isOwner ? statusPlan : null,
    };
    return { rows, total, users, views, consult };
  });
  const { rows, total, users, views, consult, page } = data;
  const query = filterToParams(filter).toString();
  const pages = Math.max(1, Math.ceil(total / params.per));
  const single = (v: string[] | undefined) => (v?.length === 1 ? v[0] : "");
  const multi = (v: string[] | undefined) => (v && v.length > 1 ? v : null);
  const linkWith = (over: Record<string, string>) => {
    const s = new URLSearchParams(query);
    s.set("sort", params.sort);
    s.set("dir", params.dir);
    for (const [k, v] of Object.entries(over)) s.set(k, v);
    return `/leads?${s}`;
  };
  const summary = describeFilter(filter);

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Sales & CRM"
        title="Leads"
        description={
          <>
            <span className="tabular font-medium text-ink" data-testid="lead-count">{total.toLocaleString()}</span> lead{total === 1 ? "" : "s"}
            {summary.length ? <> · {summary.join(" · ")}</> : " in the book"}
          </>
        }
        actions={
          <>
            <a className="btn" href={`/api/leads/export?${query}`}><Download size={15} strokeWidth={1.75} /> Export CSV</a>
            <Link className="btn-bloom" href="/leads/new"><Plus size={16} strokeWidth={2} /> New lead</Link>
          </>
        }
      />

      <ConsultationsPanel data={consult} />

      {views.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="eyebrow mr-1">Saved views</span>
          {views.map((v) => (
            <span key={v.id} className="chip h-7 border-edge bg-card px-3 shadow-xs">
              <Link href={`/leads?${v.query}`} className="hover:underline">{v.name}</Link>
              <DeleteViewButton id={v.id} />
            </span>
          ))}
        </div>
      )}

      <form method="get" action="/leads" className="card flex flex-wrap items-center gap-2 p-2.5">
        {FILTER_KEYS.filter((k) => !FORM_KEYS.has(k)).map((k) => {
          const v = filter[k as keyof LeadFilter];
          if (v === undefined) return null;
          return <input key={k} type="hidden" name={k} value={Array.isArray(v) ? v.join(",") : v === true ? "1" : String(v)} />;
        })}
        <label className="relative min-w-[220px] flex-[2_1_260px]">
          <span className="sr-only">Search</span>
          <Search size={16} strokeWidth={1.75} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-faint" />
          <input id="q" name="q" defaultValue={filter.q ?? ""} placeholder="Search name, email, phone or LX-…" className="input pl-9" />
        </label>
        <Select name="status" label="Status" value={single(filter.status)} multi={multi(filter.status)} options={STATUSES.map((s) => [s, STATUS_LABELS[s]])} />
        <Select name="owner" label="Owner" value={single(filter.owner)} multi={multi(filter.owner)} options={[["me", "Me"], ["unassigned", "Unassigned"], ...users.map((u) => [u.id, u.name] as [string, string])]} />
        <Select name="source" label="Source" value={single(filter.source)} multi={multi(filter.source)} options={SOURCES.map((s) => [s, titleCase(s)])} />
        <Select name="event_type" label="Event type" value={single(filter.event_type)} multi={multi(filter.event_type)} options={EVENT_TYPES.map((s) => [s, titleCase(s)])} />
        <details className="group relative" open={!!(filter.created_from || filter.created_to || filter.awaiting) || undefined}>
          <summary className="btn cursor-pointer list-none [&::-webkit-details-marker]:hidden">
            <SlidersHorizontal size={15} strokeWidth={1.75} /> More
          </summary>
          <div className="absolute right-0 z-20 mt-2 w-72 max-w-[calc(100vw-2rem)] space-y-3 rounded-xl border border-edge bg-card p-4 shadow-lg">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="label" htmlFor="created_from">Created from</label>
                <input id="created_from" type="date" name="created_from" defaultValue={filter.created_from ?? ""} className="input" />
              </div>
              <div>
                <label className="label" htmlFor="created_to">Created to</label>
                <input id="created_to" type="date" name="created_to" defaultValue={filter.created_to ?? ""} className="input" />
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="awaiting" value="1" defaultChecked={!!filter.awaiting} /> Only leads awaiting follow-up
            </label>
          </div>
        </details>
        <div className="ml-auto flex items-center gap-1.5">
          <Link href="/leads" className="btn-ghost">Clear</Link>
          <button className="btn-primary">Apply</button>
        </div>
      </form>

      <LeadsTable
        rows={rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString(), nextFollowUpAt: r.nextFollowUpAt?.toISOString() ?? null, nextConsultAt: r.nextConsultAt ? new Date(r.nextConsultAt).toISOString() : null }))}
        sort={params.sort}
        dir={params.dir}
        query={query}
        users={users.filter((u) => u.active).map((u) => ({ id: u.id, name: u.name }))}
        canBulk={can(page.session, "leads:bulk")}
        total={total}
        nowIso={page.now.toISOString()}
      />

      <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
        <SaveViewForm query={query} />
        <div className="flex items-center gap-2">
          <span className="text-muted">Page {params.page} of {pages}</span>
          {params.page > 1 && <Link className="btn" href={linkWith({ page: String(params.page - 1) })}>← Prev</Link>}
          {params.page < pages && <Link className="btn" href={linkWith({ page: String(params.page + 1) })}>Next →</Link>}
        </div>
      </div>
    </div>
  );
}

function Select({ name, label, value, multi, options }: { name: string; label: string; value: string; multi: string[] | null; options: [string, string][] }) {
  if (multi) {
    // a multi-value filter from a dashboard click: keep it as-is
    return (
      <span className="flex-[1_1_128px]">
        <input type="hidden" name={name} value={multi.join(",")} />
        <span className="input flex items-center truncate bg-card-2 text-muted" title={multi.join(", ")}>{label}: {multi.length} selected</span>
      </span>
    );
  }
  return (
    <label className="flex-[1_1_128px]">
      <span className="sr-only">{label}</span>
      <select id={name} name={name} defaultValue={value} className={`input ${value ? "border-ink/30 text-ink" : "text-muted"}`}>
        <option value="">{label}: any</option>
        {options.map(([v, l]) => (
          <option key={v} value={v}>{l}</option>
        ))}
      </select>
    </label>
  );
}
