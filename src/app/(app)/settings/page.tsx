import { redirect } from "next/navigation";
import { asc } from "drizzle-orm";
import { assignmentRules, users, EVENT_TYPES, SOURCES, ROLES } from "@/db/schema";
import { withPage } from "@/server/page";
import { can } from "@/server/auth";
import { FACTOR_LABELS, type Factor } from "@/lib/scoring";
import { titleCase } from "@/lib/format";
import type { AssignmentConditions } from "@/lib/assignment";
import { ActionForm, ActionButton } from "@/components/action-form";
import { saveSettingsAction, resetSettingsAction, recomputeScoresAction, saveUserAction, saveRuleAction, deleteRuleAction } from "./actions";

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
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl">Settings</h1>
          <p className="mt-1 text-sm text-muted">Owners only. Scoring never uses names or any personal characteristic, only fit, budget, timing, intent, contactability and engagement.</p>
        </div>
        <div className="flex gap-2">
          <ActionButton action={recomputeScoresAction} label="Recompute all scores now" />
          <ActionButton action={resetSettingsAction} label="Reset to defaults" confirmText="Reset scoring, qualification and follow-up settings to the defaults?" className="btn-ghost" />
        </div>
      </div>

      <ActionForm action={saveSettingsAction} submitLabel="Save settings" className="space-y-6">
        {/* Scoring */}
        <section className="card p-4">
          <h2 className="text-xl">Lead scoring</h2>
          <p className="mb-3 text-xs text-muted">Points per factor. The maximums should add up to 100.</p>
          <div className="grid gap-4 lg:grid-cols-2">
            <fieldset className="rounded-md border border-edge p-3">
              <legend className="px-1 text-sm font-medium">Factor maximums</legend>
              <div className="flex flex-wrap gap-3">
                {(Object.keys(FACTOR_LABELS) as Factor[]).map((f) => <N key={f} name={`scoring.max.${f}`} value={s.scoring.max[f]} label={FACTOR_LABELS[f]} />)}
              </div>
            </fieldset>
            <fieldset className="rounded-md border border-edge p-3">
              <legend className="px-1 text-sm font-medium">Event fit</legend>
              <div className="flex flex-wrap gap-3">
                {EVENT_TYPES.map((t) => <N key={t} name={`scoring.eventFit.${t}`} value={s.scoring.eventFit[t]} label={titleCase(t)} />)}
              </div>
            </fieldset>
            <fieldset className="rounded-md border border-edge p-3">
              <legend className="px-1 text-sm font-medium">Budget bands (budget max, else min, else Quote Builder estimate)</legend>
              <div className="space-y-2">
                {[...s.scoring.budgetBands, { min: "", points: "" }].map((b, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm">
                    <span className="w-20 text-muted">at least $</span>
                    <input name={`scoring.budgetBands.${i}.min`} defaultValue={b.min} className="input w-28 tabular" aria-label={`Band ${i + 1} minimum`} />
                    <span className="text-muted">→</span>
                    <input name={`scoring.budgetBands.${i}.points`} defaultValue={b.points} className="input w-20 tabular" aria-label={`Band ${i + 1} points`} />
                    <span className="text-muted">pts</span>
                  </div>
                ))}
                <N name="scoring.budgetUnknown" value={s.scoring.budgetUnknown} label="Unknown budget" />
              </div>
            </fieldset>
            <fieldset className="rounded-md border border-edge p-3">
              <legend className="px-1 text-sm font-medium">Timing (months until the event; first matching band wins)</legend>
              <div className="space-y-2">
                {s.scoring.timing.bands.map((b, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm">
                    <input name={`scoring.timing.bands.${i}.minMonths`} defaultValue={b.minMonths} className="input w-16 tabular" aria-label={`Timing band ${i + 1} from months`} />
                    <span className="text-muted">to</span>
                    <input name={`scoring.timing.bands.${i}.maxMonths`} defaultValue={b.maxMonths > 1000 ? 9999 : b.maxMonths} className="input w-20 tabular" aria-label={`Timing band ${i + 1} to months`} />
                    <span className="text-muted">months →</span>
                    <input name={`scoring.timing.bands.${i}.points`} defaultValue={b.points} className="input w-16 tabular" aria-label={`Timing band ${i + 1} points`} />
                    <span className="text-muted">pts</span>
                  </div>
                ))}
                <div className="flex gap-3">
                  <N name="scoring.timing.unknown" value={s.scoring.timing.unknown} label="No date" />
                  <N name="scoring.timing.past" value={s.scoring.timing.past} label="Past" />
                </div>
              </div>
            </fieldset>
            <fieldset className="rounded-md border border-edge p-3 lg:col-span-2">
              <legend className="px-1 text-sm font-medium">Source intent (the stronger of origin and capture channel counts)</legend>
              <div className="flex flex-wrap gap-3">
                {SOURCES.map((src) => <N key={src} name={`scoring.sourceIntent.${src}`} value={s.scoring.sourceIntent[src]} label={titleCase(src)} w="w-24" />)}
              </div>
            </fieldset>
            <fieldset className="rounded-md border border-edge p-3">
              <legend className="px-1 text-sm font-medium">Contactability &amp; engagement</legend>
              <div className="flex flex-wrap gap-3">
                <N name="scoring.contactability.both" value={s.scoring.contactability.both} label="Email + phone" />
                <N name="scoring.contactability.one" value={s.scoring.contactability.one} label="One of them" />
                <N name="scoring.contactability.none" value={s.scoring.contactability.none} label="Neither" />
                <N name="scoring.engagement.replied" value={s.scoring.engagement.replied} label="Replied" />
                <N name="scoring.engagement.consult" value={s.scoring.engagement.consult} label="Consult" />
              </div>
            </fieldset>
            <fieldset className="rounded-md border border-edge p-3">
              <legend className="px-1 text-sm font-medium">Score bands</legend>
              <div className="flex flex-wrap gap-3">
                <N name="scoring.bands.hot" value={s.scoring.bands.hot} label="Hot ≥" />
                <N name="scoring.bands.warm" value={s.scoring.bands.warm} label="Warm ≥" />
              </div>
            </fieldset>
          </div>
        </section>

        {/* Qualification */}
        <section className="card p-4">
          <h2 className="text-xl">Qualification</h2>
          <div className="mt-3 grid gap-4 lg:grid-cols-[1fr_2fr]">
            <div className="flex flex-wrap gap-3">
              <N name="qualification.minBudget" value={s.qualification.minBudget} label="Minimum budget ($)" w="w-28" />
              <N name="qualification.minLeadTimeDays" value={s.qualification.minLeadTimeDays} label="Minimum lead time (days)" w="w-28" />
              <N name="qualification.qualifiedMinScore" value={s.qualification.qualifiedMinScore} label="Qualified at score ≥" w="w-28" />
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="qualification.requireEventDateForQualified" defaultChecked={s.qualification.requireEventDateForQualified} />
                Require an event date to be qualified
              </label>
            </div>
            <label className="block">
              <span className="label">Service area (one city per line; a known venue city outside this list is unqualified)</span>
              <textarea name="qualification.serviceArea" rows={7} defaultValue={s.qualification.serviceArea.join("\n")} className="input font-mono text-xs" />
            </label>
          </div>
        </section>

        {/* Follow-ups */}
        <section className="card p-4">
          <h2 className="text-xl">Business hours &amp; follow-ups</h2>
          <div className="mt-3 flex flex-wrap items-end gap-4">
            <input type="hidden" name="businessHours.timezone" value={s.businessHours.timezone} />
            <fieldset>
              <legend className="label">Working days</legend>
              <div className="flex gap-2 text-sm">
                {DAYS.map((d, i) => (
                  <label key={d} className="flex items-center gap-1">
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
            <N name="followUps.newLeadNoContactHours" value={s.followUps.newLeadNoContactHours} label="New lead untouched (hrs)" w="w-28" />
            <N name="followUps.digestHour" value={s.followUps.digestHour} label="Digest hour" />
          </div>
          <p className="mt-2 text-xs text-muted">Times are {s.businessHours.timezone}. The digest schedule itself is set in the job definition (08:00).</p>
        </section>

      </ActionForm>

      {/* Users */}
      <section className="card p-4">
        <h2 className="text-xl">Users</h2>
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
      <section className="card p-4">
        <h2 className="text-xl">Assignment rules</h2>
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
                      <Checks name="scoreBands" label="Score band" options={[["hot", "Hot"], ["warm", "Warm"], ["cold", "Cold"]]} selected={c.scoreBands ?? []} />
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
          <label key={v} className="chip cursor-pointer border-edge bg-paper font-normal">
            <input type="checkbox" name={name} value={v} defaultChecked={selected.includes(v)} /> {l}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
