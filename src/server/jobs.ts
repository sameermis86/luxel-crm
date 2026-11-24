import { and, eq, isNull, notInArray } from "drizzle-orm";
import { withCtx, systemCtx } from "@/db/client";
import { leads, users } from "@/db/schema";
import { getSettings } from "./settings";
import { requalifyLead } from "./leads/service";
import { scanAllDuplicates } from "./leads/duplicates";
import { myFollowUps, newUnassignedLeads, myLeadsWithoutFollowUp } from "./followups";
import { sendEmail, appUrl, esc } from "./email";
import { fmtDateTime, fmtDate } from "@/lib/format";

/**
 * Nightly: recompute every open lead's qualification (an event drifts inside the minimum lead time as the
 * event approaches) and re-run duplicate detection across the whole book.
 */
export async function runNightly(orgId: string, now = new Date()) {
  const ctx = systemCtx(orgId);
  let requalified = 0;
  const ids = await withCtx(ctx, (tx) =>
    tx
      .select({ id: leads.id })
      .from(leads)
      .where(and(isNull(leads.duplicateOfId), isNull(leads.archivedAt), notInArray(leads.status, ["won", "lost", "unqualified"]))),
  );
  // small transactions so one bad row can't block the run
  for (const { id } of ids) {
    const r = await withCtx(ctx, async (tx) => requalifyLead(tx, ctx, id, await getSettings(tx, orgId), now));
    if (r.changed.length) requalified++;
  }
  const dupes = await withCtx(ctx, (tx) => scanAllDuplicates(tx, ctx));
  return { checked: ids.length, requalified, ...dupes };
}

export interface Digest {
  user: { id: string; name: string; email: string };
  overdue: Awaited<ReturnType<typeof myFollowUps>>["overdue"];
  today: Awaited<ReturnType<typeof myFollowUps>>["today"];
  noFollowUp: Awaited<ReturnType<typeof myLeadsWithoutFollowUp>>;
  unassigned: Awaited<ReturnType<typeof newUnassignedLeads>>;
}

export async function buildDigests(orgId: string, now = new Date()): Promise<Digest[]> {
  const ctx = systemCtx(orgId);
  return withCtx(ctx, async (tx) => {
    const settings = await getSettings(tx, orgId);
    const people = await tx.select().from(users).where(and(eq(users.orgId, orgId), eq(users.active, true)));
    const unassigned = await newUnassignedLeads(tx);
    const out: Digest[] = [];
    for (const u of people) {
      const f = await myFollowUps(tx, u.id, now, settings.businessHours.timezone);
      out.push({
        user: { id: u.id, name: u.name, email: u.email },
        overdue: f.overdue,
        today: f.today,
        noFollowUp: await myLeadsWithoutFollowUp(tx, u.id),
        // only owners/managers can act on unassigned leads
        unassigned: u.role === "staff" ? [] : unassigned,
      });
    }
    return out;
  });
}

const name = (l: { firstName: string | null; lastName: string | null }) => [l.firstName, l.lastName].filter(Boolean).join(" ") || "(no name)";
const link = (id: string, text: string) => `<a href="${appUrl(`/leads/${id}`)}" style="color:#1B2420">${esc(text)}</a>`;

export function renderDigest(d: Digest, dateLabel: string) {
  const section = (title: string, color: string, items: string[]) =>
    items.length
      ? `<h3 style="font-family:Georgia,serif;font-weight:normal;color:${color};margin:20px 0 6px">${title} (${items.length})</h3><ul style="padding-left:18px;margin:0">${items.join("")}</ul>`
      : "";
  const li = (s: string) => `<li style="margin:4px 0">${s}</li>`;
  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#1B2420;max-width:600px">
  <p style="font-size:12px;letter-spacing:.15em;text-transform:uppercase;color:#7B786F;margin:0">Luxel lead desk · ${esc(dateLabel)}</p>
  <h2 style="font-family:Georgia,serif;font-weight:normal;margin:4px 0 12px">Good morning, ${esc(d.user.name)}</h2>
  ${section("Overdue", "#BC5468", d.overdue.map((f) => li(`${link(f.leadId, `${f.recordId} ${name(f)}`)} · due ${esc(fmtDateTime(f.dueAt))}${f.note ? ` · ${esc(f.note)}` : ""}`)))}
  ${section("Due today", "#1B2420", d.today.map((f) => li(`${link(f.leadId, `${f.recordId} ${name(f)}`)} · ${esc(fmtDateTime(f.dueAt))}${f.note ? ` · ${esc(f.note)}` : ""}`)))}
  ${section("Your leads with no follow-up set", "#B07A2A", d.noFollowUp.slice(0, 15).map((l) => li(`${link(l.id, `${l.recordId} ${name(l)}`)}`)))}
  ${section("New unassigned leads", "#5F8568", d.unassigned.map((l) => li(`${link(l.id, `${l.recordId} ${name(l)}`)} · ${esc(l.eventType)}`)))}
  <p style="margin-top:24px"><a href="${appUrl("/follow-ups")}" style="background:#1B2420;color:#F4F2EC;padding:8px 14px;border-radius:6px;text-decoration:none">Open my follow-ups</a></p>
</div>`;
  const total = d.overdue.length + d.today.length + d.noFollowUp.length + d.unassigned.length;
  const subject = `Luxel leads: ${d.overdue.length} overdue, ${d.today.length} due today${d.unassigned.length ? `, ${d.unassigned.length} unassigned` : ""}`;
  return { subject, html, empty: total === 0 };
}

/** 8:00 America/Toronto: one digest per active user (skipped when there's nothing to say). */
export async function sendDailyDigests(orgId: string, now = new Date()) {
  const digests = await buildDigests(orgId, now);
  const dateLabel = fmtDate(new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto" }).format(now));
  let sent = 0;
  for (const d of digests) {
    const r = renderDigest(d, dateLabel);
    if (r.empty) continue;
    await sendEmail({ to: d.user.email, subject: r.subject, html: r.html });
    sent++;
  }
  return { users: digests.length, sent };
}
