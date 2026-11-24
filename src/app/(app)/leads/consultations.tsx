"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { Status } from "@/db/schema";
import { StatusPill } from "@/components/badges";
import { addLeadFromAppointmentAction } from "./actions";

export interface ConsultRow {
  id: string;
  startsAt: string;
  status: string;
  customerName: string | null;
  serviceName: string | null;
  staffName: string | null;
  leadId: string | null;
  recordId: string | null;
  leadStatus: string | null;
}

export interface ConsultPanelData {
  configured: boolean;
  lastRunAt: string | null;
  lastError: string | null;
  upcoming: ConsultRow[];
  upcomingTotal: number;
  recent: ConsultRow[];
  upcomingHref: string;
}

const TZ = "America/Toronto";
const day = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: TZ, weekday: "short", month: "short", day: "numeric" });
const time = (iso: string) => new Date(iso).toLocaleTimeString("en-CA", { timeZone: TZ, hour: "numeric", minute: "2-digit" });

/** Setmore consultations: who is booked to meet soon, and who met recently. */
export function ConsultationsPanel({ data }: { data: ConsultPanelData }) {
  const [open, setOpen] = useState(true);
  return (
    <section className="card" aria-labelledby="consult-h">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left">
        <span className="flex items-baseline gap-2">
          <h2 id="consult-h" className="text-lg">Consultations</h2>
          <span className="text-xs text-muted">from Setmore{data.configured && data.upcomingTotal ? ` · ${data.upcomingTotal} coming up` : ""}</span>
        </span>
        <span className="text-xs text-muted" aria-hidden>{open ? "Hide" : "Show"}</span>
      </button>

      {open && (
        <div className="border-t border-edge">
          {!data.configured ? (
            <Placeholder />
          ) : (
            <>
              {data.lastError && <p className="px-4 pt-3 text-sm text-bloom">Last sync failed: {data.lastError}</p>}
              <div className="grid divide-edge md:grid-cols-2 md:divide-x">
                <List
                  title="Coming up"
                  empty="No consultations booked in the next 30 days."
                  rows={data.upcoming}
                  footer={data.upcomingTotal > data.upcoming.length ? <Link href={data.upcomingHref} className="text-muted hover:text-ink">All {data.upcomingTotal} booked leads →</Link> : null}
                />
                <List title="Met in the last 14 days" empty="No consultations in the last 14 days." rows={data.recent} />
              </div>
              <p className="border-t border-edge px-4 py-2 text-[11px] text-muted">
                Synced {data.lastRunAt ? new Date(data.lastRunAt).toLocaleString("en-CA", { timeZone: TZ, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "not yet"} · read-only: statuses aren&apos;t changed automatically
              </p>
            </>
          )}
        </div>
      )}
    </section>
  );
}

function List({ title, rows, empty, footer }: { title: string; rows: ConsultRow[]; empty: string; footer?: React.ReactNode }) {
  return (
    <div className="px-4 py-3">
      <h3 className="mb-1.5 text-xs font-medium tracking-wide text-muted uppercase" style={{ fontFamily: "var(--font-sans)" }}>{title}</h3>
      {rows.length === 0 ? (
        <p className="py-3 text-sm text-muted">{empty}</p>
      ) : (
        <ul className="divide-y divide-edge">
          {rows.map((r) => <Item key={r.id} r={r} />)}
        </ul>
      )}
      {footer && <p className="mt-2 text-sm">{footer}</p>}
    </div>
  );
}

function Item({ r }: { r: ConsultRow }) {
  const cancelled = r.status === "cancelled";
  return (
    <li className="flex items-center gap-3 py-2">
      <div className="w-[88px] shrink-0 text-xs tabular">
        <div className="font-medium">{day(r.startsAt)}</div>
        <div className="text-muted">{time(r.startsAt)}</div>
      </div>
      <div className="min-w-0 flex-1">
        <div className={`truncate text-sm ${cancelled ? "text-muted line-through" : ""}`}>
          {r.leadId ? <Link href={`/leads/${r.leadId}`} className="hover:underline">{r.customerName ?? "(no name)"}</Link> : r.customerName ?? "(no name)"}
        </div>
        <div className="truncate text-xs text-muted">
          {[r.serviceName, r.staffName && `with ${r.staffName}`].filter(Boolean).join(" · ") || "Consultation"}
          {cancelled && <span className="ml-1 text-bloom">· cancelled</span>}
        </div>
      </div>
      <div className="shrink-0">
        {r.leadId ? (
          <Link href={`/leads/${r.leadId}`} className="flex items-center gap-1.5 text-xs">
            <span className="tabular text-muted">{r.recordId}</span>
            {r.leadStatus && <StatusPill status={r.leadStatus as Status} />}
          </Link>
        ) : (
          <AddLead id={r.id} />
        )}
      </div>
    </li>
  );
}

function AddLead({ id }: { id: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  return (
    <span className="flex items-center gap-2">
      <span className="text-xs text-muted">Not in CRM</span>
      <button
        type="button"
        className="btn px-2 py-0.5 text-xs"
        disabled={pending}
        title={err ?? "Create a lead from this booking"}
        onClick={() =>
          start(async () => {
            const r = await addLeadFromAppointmentAction(id);
            if (r.ok) router.push(`/leads/${r.data.leadId}`);
            else setErr(r.error);
          })
        }
      >
        {pending ? "Adding…" : err ? "Retry" : "Add as lead"}
      </button>
    </span>
  );
}

function Placeholder() {
  return (
    <div className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="max-w-xl">
        <p className="text-sm">
          Once Setmore is connected, clients who have booked a consultation, or met you recently, show up here with the lead they belong to.
          Bookings from people who aren&apos;t in the CRM yet get an <strong className="font-medium">Add as lead</strong> button.
        </p>
        <p className="mt-2 text-xs text-muted">
          Waiting for the Setmore API token: request it from api@setmore.com (Setmore Pro plan), then add it in Vercel as <code className="rounded bg-paper px-1">SETMORE_REFRESH_TOKEN</code>.
        </p>
      </div>
      <ul className="w-full space-y-2 sm:w-72" aria-hidden>
        {[0, 1, 2].map((i) => (
          <li key={i} className="flex items-center gap-3">
            <span className="h-7 w-16 rounded bg-paper" />
            <span className="flex-1 space-y-1"><span className="block h-2.5 w-3/4 rounded bg-paper" /><span className="block h-2 w-1/2 rounded bg-paper" /></span>
          </li>
        ))}
      </ul>
    </div>
  );
}
