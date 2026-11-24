import { and, eq, isNull, notInArray, sql, desc } from "drizzle-orm";
import { asSystem, onCommit, type Ctx, type Tx } from "@/db/client";
import { assignmentRules, leads, leadEvents, notifications, users, type Lead } from "@/db/schema";
import { pickAssignee, type AssignmentConditions } from "@/lib/assignment";
import type { Settings } from "@/lib/config/defaults";
import { updateLead } from "./service";
import { getSettings } from "../settings";
import { sendEmail, appUrl, esc } from "../email";

/** Run the rules engine for a lead and assign it. Returns the chosen user id (or null). */
export async function autoAssign(tx: Tx, ctx: Ctx, lead: Lead, settings?: Settings) {
  const s = settings ?? (await getSettings(tx, ctx.orgId));
  return asSystem(tx, ctx, async () => {
    const [rules, people, counts, last] = await Promise.all([
      tx.select().from(assignmentRules).where(eq(assignmentRules.orgId, ctx.orgId)),
      tx.select().from(users).where(eq(users.orgId, ctx.orgId)),
      tx
        .select({ ownerId: leads.ownerId, n: sql<number>`count(*)::int` })
        .from(leads)
        .where(
          and(
            eq(leads.orgId, ctx.orgId),
            isNull(leads.duplicateOfId),
            isNull(leads.archivedAt),
            notInArray(leads.status, ["won", "lost", "unqualified"]),
          ),
        )
        .groupBy(leads.ownerId),
      tx
        .select({ userId: leadEvents.newValue, at: sql<Date>`max(${leadEvents.at})` })
        .from(leadEvents)
        .where(and(eq(leadEvents.orgId, ctx.orgId), eq(leadEvents.type, "assigned")))
        .groupBy(leadEvents.newValue),
    ]);
    const result = pickAssignee(
      {
        source: lead.source,
        eventType: lead.eventType,
        budget: lead.budgetMax ?? lead.budgetMin ?? lead.estimateTotal ?? null,
        sourceDetail: lead.sourceDetail,
        venueName: lead.venueName,
      },
      rules.map((r) => ({ ...r, conditions: (r.conditions ?? {}) as AssignmentConditions })),
      people,
      Object.fromEntries(counts.filter((c) => c.ownerId).map((c) => [c.ownerId!, c.n])),
      Object.fromEntries(last.filter((l) => l.userId).map((l) => [l.userId!, new Date(l.at)])),
    );
    if (result.userId && result.userId !== lead.ownerId) {
      const rule = rules.find((r) => r.id === result.ruleId);
      await assignLead(tx, ctx, lead.id, result.userId, { ruleId: result.ruleId, ruleName: rule?.name ?? null, how: result.reason });
    }
    return result;
  });
}

/** Assign (auto or manual). Logged as an `assigned` event; owner notified in-app + email after commit. */
export async function assignLead(tx: Tx, ctx: Ctx, leadId: string, userId: string | null, payload: Record<string, unknown> = {}) {
  const { lead, changed } = await updateLead(tx, ctx, leadId, { ownerId: userId }, { payload });
  if (!changed.includes("ownerId") || !userId || userId === ctx.userId) return lead;
  const [owner] = await asSystem(tx, ctx, () => tx.select().from(users).where(eq(users.id, userId)));
  if (!owner) return lead;
  const name = [lead.firstName, lead.lastName].filter(Boolean).join(" ") || "New lead";
  await asSystem(tx, ctx, () =>
    tx.insert(notifications).values({ orgId: ctx.orgId, userId, kind: "assigned", title: `${lead.recordId} ${name} was assigned to you`, leadId }),
  );
  onCommit(() =>
    sendEmail({
      to: owner.email,
      subject: `New lead assigned: ${lead.recordId} ${name} `,
      html: `<p>Hi ${esc(owner.name)},</p><p><strong>${esc(lead.recordId)} ${esc(name)}</strong> was assigned to you.</p>
        <p>${esc(lead.eventType)} · ${esc(lead.eventDate ?? "date TBD")}</p>
        <p><a href="${appUrl(`/leads/${lead.id}`)}">Open the lead</a></p>`,
    }),
  );
  return lead;
}

export async function lastAssignmentEvent(tx: Tx, leadId: string) {
  const [e] = await tx.select().from(leadEvents).where(and(eq(leadEvents.leadId, leadId), eq(leadEvents.type, "assigned"))).orderBy(desc(leadEvents.at)).limit(1);
  return e ?? null;
}
