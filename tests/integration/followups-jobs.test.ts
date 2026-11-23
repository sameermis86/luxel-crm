import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, and } from "drizzle-orm";
import { withCtx, closeDb } from "@/db/client";
import { leads, leadEvents, followUps, duplicateCandidates } from "@/db/schema";
import { createLead, setFollowUp, logActivity, updateLead } from "@/server/leads/service";
import { ingestLead } from "@/server/leads/intake";
import { myFollowUps } from "@/server/followups";
import { buildDigests, renderDigest, sendDailyDigests, runNightly } from "@/server/jobs";
import { sentEmails } from "@/server/email";
import { freshOrg, ownerSql } from "../helpers";

let env: Awaited<ReturnType<typeof freshOrg>>;
beforeAll(async () => (env = await freshOrg()));
afterAll(closeDb);

const NOW = new Date("2026-11-24T13:00:00Z"); // 08:00 Toronto

describe("follow-ups", () => {
  it("new leads get a first follow-up within 2 business hours", async () => {
    const r = await withCtx(env.sys, (tx) =>
      ingestLead(tx, env.sys, { firstName: "Ana", lastName: "Lopez", email: "ana@example.com", eventType: "wedding" }, { mode: "manual", now: new Date("2026-11-23T21:30:00Z") }),
    );
    // Mon 16:30 Toronto + 2 business hours → Tue 10:30 Toronto = 15:30Z
    expect(r.lead!.nextFollowUpAt!.toISOString()).toBe("2026-11-24T15:30:00.000Z");
  });

  it("buckets my follow-ups into overdue / today / upcoming (Toronto days)", async () => {
    const lead = await withCtx(env.sys, (tx) => createLead(tx, env.sys, { firstName: "Bea", lastName: "Ng", email: "bea@example.com", ownerId: env.sameer.id }));
    await withCtx(env.sys, async (tx) => {
      await setFollowUp(tx, env.sys, lead.id, { dueAt: new Date("2026-11-23T15:00:00Z"), note: "overdue" });
      await setFollowUp(tx, env.sys, lead.id, { dueAt: new Date("2026-11-24T22:00:00Z"), note: "today 5pm" });
      await setFollowUp(tx, env.sys, lead.id, { dueAt: new Date("2026-11-25T06:00:00Z"), note: "tomorrow 1am" });
    });
    const f = await withCtx(env.as(env.sameer), (tx) => myFollowUps(tx, env.sameer.id, NOW, "America/Toronto"));
    expect(f.overdue.map((x) => x.note)).toContain("overdue");
    expect(f.today.map((x) => x.note)).toContain("today 5pm");
    expect(f.upcoming.map((x) => x.note)).toContain("tomorrow 1am");
    // lead.next_follow_up_at is the earliest open one
    const [l] = await withCtx(env.sys, (tx) => tx.select().from(leads).where(eq(leads.id, lead.id)));
    expect(l.nextFollowUpAt!.toISOString()).toBe("2026-11-23T15:00:00.000Z");
  });

  it("logging an activity closes follow-ups that were due", async () => {
    const lead = await withCtx(env.sys, (tx) => createLead(tx, env.sys, { firstName: "Cy", email: "cy@example.com", ownerId: env.mansi.id }));
    await withCtx(env.sys, (tx) => setFollowUp(tx, env.sys, lead.id, { dueAt: new Date(Date.now() - 3600_000) }));
    await withCtx(env.as(env.mansi), (tx) => logActivity(tx, env.as(env.mansi), lead.id, { kind: "call", summary: "Spoke" }));
    const open = await withCtx(env.sys, (tx) => tx.select().from(followUps).where(and(eq(followUps.leadId, lead.id))));
    expect(open.every((f) => f.doneAt)).toBe(true);
    const [l] = await withCtx(env.sys, (tx) => tx.select().from(leads).where(eq(leads.id, lead.id)));
    expect(l.nextFollowUpAt).toBeNull();
  });

  it("closing a lead closes its follow-ups", async () => {
    const lead = await withCtx(env.sys, (tx) => createLead(tx, env.sys, { firstName: "Di", email: "di@example.com" }));
    await withCtx(env.sys, (tx) => setFollowUp(tx, env.sys, lead.id, { dueAt: new Date(Date.now() + 86400_000) }));
    await withCtx(env.sys, (tx) => updateLead(tx, env.sys, lead.id, { status: "lost", lostReason: "price" }));
    const fus = await withCtx(env.sys, (tx) => tx.select().from(followUps).where(eq(followUps.leadId, lead.id)));
    expect(fus.every((f) => f.doneAt)).toBe(true);
  });
});

