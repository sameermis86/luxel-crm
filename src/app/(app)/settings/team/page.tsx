import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { ROLES } from "@/db/schema";
import { withPage } from "@/server/page";
import { ctxFor } from "@/server/auth";
import { listTeam } from "@/server/team";
import { titleCase } from "@/lib/format";
import { MODULE_LIST, MODULE_LABELS, MODULE_HINTS, LEVELS, LEVEL_LABELS, defaultLevel, requiresMfa } from "@/lib/access";
import { ActionForm } from "@/components/action-form";
import { PageHeader } from "@/components/page-header";
import { saveMemberAction } from "./actions";
import { InviteButton } from "./invite-button";

export const dynamic = "force-dynamic";
export const metadata = { title: "Team & access" };

export default async function TeamPage() {
  const { page } = await withPage(async () => ({}), "users:manage");
  const team = await listTeam(ctxFor(page.session));
  const blank = { id: "", name: "", email: "", role: "staff" as const, active: true, acceptsLeads: false, explicit: {}, access: Object.fromEntries(MODULE_LIST.map((m) => [m, defaultLevel("staff", m)])) as Record<string, string>, authUserId: null };
  return (
    <div className="space-y-6">
      <Link href="/settings" className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink"><ArrowLeft size={14} /> Settings</Link>
      <PageHeader
        eyebrow="Admin"
        title="Team & access"
        description="Who can sign in, and what they can open. Each module is No access, View, Edit or Manage. Owners always have everything. Changes apply on the person's next click and are recorded in the audit log."
      />
      <div className="card overflow-x-auto p-4 text-sm">
        <table className="w-full min-w-[640px]">
          <thead><tr><th className="th pl-0">Module</th><th className="th">View</th><th className="th">Edit</th><th className="th">Manage</th></tr></thead>
          <tbody className="divide-y divide-edge text-[13px]">
            <tr><td className="td pl-0 font-medium">Sales &amp; CRM</td><td className="td">Leads, dashboard, follow-ups</td><td className="td">Change leads, log calls, send reminders</td><td className="td">Bulk changes, merge, imports</td></tr>
            <tr><td className="td pl-0 font-medium">Fulfillment &amp; Ops</td><td className="td">Event board, pull sheets</td><td className="td">Tick items and tasks, notes</td><td className="td">Same as edit</td></tr>
            <tr><td className="td pl-0 font-medium">Finance</td><td className="td">Contracts and revenue</td><td className="td">Same as view</td><td className="td">Import from Goodshuffle</td></tr>
            <tr><td className="td pl-0 font-medium">Admin</td><td className="td">Nothing extra</td><td className="td">Nothing extra</td><td className="td">Settings, team &amp; access, audit log</td></tr>
          </tbody>
        </table>
        <p className="hint mt-2">Two-step verification is required for owners and anyone with Finance or Admin access. Seeing everyone&apos;s leads (not just their own) comes with the Owner and Manager roles.</p>
      </div>

      <ul className="space-y-3">
        {[...team, null].map((u) => {
          const m = u ?? blank;
          return (
            <li key={u?.id ?? "new"} className="card p-4">
              <ActionForm action={saveMemberAction} submitLabel={u ? "Save" : "Add person"} className="space-y-3 text-sm">
                {u && <input type="hidden" name="id" value={u.id} />}
                <div className="flex flex-wrap items-end gap-3">
                  <label className="block"><span className="label">Name</span><input name="name" defaultValue={m.name} required className="input w-44" /></label>
                  <label className="block"><span className="label">Email</span><input name="email" type="email" defaultValue={m.email} required className="input w-64" /></label>
                  <label className="block">
                    <span className="label">Role</span>
                    <select name="role" defaultValue={m.role} className="input">
                      {ROLES.map((r) => <option key={r} value={r}>{titleCase(r)}</option>)}
                    </select>
                  </label>
                  <label className="check-chip mb-0.5"><input type="checkbox" name="active" defaultChecked={m.active} /> Can sign in</label>
                  <label className="check-chip mb-0.5"><input type="checkbox" name="acceptsLeads" defaultChecked={m.acceptsLeads} /> Receives new leads</label>
                  {u && (
                    <span className="ml-auto flex items-center gap-2 pb-1 text-xs text-muted">
                      {u.authUserId ? "Has signed in" : "Not signed in yet"}
                      {requiresMfa(u.role, u.access) && <span className="chip border-amber/30 bg-amber-soft text-amber">2-step required</span>}
                    </span>
                  )}
                </div>
                <fieldset className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
                  <legend className="label">Module access{m.role === "owner" ? ": owners always have full access" : ""}</legend>
                  {MODULE_LIST.map((mod) => (
                    <label key={mod} className="block rounded-[var(--radius-control)] border border-edge p-2">
                      <span className="block text-[13px] font-medium">{MODULE_LABELS[mod]}</span>
                      <span className="mb-1.5 block text-[11px] text-muted">{MODULE_HINTS[mod]}</span>
                      <select name={`access.${mod}`} defaultValue={m.role === "owner" ? "manage" : m.access[mod]} disabled={m.role === "owner"} className="input h-8 text-[13px]" aria-label={`${MODULE_LABELS[mod]} access`}>
                        {LEVELS.map((l) => <option key={l} value={l}>{LEVEL_LABELS[l]}{u && !u.explicit[mod] && l === defaultLevel(m.role, mod) ? " (default)" : ""}</option>)}
                      </select>
                    </label>
                  ))}
                </fieldset>
              </ActionForm>
              {u && u.active && u.id !== page.session.userId && <div className="mt-2 flex justify-end"><InviteButton userId={u.id} signedIn={!!u.authUserId} /></div>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
