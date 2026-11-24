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
import { SaveViewForm, DeleteViewButton } from "./saved-views";

export const dynamic = "force-dynamic";

type SP = Promise<Record<string, string | string[] | undefined>>;

const FORM_KEYS = new Set(["q", "status", "qualification", "source", "event_type", "owner", "created_from", "created_to", "awaiting"]);

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
    return { rows, total, users, views };
  });
  const { rows, total, users, views, page } = data;
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
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl">Leads</h1>
          <p className="mt-1 text-sm text-muted">
            <span className="tabular font-medium text-ink" data-testid="lead-count">{total.toLocaleString()}</span> lead{total === 1 ? "" : "s"}
            {summary.length ? <> · {summary.join(" · ")}</> : null}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a className="btn" href={`/api/leads/export?${query}`}>Export CSV</a>
          <Link className="btn-bloom" href="/leads/new">+ New lead</Link>
        </div>
      </div>

      {views.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-xs tracking-wide text-muted uppercase">Saved views</span>
          {views.map((v) => (
            <span key={v.id} className="chip border-edge bg-card">
              <Link href={`/leads?${v.query}`} className="hover:underline">{v.name}</Link>
              <DeleteViewButton id={v.id} />
            </span>
          ))}
        </div>
      )}

      <form method="get" action="/leads" className="card grid grid-cols-2 gap-3 p-3 md:grid-cols-4 xl:grid-cols-8">
        {FILTER_KEYS.filter((k) => !FORM_KEYS.has(k)).map((k) => {
          const v = filter[k as keyof LeadFilter];
          if (v === undefined) return null;
          return <input key={k} type="hidden" name={k} value={Array.isArray(v) ? v.join(",") : v === true ? "1" : String(v)} />;
        })}
        <div className="col-span-2">
          <label className="label" htmlFor="q">Search</label>
          <input id="q" name="q" defaultValue={filter.q ?? ""} placeholder="Name, email, phone, LX-…" className="input" />
        </div>
        <Select name="status" label="Status" value={single(filter.status)} multi={multi(filter.status)} options={STATUSES.map((s) => [s, STATUS_LABELS[s]])} />
        <Select name="qualification" label="Qualification" value={single(filter.qualification)} multi={multi(filter.qualification)} options={[["qualified", "Qualified"], ["needs_info", "Needs info"], ["unqualified", "Unqualified"]]} />
        <Select name="source" label="Source" value={single(filter.source)} multi={multi(filter.source)} options={SOURCES.map((s) => [s, titleCase(s)])} />
        <Select name="event_type" label="Event type" value={single(filter.event_type)} multi={multi(filter.event_type)} options={EVENT_TYPES.map((s) => [s, titleCase(s)])} />
        <Select name="owner" label="Owner" value={single(filter.owner)} multi={multi(filter.owner)} options={[["me", "Me"], ["unassigned", "Unassigned"], ...users.map((u) => [u.id, u.name] as [string, string])]} />
        <div>
          <label className="label" htmlFor="created_from">Created from</label>
          <input id="created_from" type="date" name="created_from" defaultValue={filter.created_from ?? ""} className="input" />
        </div>
        <div>
          <label className="label" htmlFor="created_to">Created to</label>
          <input id="created_to" type="date" name="created_to" defaultValue={filter.created_to ?? ""} className="input" />
        </div>
        <label className="flex items-end gap-2 pb-2 text-sm">
          <input type="checkbox" name="awaiting" value="1" defaultChecked={!!filter.awaiting} /> Awaiting follow-up
        </label>
        <div className="col-span-2 flex items-end gap-2 md:col-span-2 xl:col-span-2">
          <button className="btn-primary">Apply</button>
          <Link href="/leads" className="btn-ghost">Clear</Link>
        </div>
      </form>

      <LeadsTable
        rows={rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString(), nextFollowUpAt: r.nextFollowUpAt?.toISOString() ?? null }))}
        sort={params.sort}
        dir={params.dir}
        query={query}
        bands={page.settings.scoring.bands}
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
      <div>
        <span className="label">{label}</span>
        <input type="hidden" name={name} value={multi.join(",")} />
        <div className="input truncate bg-paper text-muted" title={multi.join(", ")}>{multi.length} selected</div>
      </div>
    );
  }
  return (
    <div>
      <label className="label" htmlFor={name}>{label}</label>
      <select id={name} name={name} defaultValue={value} className="input">
        <option value="">Any</option>
        {options.map(([v, l]) => (
          <option key={v} value={v}>{l}</option>
        ))}
      </select>
    </div>
  );
}
