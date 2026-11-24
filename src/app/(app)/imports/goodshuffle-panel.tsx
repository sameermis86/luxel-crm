"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { STATUS_LABELS } from "@/lib/status";
import type { Status } from "@/db/schema";
import { NotConnected } from "./wix-sync-panel";
import { goodshuffleRunAction, goodshuffleAutoApplyAction } from "./actions";

export interface GsPanelData {
  configured: string[];
  autoApply: boolean;
  lastRunAt: string | null;
  mode: "preview" | "apply" | null;
  events: number;
  alreadyInStep: number;
  lastError: string | null;
  changes: { recordId: string; leadId: string; leadName: string; from: string; to: string; gsStatus: string; eventDate: string | null; how: string; applied: boolean; error?: string }[];
  unmatched: { title: string; gsStatus: string; eventDate: string | null; reason: string }[];
}

const GS: Record<string, string> = { new: "New", quote_sent: "Quote Sent", action_needed: "Action Needed", signed: "Signed", lost: "Lost" };
const fmt = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-CA", { timeZone: "America/Toronto", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "never";

export function GoodshufflePanel({ data, isOwner }: { data: GsPanelData; isOwner: boolean }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const run = (fn: () => Promise<{ ok: boolean; error?: string; data?: any }>, ok: (d: any) => string) =>
    start(async () => {
      const r = (await fn()) as any;
      setMsg(r.ok ? ok(r.data) : r.error);
    });
  const pendingChanges = data.changes.filter((c) => !c.applied);

  return (
    <section className="card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[19px]">Goodshuffle Pro</h2>
          <p className="text-sm text-muted">
            Reads Goodshuffle&apos;s Google Calendar sync and moves matching leads forward: Quote Sent → Proposal sent, Signed / Action Needed → Won, Lost → Lost. It never moves a lead backwards.
          </p>
        </div>
        {data.configured.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <button className="btn" disabled={pending} onClick={() => run(() => goodshuffleRunAction("preview"), (d) => `Checked: ${d.changes} change(s) proposed, ${d.unmatched} unmatched`)}>
              {pending ? "Working…" : "Check now"}
            </button>
            {isOwner && pendingChanges.length > 0 && (
              <button
                className="btn-bloom"
                disabled={pending}
                onClick={() => {
                  if (!confirm(`Update ${pendingChanges.length} lead status(es) from Goodshuffle?`)) return;
                  run(() => goodshuffleRunAction("apply"), (d) => `Applied ${d.applied} change(s)`);
                }}
              >
                Apply {pendingChanges.length} change{pendingChanges.length === 1 ? "" : "s"}
              </button>
            )}
            {isOwner && pendingChanges.some((c) => c.how === "Same email or phone") && pendingChanges.some((c) => c.how !== "Same email or phone") && (
              <button
                className="btn"
                disabled={pending}
                onClick={() => {
                  const n = pendingChanges.filter((c) => c.how === "Same email or phone").length;
                  if (!confirm(`Update ${n} lead(s) matched by phone or email? Name-and-date matches stay for review.`)) return;
                  run(() => goodshuffleRunAction("apply", true), (d) => `Applied ${d.applied} phone/email match(es)`);
                }}
              >
                Apply phone/email matches only
              </button>
            )}
          </div>
        )}
      </div>

      {data.configured.length === 0 ? (
        <NotConnected>Add the Goodshuffle calendars&apos; private iCal addresses in Vercel (GOODSHUFFLE_ICAL_QUOTE_SENT, GOODSHUFFLE_ICAL_SIGNED, GOODSHUFFLE_ICAL_ACTION_NEEDED, GOODSHUFFLE_ICAL_LOST).</NotConnected>
      ) : (
        <>
          <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-5">
            <div><dt className="text-muted">Calendars</dt><dd>{data.configured.map((c) => GS[c] ?? c).join(", ")}</dd></div>
            <div><dt className="text-muted">Last check</dt><dd>{fmt(data.lastRunAt)}</dd></div>
            <div><dt className="text-muted">Projects read</dt><dd className="tabular">{data.events}</dd></div>
            <div><dt className="text-muted">Already up to date</dt><dd className="tabular">{data.alreadyInStep}</dd></div>
            <div>
              <dt className="text-muted">Automatic updates</dt>
              <dd>
                {isOwner ? (
                  <label className="flex items-center gap-1.5">
                    <input type="checkbox" defaultChecked={data.autoApply} disabled={pending} onChange={(e) => run(() => goodshuffleAutoApplyAction(e.target.checked), (d) => (d.autoApply ? "Automatic updates on" : "Preview only"))} />
                    {data.autoApply ? "On" : "Off (preview only)"}
                  </label>
                ) : data.autoApply ? "On" : "Off"}
              </dd>
            </div>
          </dl>
          {data.lastError && <p className="mt-2 text-sm text-bloom">Last check failed: {data.lastError}</p>}

          <h3 className="mt-4 text-sm font-medium">{data.mode === "apply" ? "Changes made in the last check" : "Proposed changes"} ({data.changes.length})</h3>
          {data.changes.length === 0 ? (
            <p className="text-sm text-muted">Nothing to change.</p>
          ) : (
            <div className="mt-1 max-h-80 overflow-auto rounded-md border border-edge">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-paper"><tr><th className="th">Lead</th><th className="th">Goodshuffle</th><th className="th">Change</th><th className="th">Matched on</th><th className="th"></th></tr></thead>
                <tbody className="divide-y divide-edge">
                  {data.changes.map((c) => (
                    <tr key={c.leadId}>
                      <td className="td"><Link className="hover:underline" href={`/leads/${c.leadId}`}><span className="text-muted tabular">{c.recordId}</span> {c.leadName}</Link></td>
                      <td className="td">{GS[c.gsStatus] ?? c.gsStatus}{c.eventDate ? <span className="text-xs text-muted"> · {c.eventDate}</span> : null}</td>
                      <td className="td">{STATUS_LABELS[c.from as Status] ?? c.from} → <strong className="font-medium">{STATUS_LABELS[c.to as Status] ?? c.to}</strong></td>
                      <td className="td text-muted">{c.how}</td>
                      <td className="td text-xs">{c.applied ? <span className="text-stem">applied</span> : c.error ? <span className="text-bloom">{c.error}</span> : <span className="text-muted">pending</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {data.unmatched.length > 0 && (
            <details className="mt-3 text-sm">
              <summary className="cursor-pointer text-muted">Goodshuffle projects not matched to a lead ({data.unmatched.length})</summary>
              <ul className="mt-1 max-h-64 space-y-0.5 overflow-auto">
                {data.unmatched.map((u, i) => (
                  <li key={i}>{u.title || "(untitled)"} <span className="text-xs text-muted">· {GS[u.gsStatus]} · {u.eventDate ?? "no date"} · {u.reason}</span></li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
      {msg && <p className="mt-2 text-sm text-stem" role="status">{msg}</p>}
    </section>
  );
}
