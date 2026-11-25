import { and, desc, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { KeyRound, LogOut, ShieldCheck } from "lucide-react";
import { withCtx, systemCtx } from "@/db/client";
import { auditLog } from "@/db/schema";
import { requireSession, authMode } from "@/server/auth";
import { MODULE_LIST, MODULE_LABELS, LEVEL_LABELS, requiresMfa } from "@/lib/access";
import { PASSWORD_MIN } from "@/lib/password";
import { IDLE_MS, MAX_MS } from "@/lib/session-cookie";
import { PageHeader } from "@/components/page-header";
import { ActionForm } from "@/components/action-form";
import { changePasswordAction, signOutEverywhereAction } from "./actions";
import { TwoStep } from "./two-step";

export const dynamic = "force-dynamic";
export const metadata = { title: "My account" };

const LABELS: Record<string, string> = {
  "auth.sign_in": "Signed in", "auth.sign_out": "Signed out", "auth.password_changed": "Changed password",
  "auth.sign_out_everywhere": "Signed out everywhere", "auth.mfa_enrolled": "Turned on 2-step", "auth.mfa_removed": "Turned off 2-step",
};

export default async function AccountPage({ searchParams }: { searchParams: Promise<{ setup?: string }> }) {
  const s = await requireSession({ allowPendingMfa: true });
  if (s.mfa === "needs_verify") redirect("/login/verify?next=/account");
  const { setup } = await searchParams;
  const supa = authMode() === "supabase";
  const mfaRequired = requiresMfa(s.role, s.access);
  const recent = await withCtx(systemCtx(s.orgId), (tx) =>
    tx.select().from(auditLog).where(and(eq(auditLog.orgId, s.orgId), eq(auditLog.actorUserId, s.userId))).orderBy(desc(auditLog.at)).limit(8),
  );
  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader eyebrow="Account" title="My account & security" description={`${s.name} · ${s.email}`} />

      {(setup === "2step" || s.mfa === "needs_setup") && (
        <div className="rounded-xl border border-amber/30 bg-amber-soft px-4 py-3 text-sm">
          <p className="font-medium text-amber">Set up 2-step verification to continue</p>
          <p className="mt-0.5 text-ink/80">Your access ({s.role === "owner" ? "owner" : "Finance or Admin"}) requires a code from an authenticator app at sign-in. It takes a minute, below.</p>
        </div>
      )}

      <section className="card p-5">
        <h2 className="flex items-center gap-2 text-[19px]"><ShieldCheck size={18} strokeWidth={1.75} className="text-muted" /> 2-step verification</h2>
        <p className="mt-1 text-sm text-muted">
          After your password, enter a 6-digit code from an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password, Apple Passwords).
          {mfaRequired ? " Required for your access." : " Optional for your access, and recommended."}
        </p>
        {supa ? <TwoStep required={mfaRequired} /> : <p className="mt-3 text-sm text-muted">Not used in local development.</p>}
      </section>

      <section className="card p-5" id="password">
        <h2 className="flex items-center gap-2 text-[19px]"><KeyRound size={18} strokeWidth={1.75} className="text-muted" /> Password</h2>
        <p className="mt-1 text-sm text-muted">At least {PASSWORD_MIN} characters with letters and numbers; not your name, email or &ldquo;Luxel&rdquo;. Passwords found in known data breaches are refused. Changing it signs out your other devices.</p>
        {supa ? (
          <ActionForm action={changePasswordAction} submitLabel="Change password" className="mt-3 grid max-w-md gap-3">
            <label className="block"><span className="label">Current password</span><input name="current" type="password" autoComplete="current-password" className="input" /></label>
            <label className="block"><span className="label">New password</span><input name="next" type="password" autoComplete="new-password" minLength={PASSWORD_MIN} required className="input" /></label>
            <label className="block"><span className="label">New password again</span><input name="confirm" type="password" autoComplete="new-password" minLength={PASSWORD_MIN} required className="input" /></label>
          </ActionForm>
        ) : <p className="mt-3 text-sm text-muted">Not used in local development.</p>}
      </section>

      <section className="card p-5">
        <h2 className="flex items-center gap-2 text-[19px]"><LogOut size={18} strokeWidth={1.75} className="text-muted" /> Sessions</h2>
        <p className="mt-1 text-sm text-muted">
          You&apos;re signed out after {IDLE_MS / 3600_000} hours without activity and always after {MAX_MS / 86_400_000} days. Lost a phone or used a shared computer? Sign out everywhere, including here.
        </p>
        <form action={signOutEverywhereAction} className="mt-3"><button className="btn-danger">Sign out everywhere</button></form>
        {recent.length > 0 && (
          <ul className="mt-4 divide-y divide-edge border-t border-edge text-sm">
            {recent.map((e) => (
              <li key={e.id} className="flex flex-wrap justify-between gap-2 py-2">
                <span>{LABELS[e.action] ?? e.action}</span>
                <span className="text-xs text-muted tabular">{e.at.toLocaleString("en-CA", { timeZone: "America/Toronto", dateStyle: "medium", timeStyle: "short" })}{e.ip ? ` · ${e.ip}` : ""}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card p-5">
        <h2 className="text-[19px]">My access</h2>
        <ul className="mt-2 grid gap-1 text-sm sm:grid-cols-2">
          {MODULE_LIST.map((m) => (
            <li key={m} className="flex justify-between gap-2 rounded-md bg-card-2 px-3 py-1.5"><span>{MODULE_LABELS[m]}</span><span className="text-muted">{LEVEL_LABELS[s.access[m]]}</span></li>
          ))}
        </ul>
        <p className="hint mt-2">Role: {s.role}. Ask an owner to change your access.</p>
      </section>
    </div>
  );
}
