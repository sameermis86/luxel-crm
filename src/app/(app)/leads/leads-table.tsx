"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import type { Qualification, Status, EventType, Source, LostReason } from "@/db/schema";
import { STATUSES, LOST_REASONS } from "@/db/schema";
import { QualBadge } from "@/components/badges";
import { STATUS_LABELS, LOST_REASON_LABELS } from "@/lib/status";
import { fmtDate, fmtRelative, titleCase } from "@/lib/format";
import { bulkAction, type ActionResult } from "./actions";
import { StatusCell } from "./status-cell";

export interface Row {
  id: string;
  recordId: string;
  firstName: string | null;
  lastName: string | null;
  partnerName: string | null;
  eventType: EventType;
  eventDate: string | null;
  source: Source;
  qualification: Qualification;
  status: Status;
  ownerName: string | null;
  nextFollowUpAt: string | null;
  createdAt: string;
  returningInquiry: boolean;
  duplicateOfId?: string | null;
}

const COLS: { key: string; label: string; sort?: string }[] = [
  { key: "record_id", label: "Record", sort: "record_id" },
  { key: "name", label: "Name", sort: "name" },
  { key: "event_date", label: "Event", sort: "event_date" },
  { key: "source", label: "Source", sort: "source" },
  { key: "qualification", label: "Qualification", sort: "qualification" },
  { key: "status", label: "Status", sort: "status" },
  { key: "owner", label: "Owner" },
  { key: "next_follow_up", label: "Next follow-up", sort: "next_follow_up" },
];