describe("daily digest", () => {
  it("each user gets overdue, due today and (owners) new unassigned leads", async () => {
    const sql = ownerSql();
    await sql`update users set accepts_leads = false`;
    await sql.end();
    await withCtx(env.sys, (tx) => ingestLead(tx, env.sys, { firstName: "Unowned", lastName: "Lead", email: "unowned@example.com" }, { mode: "manual" }));
    const sql2 = ownerSql();
    await sql2`update users set accepts_leads = true`;
    await sql2.end();

    const digests = await buildDigests(env.orgId, NOW);
    const sameer = digests.find((d) => d.user.id === env.sameer.id)!;
    expect(sameer.overdue.length).toBeGreaterThan(0);
    expect(sameer.today.length).toBeGreaterThan(0);
    expect(sameer.unassigned.map((u) => u.firstName)).toContain("Unowned");
    const r = renderDigest(sameer, "Nov 24, 2026");
    expect(r.subject).toMatch(/overdue.*due today.*unassigned/);
    expect(r.html).toContain("Good morning, Sameer");

    sentEmails.length = 0;
    const sent = await sendDailyDigests(env.orgId, NOW);
    expect(sent.sent).toBeGreaterThanOrEqual(1);
    expect(sentEmails.some((e) => e.to === "sameer@luxeldecor.com")).toBe(true);
  });
});

describe("nightly job", () => {
  it("rescores leads whose timing band changed and finds new duplicate pairs", async () => {
    // scored on Oct 1: event Feb 15 is 4.5 months out → 15 timing points
    const lead = await withCtx(env.sys, (tx) =>
      createLead(tx, env.sys, { firstName: "Eve", lastName: "Stone", email: "eve@example.com", eventType: "wedding", eventDate: "2027-02-15", budgetMax: 9000 }, { now: new Date("2026-10-01T12:00:00Z") }),
    );
    expect((lead.scoreBreakdown as any).timing.points).toBe(15);
    // two leads with the same phone that slipped in without a dedupe check
    const a = await withCtx(env.sys, (tx) => createLead(tx, env.sys, { firstName: "Fay", lastName: "One", phone: "647-555-0199" }));
    const b = await withCtx(env.sys, (tx) => createLead(tx, env.sys, { firstName: "Fay", lastName: "Two", phone: "(647) 555 0199" }));

    const r = await runNightly(env.orgId, NOW); // Nov 24: 2.7 months out → 10 points
    expect(r.rescored).toBeGreaterThanOrEqual(1);
    expect(r.newCandidates).toBeGreaterThanOrEqual(1);

    const [l] = await withCtx(env.sys, (tx) => tx.select().from(leads).where(eq(leads.id, lead.id)));
    expect((l.scoreBreakdown as any).timing.points).toBe(10);
    expect(l.score).toBe(lead.score - 5);
    const scored = await withCtx(env.sys, (tx) => tx.select().from(leadEvents).where(and(eq(leadEvents.leadId, lead.id), eq(leadEvents.type, "scored"))));
    expect(scored.some((e) => e.oldValue === String(lead.score) && e.newValue === String(lead.score - 5) && e.actorKind === "system")).toBe(true);

    const pair = await withCtx(env.sys, (tx) => tx.select().from(duplicateCandidates).where(eq(duplicateCandidates.leadA, [a.id, b.id].sort()[0])));
    expect(pair[0]).toMatchObject({ confidence: "high", matchReasons: ["same_phone"] });

    // running again changes nothing
    const again = await runNightly(env.orgId, NOW);
    expect(again.newCandidates).toBe(0);
  });
});
