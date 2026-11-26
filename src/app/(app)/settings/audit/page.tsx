import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { desc, eq, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { auditLog, users } from "@/db/schema";
import { withPage } from "@/server/page";
import { PageHeader } from "@/components/page-header";

export const dynamic = "force-dynamic";
export const metadata = { title: "Audit log" };

const LABELS: Record<string, string> = {
  "auth.sign_in": "Signed in", "auth.sign_out": "Signed out", "auth.sign_out_everywhere": "Signed out everywhere",
  "auth.password_changed": "Changed password", "auth.password_reset_sent": "Password reset link sent", "auth.session_expired": "Session expired",
  "auth.mfa_enrolled": "Turned on 2-step verification", "auth.mfa_removed": "Removed 2-step verification",
  "auth.device_trusted": "Trusted a device for 30 days", "auth.device_untrusted": "Stopped trusting a device", "finance.imported": "Imported contracts",
  "user.created": "Added a person", "user.updated": "Changed a person", "user.invited": "Sent an invite", "access.changed": "Changed module access",
};

/** Security events, newest first (Admin: manage). Read-only: the table refuses edits and deletes. */
export default async function AuditPage() {
  const target = alias(users, "target_user");
  const { rows, page } = await withPage(async (tx) => ({
    rows: await tx
      .select({ e: auditLog, actor: users.name, targetName: target.name })
      .from(auditLog)
      .leftJoin(users, eq(users.id, auditLog.actorUserId))
      .leftJoin(target, eq(sql`case when ${auditLog.target} like 'user:%' then substr(${auditLog.target}, 6)::uuid end`, target.id))
      .orderBy(desc(auditLog.at))
      .limit(300),
  }), "users:manage");
  return (
    <div className="space-y-5">
      <Link href="/settings" className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink"><ArrowLeft size={14} /> Settings</Link>
      <PageHeader eyebrow="Admin" title="Audit log" description="Sign-ins, password and 2-step changes, and changes to people and their access. Newest first; entries can't be edited or deleted." />
      <div className="card overflow-x-auto">
        <table className="w-full min-w-[720px]">
          <thead className="bg-card-2"><tr><th className="th">When</th><th className="th">Who</th><th className="th">What</th><th className="th">Details</th></tr></thead>
          <tbody className="divide-y divide-edge">
            {rows.length === 0 && <tr><td colSpan={4} className="td py-10 text-center text-muted">Nothing recorded yet.</td></tr>}
            {rows.map(({ e, actor, targetName }) => (
              <tr key={e.id}>
                <td className="td whitespace-nowrap tabular text-muted">{e.at.toLocaleString("en-CA", { timeZone: page.settings.businessHours.timezone, dateStyle: "medium", timeStyle: "short" })}</td>
                <td className="td whitespace-nowrap">{actor ?? <span className="text-muted">System</span>}</td>
                <td className="td">{LABELS[e.action] ?? e.action}{targetName && e.action !== "auth.sign_in" ? <span className="text-muted"> · {targetName}</span> : null}</td>
                <td className="td max-w-[380px] text-xs text-muted">{describe(e.metadata)}{e.ip ? <span className="block">IP {e.ip}</span> : null}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function describe(m: unknown): string {
  if (!m || typeof m !== "object") return "";
  const o = m as Record<string, unknown>;
  if (o.changes && typeof o.changes === "object")
    return Object.entries(o.changes as Record<string, { from: unknown; to: unknown }>).map(([k, v]) => `${k}: ${String(v.from ?? "—")} → ${String(v.to)}`).join("; ");
  return Object.entries(o).filter(([k]) => k !== "access").map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`).join("; ");
}
