import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { notFound } from "next/navigation";
import { withPage } from "@/server/page";
import { getOpsEvent } from "@/server/ops/queries";
import { fmtDate } from "@/lib/format";
import { PullSheet, Checklist, PrintButton } from "./parts";

export const dynamic = "force-dynamic";

const TABS = { pull: "Pull sheet", setup: "Setup", teardown: "Teardown", details: "Details" } as const;
type Tab = keyof typeof TABS;

export default async function OpsEventPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const tab: Tab = sp.tab && sp.tab in TABS ? (sp.tab as Tab) : "pull";
  const data = await withPage((tx) => getOpsEvent(tx, id));
  if (!data) notFound();
  const { event: e, items, tasks, names } = data;
  const live = items.filter((i) => !i.removedAt);
  const decor = live.filter((i) => !i.logistics);
  const links = e.links as Record<string, string | undefined>;
  const count = (phase: string) => {
    const t = tasks.filter((x) => x.phase === phase);
    return `${t.filter((x) => x.doneAt).length}/${t.length}`;
  };
  const by = (uid: string | null) => (uid ? names[uid] ?? "someone" : null);

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3 print:hidden">
        <div className="min-w-0">
          <Link href="/ops" className="inline-flex items-center gap-1 text-sm text-muted transition-colors hover:text-ink"><ArrowLeft size={14} /> Event board</Link>
          <h1 className="mt-3 text-[28px] sm:text-[34px]">{e.name}</h1>
          <p className="mt-1 text-sm text-muted">
            {fmtDate(e.eventDate)}{e.timeText ? ` · ${e.timeText}` : ""}{e.venue ? ` · ${e.venue}` : ""}
            {e.gsStatus === "action_needed" && <span className="ml-1.5 text-amber">· action needed in Goodshuffle</span>}
            {e.goneAt && <span className="ml-1.5 text-bloom">· no longer signed in Goodshuffle</span>}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-sm">
          {e.leadId && <Link className="btn" href={`/leads/${e.leadId}`}>Lead in CRM</Link>}
          {links.project && <a className="btn" href={links.project} target="_blank" rel="noreferrer">Open in Goodshuffle ↗</a>}
          {tab !== "details" && <PrintButton />}
        </div>
      </header>

      <nav aria-label="Event sections" className="-mx-4 flex gap-1 overflow-x-auto border-b border-edge px-4 text-sm whitespace-nowrap sm:mx-0 sm:px-0 print:hidden">
        {(Object.keys(TABS) as Tab[]).map((t) => (
          <Link key={t} href={`/ops/events/${e.id}?tab=${t}`} aria-current={t === tab ? "page" : undefined} className={`-mb-px border-b-2 px-3 py-2 ${t === tab ? "border-ink font-medium" : "border-transparent text-muted hover:text-ink"}`}>
            {TABS[t]}
            <span className="ml-1.5 text-xs text-muted tabular">
              {t === "pull" ? `${decor.filter((i) => i.pulledAt).length}/${decor.length}` : t === "setup" ? count("setup") : t === "teardown" ? count("teardown") : ""}
            </span>
          </Link>
        ))}
      </nav>

      {/* print header */}
      <div className="hidden print:block">
        <h1 className="text-2xl">{TABS[tab]}: {e.name}</h1>
        <p className="text-sm">{fmtDate(e.eventDate)}{e.timeText ? ` · ${e.timeText}` : ""}{e.venue ? ` · ${e.venue}` : ""}</p>
      </div>

      {tab === "pull" && (
        <PullSheet
          eventId={e.id}
          items={live.map((i) => ({ id: i.id, parentId: i.parentId, area: i.area, name: i.name, qty: i.qty, logistics: i.logistics, fromGs: i.fromGs, notes: i.notes, pulled: i.pulledAt ? by(i.pulledBy) ?? "" : null, loaded: i.loadedAt ? by(i.loadedBy) ?? "" : null, returned: i.returnedAt ? by(i.returnedBy) ?? "" : null }))}
          removed={items.filter((i) => i.removedAt && i.fromGs).map((i) => `${i.name} (${i.area})`)}
          printedSheet={links.pullsheetByCategory ?? links.pullsheetByGroup ?? null}
        />
      )}
      {(tab === "setup" || tab === "teardown") && (
        <Checklist
          eventId={e.id}
          phase={tab}
          tasks={tasks.filter((t) => t.phase === tab).map((t) => ({ id: t.id, area: t.area, title: t.title, done: t.doneAt ? `${by(t.doneBy) ?? ""}` : null }))}
          returns={tab === "teardown" ? decor.map((i) => ({ id: i.id, area: i.area, name: i.name, qty: i.qty, returned: i.returnedAt ? by(i.returnedBy) ?? "" : null })) : []}
        />
      )}
      {tab === "details" && (
        <div className="grid gap-4 lg:grid-cols-2">
          <section className="card p-4 text-sm">
            <h2 className="mb-3 text-[17px]">Event</h2>
            <dl className="grid grid-cols-[120px_1fr] gap-y-1.5">
              <dt className="text-muted">Client</dt><dd>{e.client ?? "—"}</dd>
              <dt className="text-muted">Date / time</dt><dd>{fmtDate(e.eventDate)}{e.timeText ? ` · ${e.timeText}` : ""}</dd>
              <dt className="text-muted">Venue</dt><dd>{e.venue ?? "—"}</dd>
              <dt className="text-muted">Sales lead</dt><dd>{e.salesLead ?? "—"}</dd>
              <dt className="text-muted">Goodshuffle</dt><dd>#{e.project} · {e.gsStatus === "action_needed" ? "Action needed" : "Signed"}</dd>
            </dl>
            <h3 className="mt-4 mb-1 font-medium">Goodshuffle sheets</h3>
            <ul className="space-y-1">
              {([["pullsheetByCategory", "Pull sheet by category"], ["pullsheetByGroup", "Pull sheet by line item"], ["schedule", "Schedule"], ["fulfillmentSheet", "Fulfillment sheet"]] as const).map(([k, label]) =>
                links[k] ? <li key={k}><a className="underline" href={links[k]} target="_blank" rel="noreferrer">{label} ↗</a></li> : null,
              )}
            </ul>
          </section>
          <section className="card p-4 text-sm">
            <h2 className="mb-3 text-[17px]">Contract notes</h2>
            <p className="label">For the client</p>
            <p className="whitespace-pre-line">{e.notesClient ?? "—"}</p>
            <p className="label mt-3">Internal</p>
            <p className="whitespace-pre-line">{e.notesInternal ?? "—"}</p>
          </section>
        </div>
      )}
    </div>
  );
}
