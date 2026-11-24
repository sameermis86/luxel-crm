import Link from "next/link";
import { withPage } from "@/server/page";
import { listOpsEvents } from "@/server/ops/queries";
import { addDaysToDate, dateInTz } from "@/lib/dates";
import { fmtDate } from "@/lib/format";
import { configuredCalendars } from "@/server/integrations/goodshuffle";
import { SyncOpsButton } from "./sync-button";

export const dynamic = "force-dynamic";

type SP = Promise<Record<string, string | string[] | undefined>>;
const VIEWS = { week: "Next 7 days", upcoming: "Next 60 days", all: "All upcoming", recent: "Past events" } as const;

export default async function OpsBoard({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const view = (typeof sp.view === "string" && sp.view in VIEWS ? sp.view : "upcoming") as keyof typeof VIEWS;
  const { events, today } = await withPage(async (tx, p) => {
    const today = dateInTz(p.now, p.settings.businessHours.timezone);
    const [from, to] =
      view === "recent" ? [addDaysToDate(today, -p.settings.ops.keepDaysAfter), addDaysToDate(today, -1)] : [today, addDaysToDate(today, view === "week" ? 6 : view === "all" ? 3650 : 59)];
    return { events: await listOpsEvents(tx, from, to), today };
  });
  const connected = (["signed", "action_needed"] as const).some((s) => configuredCalendars()[s]);

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-medium tracking-wide text-muted uppercase">Fulfillment & Ops</p>
          <h1 className="mt-0.5 text-3xl">Event board</h1>
          <p className="mt-1 text-sm text-muted">Signed Goodshuffle contracts: pull sheets, setup and teardown for each event.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <nav aria-label="Events shown" className="inline-flex rounded-md border border-edge bg-card p-0.5 text-sm">
            {(Object.keys(VIEWS) as (keyof typeof VIEWS)[]).map((v) => (
              <Link key={v} href={`/ops?view=${v}`} aria-current={v === view ? "page" : undefined} className={`rounded px-2.5 py-1 ${v === view ? "bg-ink text-paper" : "text-muted hover:text-ink"}`}>
                {VIEWS[v]}
              </Link>
            ))}
          </nav>
          {connected && <SyncOpsButton />}
        </div>
      </header>

      {!connected && events.length === 0 ? (
        <p className="card p-6 text-sm text-muted">Connect Goodshuffle&apos;s Signed and Action Needed calendars (Import → Goodshuffle Pro) to fill the board.</p>
      ) : events.length === 0 ? (
        <p className="card p-10 text-center text-sm text-muted">No signed events {view === "recent" ? "in the past two weeks" : view === "all" ? "coming up" : `in the ${VIEWS[view].toLowerCase()}`}.</p>
      ) : (
        <ul className="card divide-y divide-edge">
          {events.map((e) => {
            const days = Math.round((Date.parse(e.eventDate) - Date.parse(today)) / 86_400_000);
            return (
              <li key={e.id}>
                <Link href={`/ops/events/${e.id}`} className="grid gap-3 px-4 py-3 transition-colors duration-150 hover:bg-paper/60 md:grid-cols-[96px_minmax(0,1fr)_repeat(3,120px)] md:items-center">
                  <div className="tabular">
                    <div className="font-display text-xl leading-none">{new Date(e.eventDate + "T12:00:00Z").toLocaleDateString("en-CA", { month: "short", day: "numeric", timeZone: "UTC" })}</div>
                    <div className="mt-1 text-xs text-muted">{days === 0 ? "today" : days > 0 ? `in ${days}d` : `${-days}d ago`}</div>
                  </div>
                  <div className="min-w-0">
                    <div className={`truncate font-medium ${e.goneAt ? "text-muted line-through" : ""}`}>{e.name}</div>
                    <div className="truncate text-xs text-muted">
                      {[e.venue, e.timeText].filter(Boolean).join(" · ") || fmtDate(e.eventDate)}
                      {e.gsStatus === "action_needed" && <span className="ml-1.5 text-amber">· action needed in Goodshuffle</span>}
                      {e.goneAt && <span className="ml-1.5 text-bloom">· no longer signed in Goodshuffle</span>}
                    </div>
                  </div>
                  <Progress label="Pulled" done={e.pulled} total={e.items} />
                  <Progress label="Setup" done={e.setupDone} total={e.setupTotal} />
                  <Progress label={days < 0 ? "Returned" : "Teardown"} done={days < 0 ? e.returned : e.teardownDone} total={days < 0 ? e.items : e.teardownTotal} />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function Progress({ label, done, total }: { label: string; done: number; total: number }) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <div className="text-xs">
      <div className="flex justify-between text-muted"><span>{label}</span><span className="tabular text-ink">{total ? `${done}/${total}` : "—"}</span></div>
      <div className="mt-1 h-1.5 rounded-full bg-paper"><div className="h-1.5 rounded-full bg-stem" style={{ width: `${pct}%` }} /></div>
    </div>
  );
}
