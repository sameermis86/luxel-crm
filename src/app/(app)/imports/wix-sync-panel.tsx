"use client";

import { useState, useTransition } from "react";
import { syncWixNowAction } from "./actions";

export interface SyncStatus {
  configured: boolean;
  lastRunAt: string | null;
  lastError: string | null;
  lastResult: Record<string, number> | null;
  liveSince: string | null;
}

const fmt = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-CA", { timeZone: "America/Toronto", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "never";

export function WixSyncPanel({ status, canRun }: { status: SyncStatus; canRun: boolean }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const r = status.lastResult;
  return (
    <section className="card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[19px]">Wix sync</h2>
          <p className="text-sm text-muted">
            Every 15 minutes the CRM pulls new submissions from your Wix forms and the Quote Builder. Past events and non-lead forms (job applications, newsletter) are skipped.
          </p>
        </div>
        {canRun && status.configured && (
          <button
            className="btn"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const res = await syncWixNowAction();
                setMsg(res.ok ? `Done: ${res.data.created} new, ${res.data.attached} added to existing leads` : res.error);
              })
            }
          >
            {pending ? "Syncing…" : "Sync now"}
          </button>
        )}
      </div>
      {!status.configured ? (
        <NotConnected>Add <code className="font-mono text-xs">WIX_API_KEY</code> in the Vercel project settings (see docs/wix-integration.md).</NotConnected>
      ) : (
        <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
          <div><dt className="text-muted">Last run</dt><dd>{fmt(status.lastRunAt)}</dd></div>
          <div><dt className="text-muted">New leads (last run)</dt><dd className="tabular">{r?.created ?? 0}</dd></div>
          <div><dt className="text-muted">Added to existing</dt><dd className="tabular">{r?.attached ?? 0}</dd></div>
          <div><dt className="text-muted">Skipped (past / not a lead)</dt><dd className="tabular">{(r?.skippedPastEvent ?? 0) + (r?.skippedNotLead ?? 0)}</dd></div>
        </dl>
      )}
      {status.lastError && <p className="mt-2 text-sm text-bloom">Last run failed: {status.lastError}</p>}
      {msg && <p className="mt-2 text-sm text-stem" role="status">{msg}</p>}
    </section>
  );
}

export function NotConnected({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-4 flex gap-3 rounded-lg border border-amber/25 bg-amber-soft/70 px-3.5 py-3 text-sm text-ink/80">
      <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-amber" aria-hidden />
      <p><span className="font-medium text-amber">Not connected yet.</span> {children}</p>
    </div>
  );
}
