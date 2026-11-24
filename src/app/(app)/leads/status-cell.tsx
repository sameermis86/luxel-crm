"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { LostReason, Status } from "@/db/schema";
import { LOST_REASONS } from "@/db/schema";
import { STATUS_LABELS, LOST_REASON_LABELS, allowedTransitions } from "@/lib/status";
import { changeStatusInlineAction } from "./actions";
import { STATUS_TONE } from "@/components/badges";

const TONE = Object.fromEntries(Object.entries(STATUS_TONE).map(([k, v]) => [k, v.pill])) as Record<Status, string>;

/** Status pill that is also a dropdown: change a lead's status without opening it. */
export function StatusCell({ leadId, recordId, status: initial, readOnly, canUndoWin = false }: { leadId: string; recordId: string; status: Status; readOnly?: boolean; canUndoWin?: boolean }) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>(initial);
  const [pendingTo, setPendingTo] = useState<Status | null>(null); // lost / unqualified waiting for a reason
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, start] = useTransition();

  const save = (to: Status, extras: { lostReason?: string; unqualifiedReason?: string } = {}) =>
    start(async () => {
      setError(null);
      const prev = status;
      setStatus(to); // optimistic
      const r = await changeStatusInlineAction(leadId, { status: to, ...extras });
      if (r.ok) {
        setPendingTo(null);
        setReason("");
        router.refresh();
      } else {
        setStatus(prev);
        setError(r.error);
      }
    });

  const onPick = (to: Status) => {
    if (to === status) return;
    if (to === "lost" || to === "unqualified") {
      setPendingTo(to);
      setReason("");
      return;
    }
    save(to);
  };

  if (readOnly) {
    return <span className={`chip ${TONE[status]}`}>{STATUS_LABELS[status]}</span>;
  }

  const options = [status, ...allowedTransitions(status, canUndoWin)];
  return (
    <div className="min-w-[150px]">
      <label className="sr-only" htmlFor={`status-${leadId}`}>Status for {recordId}</label>
      <select
        id={`status-${leadId}`}
        value={pendingTo ?? status}
        disabled={saving}
        onChange={(e) => onPick(e.target.value as Status)}
        className={`chip cursor-pointer appearance-none pr-6 font-medium focus:outline-none ${TONE[pendingTo ?? status]} ${saving ? "opacity-60" : ""}`}
        style={{ backgroundImage: "linear-gradient(45deg, transparent 50%, currentColor 50%), linear-gradient(135deg, currentColor 50%, transparent 50%)", backgroundPosition: "calc(100% - 10px) 55%, calc(100% - 6px) 55%", backgroundSize: "4px 4px", backgroundRepeat: "no-repeat" }}
        title="Change status"
      >
        {options.map((s) => (
          <option key={s} value={s}>{STATUS_LABELS[s]}</option>
        ))}
      </select>
      {saving && <span className="ml-1 text-[11px] text-muted">Saving…</span>}

      {pendingTo && !saving && (
        <div className="mt-1.5 flex w-max items-center gap-1.5 rounded-md border border-edge bg-card p-1.5 shadow-sm">
          {pendingTo === "lost" ? (
            <select aria-label="Lost reason" className="input w-36 py-0.5 text-xs" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus>
              <option value="" disabled>Why lost?</option>
              {LOST_REASONS.map((r: LostReason) => <option key={r} value={r}>{LOST_REASON_LABELS[r]}</option>)}
            </select>
          ) : (
            <input
              aria-label="Unqualified reason"
              className="input w-40 py-0.5 text-xs"
              placeholder="Reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && reason.trim() && save(pendingTo, { unqualifiedReason: reason })}
              autoFocus
            />
          )}
          <button
            type="button"
            className="btn-primary px-2 py-0.5 text-xs"
            disabled={!reason.trim()}
            onClick={() => save(pendingTo, pendingTo === "lost" ? { lostReason: reason } : { unqualifiedReason: reason })}
          >
            Save
          </button>
          <button type="button" className="btn-ghost px-1.5 py-0.5 text-xs" onClick={() => setPendingTo(null)}>Cancel</button>
        </div>
      )}
      {error && <p className="mt-1 max-w-[220px] text-[11px] text-bloom" role="alert">{error}</p>}
    </div>
  );
}
