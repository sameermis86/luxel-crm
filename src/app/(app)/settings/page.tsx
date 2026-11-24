import { redirect } from "next/navigation";
import { asc } from "drizzle-orm";
import { assignmentRules, users, EVENT_TYPES, SOURCES, ROLES } from "@/db/schema";
import { withPage } from "@/server/page";
import { can } from "@/server/auth";
import { titleCase } from "@/lib/format";
import type { AssignmentConditions } from "@/lib/assignment";
import { ActionForm, ActionButton } from "@/components/action-form";
import { saveSettingsAction, resetSettingsAction, saveUserAction, saveRuleAction, deleteRuleAction } from "./actions";
import { PageHeader } from "@/components/page-header";

export const dynamic = "force-dynamic";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default async function SettingsPage() {
  const { people, rules, page } = await withPage(async (tx) => ({
    people: await tx.select().from(users).orderBy(asc(users.name)),
    rules: await tx.select().from(assignmentRules).orderBy(asc(assignmentRules.priority)),
  }));
  if (!can(page.session, "settings:manage")) redirect("/");
  const s = page.settings;
  const N = ({ name, value, label, step = "1", w = "w-20" }: { name: string; value: number; label?: string; step?: string; w?: string }) => (
    <label className="block">
      {label && <span className="label">{label}</span>}
      <input name={name} defaultValue={value} inputMode="decimal" step={step} className={`input ${w} tabular`} aria-label={label ?? name} />
    </label>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Owners only"
        title="Settings"
        description="Business hours, follow-up timing, the team and how new leads are assigned."
        actions={<ActionButton action={resetSettingsAction} label="Reset to defaults" confirmText="Reset follow-up and business-hours settings to the defaults?" className="btn-ghost" />}
      />

      <ActionForm action={saveSettingsAction} submitLabel="Save settings" className="space-y-6">

        {/* Follow-ups */}
        <section className="card p-5">
          <h2 className="text-[19px]">Business hours &amp; follow-ups</h2>
          <div className="mt-3 flex flex-wrap items-end gap-4">
            <input type="hidden" name="businessHours.timezone" value={s.businessHours.timezone} />
            <fieldset>
              <legend className="label">Working days</legend>
              <div className="flex flex-wrap gap-1.5">
                {DAYS.map((d, i) => (
                  <label key={d} className="check-chip">
                    <input type="checkbox" name="businessHours.days" value={i} defaultChecked={s.businessHours.days.includes(i)} /> {d}
                  </label>
                ))}
              </div>
            </fieldset>
            <N name="businessHours.startHour" value={s.businessHours.startHour} label="Opens (hour)" />
            <N name="businessHours.endHour" value={s.businessHours.endHour} label="Closes (hour)" />
            <N name="followUps.firstResponseBusinessHours" value={s.followUps.firstResponseBusinessHours} label="First response (business hrs)" w="w-28" />
            <N name="followUps.afterContactedDays" value={s.followUps.afterContactedDays} label="After contact (days)" w="w-28" />
            <N name="followUps.beforeConsultDays" value={s.followUps.beforeConsultDays} label="Before consult (days)" w="w-28" />
            <N name="followUps.afterProposalDays" value={s.followUps.afterProposalDays} label="After proposal (days)" w="w-28" />
            <N name="followUps.freshInquiryDays" value={s.followUps.freshInquiryDays} label="New inquiry window (days)" w="w-28" />
            <N name="followUps.chaseQuoteDays" value={s.followUps.chaseQuoteDays} label="Chase quotes after (days)" w="w-28" />
            <N name="followUps.newLeadNoContactHours" value={s.followUps.newLeadNoContactHours} label="New lead untouched (hrs)" w="w-28" />
            <N name="followUps.digestHour" value={s.followUps.digestHour} label="Digest hour" />
          </div>
          <p className="mt-2 text-xs text-muted">Times are {s.businessHours.timezone}. The digest schedule itself is set in the job definition (08:00).</p>
        </section>

        {/* SMS reminders */}
        <section className="card p-5" id="sms">
          <h2 className="text-[19px]">Reminders: texts</h2>
          <p className="mt-1 max-w-2xl text-sm text-muted">
            Texts go out from the office iPhone (Texts to send, or Text reminder on a lead). Placeholders: <code>{"{first_name}"}</code> <code>{"{event}"}</code>{" "}
            <code>{"{event_date}"}</code> <code>{"{venue}"}</code> <code>{"{sender}"}</code>. Every text names the sender and ends with &ldquo;Reply STOP to opt out.&rdquo;
            Leads who inquired more than {Math.round(s.sms.consentDays / 30)} months ago aren&apos;t offered (Canada&apos;s anti-spam law).
          </p>
          <div className="mt-3 flex flex-wrap items-end gap-4">
            <label className="block"><span className="label">Signed as</span><input name="sms.senderName" defaultValue={s.sms.senderName} className="input w-72" /></label>
            <N name="sms.minDaysBetween" value={s.sms.minDaysBetween} label="Days between reminders to a lead" w="w-28" />
          </div>
          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            {[...s.sms.templates, { label: "", body: "" }].slice(0, 6).map((t, i) => (
              <div key={i} className="rounded-[var(--radius-control)] border border-edge p-3">
                <label className="block"><span className="label">{t.body ? `Template ${i + 1}` : "Add a template"}</span>
                  <input name={`sms.templates.${i}.label`} defaultValue={t.label} placeholder="Name, e.g. Quote follow-up" className="input" />
                </label>
                <textarea name={`sms.templates.${i}.body`} defaultValue={t.body} rows={3} placeholder="Hi {first_name}, it's {sender}…" className="input mt-2 text-[13px]" aria-label={`Template ${i + 1} text`} />
              </div>
            ))}
          </div>
          <p className="hint">Clear a template&apos;s text to remove it.</p>
        </section>

        {/* Reminder emails */}
        <section className="card p-5" id="emails">
          <h2 className="text-[19px]">Reminders: emails</h2>
          <p className="mt-1 max-w-2xl text-sm text-muted">
            Sent from the info@ mailbox only when someone reviews one and clicks Send (Reminders page, or Reminder on a lead). Same placeholders as texts.
            Every email ends with the name above, this sign-off and an unsubscribe link.
          </p>
          <label className="mt-3 block max-w-xl"><span className="label">Sign-off (under the name)</span>
            <textarea name="emailReminders.signature" rows={2} defaultValue={s.emailReminders.signature} className="input text-[13px]" />
          </label>
          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            {[...s.emailReminders.templates, { label: "", subject: "", body: "" }].slice(0, 6).map((t, i) => (
              <div key={i} className="space-y-2 rounded-[var(--radius-control)] border border-edge p-3">
                <label className="block"><span className="label">{t.body ? `Email ${i + 1}` : "Add an email"}</span>
                  <input name={`emailReminders.templates.${i}.label`} defaultValue={t.label} placeholder="Name, e.g. Quote follow-up" className="input" />
                </label>
                <input name={`emailReminders.templates.${i}.subject`} defaultValue={t.subject} placeholder="Subject" className="input text-[13px]" aria-label={`Email ${i + 1} subject`} />
                <textarea name={`emailReminders.templates.${i}.body`} defaultValue={t.body} rows={5} placeholder={"Hi {first_name},\n\n…"} className="input text-[13px]" aria-label={`Email ${i + 1} text`} />
              </div>
            ))}
          </div>
          <p className="hint">Clear an email&apos;s text to remove it.</p>
        </section>

        {/* Planners & partners */}
        <section className="card p-5" id="planners">
          <h2 className="text-[19px]">Planners &amp; partners</h2>
          <p className="mt-1 max-w-2xl text-sm text-muted">
            People who book Setmore meetings with you but aren&apos;t leads. Their bookings still show under Consultations, marked Planner,
            but never create a lead, change a status or set a follow-up. Use <strong className="font-medium text-ink">Planner</strong> on a lead or a booking to add someone in one click.
          </p>
          <label className="mt-3 block max-w-xl">
            <span className="label">Emails or company domains, one per line</span>
            <textarea name="setmore.excludeContacts" rows={5} defaultValue={s.setmore.excludeContacts.join("\n")} placeholder={"kate@plannerstudio.ca\n@impresarioevents.ca"} className="input font-mono text-[13px]" />
            <span className="hint">An email matches that person only; <code>@company.ca</code> matches everyone at that company.</span>
          </label>
        </section>

      </ActionForm>

      {/* Users */}
      <section className="card p-5">
        <h2 className="text-[19px]">Users</h2>
        <p className="text-xs text-muted">Owners: everything. Managers: all leads, no settings. Staff: their own leads plus unassigned ones (enforced in the database too).</p>
        <div className="mt-3 space-y-2">
          {[...people, null].map((u) => (
            <ActionForm key={u?.id ?? "new"} action={saveUserAction} submitLabel={u ? "Save" : "Add user"} className="flex flex-wrap items-end gap-3 rounded-md border border-edge p-3 text-sm">
              {u && <input type="hidden" name="id" value={u.id} />}
              <label className="block"><span className="label">Name</span><input name="name" defaultValue={u?.name} required className="input w-40" /></label>
              <label className="block"><span className="label">Email</span><input name="email" type="email" defaultValue={u?.email} required className="input w-64" /></label>
              <label className="block">
                <span className="label">Role</span>
                <select name="role" defaultValue={u?.role ?? "staff"} className="input">
                  {ROLES.map((r) => <option key={r} value={r}>{titleCase(r)}</option>)}
                </select>
              </label>
              <label className="flex items-center gap-1 pb-2"><input type="checkbox" name="active" defaultChecked={u ? u.active : true} /> Active</label>
              <label className="flex items-center gap-1 pb-2"><input type="checkbox" name="acceptsLeads" defaultChecked={u ? u.acceptsLeads : false} /> Receives new leads</label>
            </ActionForm>
          ))}
        </div>
      </section>

      {/* Assignment rules */}
      <section className="card p-5">
        <h2 className="text-[19px]">Assignment rules</h2>
        <p className="text-xs text-muted">Checked in priority order (lowest number first); the first matching rule wins. Empty conditions match everything. A rule pointing at someone who isn't receiving leads is skipped.</p>
        <div className="mt-3 space-y-3">
          {[...rules, null].map((r) => {
            const c = (r?.conditions ?? {}) as AssignmentConditions;
            return (
              <div key={r?.id ?? "new"} className="rounded-md border border-edge p-3">
                <ActionForm action={saveRuleAction} submitLabel={r ? "Save rule" : "Add rule"} className="space-y-3 text-sm">
                  {r && <input type="hidden" name="id" value={r.id} />}
                  <div className="flex flex-wrap items-end gap-3">
                    <label className="block"><span className="label">Name</span><input name="name" defaultValue={r?.name ?? ""} required className="input w-72" /></label>
                    <label className="block"><span className="label">Priority</span><input name="priority" defaultValue={r?.priority ?? 100} className="input w-24 tabular" /></label>
                    <label className="block">
                      <span className="label">Assign to</span>
                      <select name="assignTo" defaultValue={r?.assignToUserId ?? "round_robin"} className="input">
                        <option value="round_robin">Round robin</option>
                        {people.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                      </select>
                    </label>
                    <label className="flex items-center gap-1 pb-2"><input type="checkbox" name="active" defaultChecked={r ? r.active : true} /> Active</label>
                  </div>
                  <details open={!r}>
                    <summary className="cursor-pointer text-xs text-muted">Conditions{r && Object.keys(c).length ? `: ${Object.keys(c).join(", ")}` : r ? ": none (matches everything)" : ""}</summary>
                    <div className="mt-2 grid gap-3 lg:grid-cols-2">
                      <Checks name="sources" label="Source" options={SOURCES.map((x) => [x, titleCase(x)])} selected={c.sources ?? []} />
                      <Checks name="eventTypes" label="Event type" options={EVENT_TYPES.map((x) => [x, titleCase(x)])} selected={c.eventTypes ?? []} />
                      <div className="flex gap-3">
                        <label className="block"><span className="label">Budget at least</span><input name="budgetMin" defaultValue={c.budgetMin ?? ""} className="input w-28" /></label>
                        <label className="block"><span className="label">Budget at most</span><input name="budgetMax" defaultValue={c.budgetMax ?? ""} className="input w-28" /></label>
                      </div>
                      <label className="block"><span className="label">Venue partner (comma separated, matches source detail or venue)</span><input name="venuePartners" defaultValue={(c.venuePartners ?? []).join(", ")} className="input" /></label>
                      <Checks name="pool" label="Round-robin pool (empty = everyone receiving leads)" options={people.map((u) => [u.id, u.name])} selected={r?.roundRobinPool ?? []} />
                    </div>
                  </details>
                </ActionForm>
                {r && (
                  <div className="mt-2 text-right">
                    <ActionButton action={deleteRuleAction.bind(null, r.id)} label="Delete rule" confirmText={`Delete “${r.name}”?`} className="btn-ghost text-xs text-bloom" />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function Checks({ name, label, options, selected }: { name: string; label: string; options: [string, string][]; selected: string[] }) {
  return (
    <fieldset>
      <legend className="label">{label}</legend>
      <div className="flex flex-wrap gap-1.5">
        {options.length === 0 && <span className="text-xs text-muted">none yet</span>}
        {options.map(([v, l]) => (
          <label key={v} className="check-chip">
            <input type="checkbox" name={name} value={v} defaultChecked={selected.includes(v)} /> {l}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
