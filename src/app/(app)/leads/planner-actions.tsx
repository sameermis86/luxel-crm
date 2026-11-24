"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Briefcase, RotateCcw } from "lucide-react";
import { PUBLIC_EMAIL_DOMAINS, emailDomain } from "@/lib/setmore";
import { markPlannerAction, restoreLeadAction } from "./actions";

/**
 * Owners: "this is a planner/partner, not a lead". Adds the email (or the company domain) to
 * Settings → Planners & partners and archives the lead; their bookings stop creating leads and chasers.
 */
export function PlannerButton({ leadId, appointmentId, email, small }: { leadId?: string; appointmentId?: string; email: string; small?: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const domain = emailDomain(email);
  const company = domain && !PUBLIC_EMAIL_DOMAINS.includes(domain);
  const go = (scope: "email" | "domain") => {
    const who = scope === "domain" ? `everyone at @${domain}` : email;
    if (!confirm(`Treat ${who} as a planner/partner? Their Setmore bookings won't create leads or follow-ups, and ${leadId ? "this lead" : "any lead made from their bookings"} is archived.`)) return;
    start(async () => {
      const r = await markPlannerAction({ leadId, appointmentId, scope });
      setMsg(r.ok ? { ok: true, text: r.message ?? "Done" } : { ok: false, text: r.error });
      if (r.ok) router.refresh();
    });
  };
  return (
    <details className="relative inline-block">
      <summary className={`${small ? "btn btn-sm" : "btn"} cursor-pointer list-none [&::-webkit-details-marker]:hidden`} aria-label="Mark as planner or partner">
        <Briefcase size={small ? 13 : 15} strokeWidth={1.75} aria-hidden /> {pending ? "Saving…" : "Planner"}
      </summary>
      <div className="absolute right-0 z-20 mt-1.5 w-64 rounded-[var(--radius-card)] border border-edge bg-card p-1.5 text-sm shadow-lg">
        <p className="px-2 pt-1 pb-1.5 text-xs text-muted">Not a lead: no follow-ups, no lead from their bookings.</p>
        <button type="button" disabled={pending} onClick={() => go("email")} className="w-full rounded-md px-2 py-1.5 text-left hover:bg-card-2">
          Just <span className="font-medium break-all">{email}</span>
        </button>
        {company && (
          <button type="button" disabled={pending} onClick={() => go("domain")} className="w-full rounded-md px-2 py-1.5 text-left hover:bg-card-2">
            Everyone at <span className="font-medium">@{domain}</span>
          </button>
        )}
        {msg && <p role="status" className={`px-2 py-1 text-xs ${msg.ok ? "text-stem-strong" : "text-bloom"}`}>{msg.text}</p>}
      </div>
    </details>
  );
}

export function RestoreLeadButton({ leadId }: { leadId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        className="btn btn-sm"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await restoreLeadAction(leadId);
            if (r.ok) router.refresh();
            else setErr(r.error);
          })
        }
      >
        <RotateCcw size={13} strokeWidth={1.75} aria-hidden /> {pending ? "Restoring…" : "Restore lead"}
      </button>
      {err && <span className="text-xs text-bloom">{err}</span>}
    </span>
  );
}