export function LeadsTable(props: {
  rows: Row[];
  sort: string;
  dir: "asc" | "desc";
  query: string;
  users: { id: string; name: string }[];
  canBulk: boolean;
  total: number;
  nowIso: string;
}) {
  const { rows, sort, dir, query } = props;
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [allMatching, setAllMatching] = useState(false);
  const now = new Date(props.nowIso);
  const sortHref = (key: string) => {
    const s = new URLSearchParams(query);
    s.set("sort", key);
    s.set("dir", sort === key && dir === "desc" ? "asc" : "desc");
    return `/leads?${s}`;
  };
  const toggle = (id: string) => {
    setAllMatching(false);
    setSelected((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  };
  const allOnPage = rows.length > 0 && rows.every((r) => selected.has(r.id));

  return (
    <div className="space-y-2">
      {props.canBulk && (selected.size > 0 || allMatching) && (
        <BulkBar
          ids={[...selected]}
          allMatching={allMatching}
          query={query}
          total={props.total}
          pageCount={rows.length}
          onSelectAllMatching={() => setAllMatching(true)}
          users={props.users}
          onDone={() => {
            setSelected(new Set());
            setAllMatching(false);
          }}
        />
      )}
      <div className="card overflow-x-auto">
        <table className="w-full min-w-[980px] border-collapse">
          <thead className="border-b border-edge bg-paper/60">
            <tr>
              {props.canBulk && (
                <th className="th w-8">
                  <input
                    type="checkbox"
                    aria-label="Select all on this page"
                    checked={allOnPage}
                    onChange={() => setSelected(allOnPage ? new Set() : new Set(rows.map((r) => r.id)))}
                  />
                </th>
              )}
              {COLS.map((c) => (
                <th key={c.key} className="th" aria-sort={c.sort && sort === c.sort ? (dir === "asc" ? "ascending" : "descending") : undefined}>
                  {c.sort ? (
                    <Link href={sortHref(c.sort)} className="hover:text-ink">
                      {c.label}
                      {sort === c.sort ? (dir === "asc" ? " ↑" : " ↓") : ""}
                    </Link>
                  ) : (
                    c.label
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-edge">
            {rows.length === 0 && (
              <tr>
                <td colSpan={COLS.length + 1} className="td py-10 text-center text-muted">
                  No leads match these filters.
                </td>
              </tr>
            )}
            {rows.map((r) => {
              const overdue = r.nextFollowUpAt && new Date(r.nextFollowUpAt) < now && !["won", "lost", "unqualified"].includes(r.status);
              return (
                <tr key={r.id} className="hover:bg-paper/50">
                  {props.canBulk && (
                    <td className="td">
                      <input type="checkbox" aria-label={`Select ${r.recordId}`} checked={allMatching || selected.has(r.id)} onChange={() => toggle(r.id)} />
                    </td>
                  )}
                  <td className="td tabular whitespace-nowrap text-muted">
                    <Link href={`/leads/${r.id}`} className="hover:text-ink">{r.recordId}</Link>
                  </td>
                  <td className="td">
                    <Link href={`/leads/${r.id}`} className="font-medium hover:underline">
                      {[r.firstName, r.lastName].filter(Boolean).join(" ") || "(no name)"}
                    </Link>
                    {r.partnerName && <span className="text-muted"> &amp; {r.partnerName}</span>}
                  </td>
                  <td className="td whitespace-nowrap">
                    {fmtDate(r.eventDate)}
                    <div className="text-xs text-muted">{titleCase(r.eventType)}</div>
                  </td>
                  <td className="td whitespace-nowrap">{titleCase(r.source)}</td>
                  <td className="td"><QualBadge q={r.qualification} /></td>
                  <td className="td"><StatusCell leadId={r.id} recordId={r.recordId} status={r.status} readOnly={!!r.duplicateOfId} /></td>
                  <td className="td whitespace-nowrap">{r.ownerName ?? <span className="text-muted">Unassigned</span>}</td>
                  <td className={`td whitespace-nowrap tabular ${overdue ? "font-medium text-bloom" : ""}`}>
                    {r.nextFollowUpAt ? fmtRelative(r.nextFollowUpAt, now) : <span className="text-muted">none</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function BulkBar(props: {
  ids: string[];
  allMatching: boolean;
  query: string;
  total: number;
  pageCount: number;
  users: { id: string; name: string }[];
  onSelectAllMatching: () => void;
  onDone: () => void;
}) {
  const [op, setOp] = useState<"assign" | "status" | "follow_up">("assign");
  const [status, setStatus] = useState<Status>("contacted");
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(async (prev, fd) => {
    const r = await bulkAction(prev, fd);
    if (r.ok) props.onDone();
    return r;
  }, null);
  const count = props.allMatching ? props.total : props.ids.length;
  return (
    <form action={action} className="card flex flex-wrap items-end gap-3 border-ink/30 bg-ink/[0.03] p-3 text-sm">
      {props.allMatching ? (
        <input type="hidden" name="scope" value="filter" />
      ) : (
        props.ids.map((id) => <input key={id} type="hidden" name="ids" value={id} />)
      )}
      <input type="hidden" name="query" value={props.query} />
      <div className="font-medium">
        {count} selected
        {!props.allMatching && props.ids.length === props.pageCount && props.total > props.pageCount && (
          <button type="button" className="ml-2 text-bloom underline" onClick={props.onSelectAllMatching}>
            Select all {props.total} matching
          </button>
        )}
      </div>
      <div>
        <label className="label" htmlFor="bulk-op">Action</label>
        <select id="bulk-op" name="op" className="input" value={op} onChange={(e) => setOp(e.target.value as any)}>
          <option value="assign">Assign to…</option>
          <option value="status">Change status…</option>
          <option value="follow_up">Set follow-up…</option>
        </select>
      </div>
      {op === "assign" && (
        <div>
          <label className="label" htmlFor="bulk-owner">Owner</label>
          <select id="bulk-owner" name="ownerId" className="input">
            <option value="">Unassigned</option>
            {props.users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </div>
      )}
      {op === "status" && (
        <>
          <div>
            <label className="label" htmlFor="bulk-status">Status</label>
            <select id="bulk-status" name="status" className="input" value={status} onChange={(e) => setStatus(e.target.value as Status)}>
              {STATUSES.filter((s) => s !== "won").map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
            </select>
          </div>
          {status === "lost" && (
            <div>
              <label className="label" htmlFor="bulk-lost">Lost reason</label>
              <select id="bulk-lost" name="lostReason" className="input">
                {LOST_REASONS.map((r: LostReason) => <option key={r} value={r}>{LOST_REASON_LABELS[r]}</option>)}
              </select>
            </div>
          )}
          {status === "unqualified" && (
            <div>
              <label className="label" htmlFor="bulk-unq">Reason</label>
              <input id="bulk-unq" name="unqualifiedReason" className="input" required />
            </div>
          )}
        </>
      )}
      {op === "follow_up" && (
        <>
          <div>
            <label className="label" htmlFor="bulk-due">Due</label>
            <input id="bulk-due" type="datetime-local" name="dueAt" className="input" required />
          </div>
          <div>
            <label className="label" htmlFor="bulk-note">Note</label>
            <input id="bulk-note" name="note" className="input" />
          </div>
        </>
      )}
      <button className="btn-primary" disabled={pending}>{pending ? "Working…" : "Apply"}</button>
      <button type="button" className="btn-ghost" onClick={props.onDone}>Cancel</button>
      {state && <span className={state.ok ? "text-stem" : "text-bloom"}>{state.ok ? state.message : state.error}</span>}
    </form>
  );
}
