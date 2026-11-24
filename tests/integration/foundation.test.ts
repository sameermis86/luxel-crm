import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, asc, sql } from "drizzle-orm";
import { withCtx, closeDb } from "@/db/client";
import { leads, leadEvents } from "@/db/schema";
import { createLead, updateLead, logActivity, LeadError } from "@/server/leads/service";
import { freshOrg, addUser, ownerSql, rejectsWith } from "../helpers";

let env: Awaited<ReturnType<typeof freshOrg>>;
beforeAll(async () => (env = await freshOrg()));
afterAll(closeDb);

const baseLead = {
  firstName: "Sofia", lastName: "Rossi", email: "Sofia.Rossi+w@gmail.com", phone: "(905) 555-0123",
  eventType: "wedding" as const, eventDate: "2027-08-14", budgetMax: 12000, source: "referral" as const, venueCity: "Vaughan",
};

describe("record_id", () => {
  it("is LX-###### , unique and sequential", async () => {
    const ids = await withCtx(env.sys, async (tx) => {
      const out: string[] = [];
      for (let i = 0; i < 3; i++) out.push((await createLead(tx, env.sys, { ...baseLead, email: `x${i}@ex.com` })).recordId);
      return out;
    });
    expect(ids.every((id) => /^LX-\d{6}$/.test(id))).toBe(true);
    const n = ids.map((i) => +i.slice(3));
    expect(n[1]).toBe(n[0] + 1);
    expect(n[2]).toBe(n[1] + 1);
  });
  it("is never reused, even when a transaction rolls back", async () => {
    let rolledBack = "";
    await withCtx(env.sys, async (tx) => {
      rolledBack = (await createLead(tx, env.sys, baseLead)).recordId;
      throw new Error("rollback");
    }).catch(() => {});
    const next = await withCtx(env.sys, (tx) => createLead(tx, env.sys, baseLead));
    expect(+next.recordId.slice(3)).toBeGreaterThan(+rolledBack.slice(3));
    const [{ c }] = await withCtx(env.sys, (tx) => tx.select({ c: sql<number>`count(*)::int` }).from(leads).where(eq(leads.recordId, rolledBack)));
    expect(c).toBe(0);
  });
});

describe("createLead", () => {
  it("normalizes, scores, qualifies and logs created + scored + qualified", async () => {
    const lead = await withCtx(env.sys, (tx) => createLead(tx, env.sys, baseLead));
    expect(lead.emailNormalized).toBe("sofiarossi@gmail.com");
    expect(lead.phoneE164).toBe("+19055550123");
    expect(lead.score).toBeGreaterThanOrEqual(70);
    expect(lead.qualification).toBe("qualified");
    const ev = await withCtx(env.sys, (tx) => tx.select().from(leadEvents).where(eq(leadEvents.leadId, lead.id)));
    expect(ev.map((e) => e.type).sort()).toEqual(["created", "qualified", "scored"]);
  });
});

describe("updateLead", () => {
  it("writes one event per changed field with old → new, actor and time, in the same transaction", async () => {
    const lead = await withCtx(env.sys, (tx) => createLead(tx, env.sys, baseLead));
    const ctx = env.as(env.sameer);
    await withCtx(ctx, (tx) => updateLead(tx, ctx, lead.id, { guestCount: 180, venueName: "Paradise Banquet Hall", budgetMax: 5000 }));
    const ev = await withCtx(ctx, (tx) => tx.select().from(leadEvents).where(eq(leadEvents.leadId, lead.id)).orderBy(asc(leadEvents.at)));
    const fc = ev.filter((e) => e.type === "field_changed");
    expect(fc.map((e) => [e.field, e.oldValue, e.newValue]).sort()).toEqual(
      [["budgetMax", "12000", "5000"], ["guestCount", null, "180"], ["venueName", null, "Paradise Banquet Hall"]].sort(),
    );
    expect(fc.every((e) => e.actorId === env.sameer.id && e.actorKind === "user")).toBe(true);
    // budget dropped a band → a scored event with old/new
    const scored = ev.filter((e) => e.type === "scored" && e.oldValue !== null);
    expect(scored.length).toBe(1);
    expect(+scored[0].newValue!).toBeLessThan(+scored[0].oldValue!);
  });

  it("no-op patch writes nothing", async () => {
    const lead = await withCtx(env.sys, (tx) => createLead(tx, env.sys, baseLead));
    const before = await withCtx(env.sys, (tx) => tx.select().from(leadEvents).where(eq(leadEvents.leadId, lead.id)));
    const r = await withCtx(env.sys, (tx) => updateLead(tx, env.sys, lead.id, { firstName: "Sofia" }));
    expect(r.changed).toEqual([]);
    const after = await withCtx(env.sys, (tx) => tx.select().from(leadEvents).where(eq(leadEvents.leadId, lead.id)));
    expect(after.length).toBe(before.length);
  });

  it("rolls the lead change back if the event write fails (same transaction)", async () => {
    const lead = await withCtx(env.sys, (tx) => createLead(tx, env.sys, baseLead));
    await withCtx(env.sys, async (tx) => {
      await updateLead(tx, env.sys, lead.id, { guestCount: 99 });
      throw new Error("boom");
    }).catch(() => {});
    const [l] = await withCtx(env.sys, (tx) => tx.select().from(leads).where(eq(leads.id, lead.id)));
    expect(l.guestCount).toBeNull();
  });

  it("validates status transitions and requirements", async () => {
    const lead = await withCtx(env.sys, (tx) => createLead(tx, env.sys, baseLead));
    await expect(withCtx(env.sys, (tx) => updateLead(tx, env.sys, lead.id, { status: "lost" }))).rejects.toThrow(/lost reason/);
    const { lead: won } = await withCtx(env.sys, (tx) => updateLead(tx, env.sys, lead.id, { status: "won" }));
    expect(won.wonAt).toBeTruthy();
    expect(won.furthestStage).toBe(5);
    expect(won.contactedAt).toBeTruthy();
    const ev = await withCtx(env.sys, (tx) => tx.select().from(leadEvents).where(eq(leadEvents.leadId, lead.id)));
    expect(ev.some((e) => e.type === "status_changed" && e.oldValue === "new" && e.newValue === "won")).toBe(true);
    expect(ev.some((e) => e.type === "converted")).toBe(true);
    await expect(withCtx(env.sys, (tx) => updateLead(tx, env.sys, lead.id, { status: "contacted" }))).rejects.toThrow(LeadError);
  });

  it("logging outbound contact moves new → contacted; an inbound reply adds engagement", async () => {
    const lead = await withCtx(env.sys, (tx) => createLead(tx, env.sys, baseLead));
    const ctx = env.as(env.mansi);
    await withCtx(ctx, (tx) => logActivity(tx, ctx, lead.id, { kind: "call", summary: "Left voicemail" }));
    const { lead: l2 } = await withCtx(ctx, (tx) => logActivity(tx, ctx, lead.id, { kind: "email", direction: "inbound", summary: "They replied!" }));
    expect(l2.status).toBe("contacted");
    expect(l2.firstReplyAt).toBeTruthy();
    expect((l2.scoreBreakdown as any).engagement.points).toBe(5);
  });
});

describe("lead_events is append-only", () => {
  it("the app role cannot UPDATE or DELETE", async () => {
    const lead = await withCtx(env.sys, (tx) => createLead(tx, env.sys, baseLead));
    await rejectsWith(withCtx(env.sys, (tx) => tx.update(leadEvents).set({ newValue: "hacked" }).where(eq(leadEvents.leadId, lead.id))), /permission denied|append-only/);
    await rejectsWith(withCtx(env.sys, (tx) => tx.delete(leadEvents).where(eq(leadEvents.leadId, lead.id))), /permission denied|append-only/);
  });
  it("even the table owner is blocked by the trigger", async () => {
    const sql = ownerSql();
    await expect(sql`update lead_events set new_value = 'x'`).rejects.toThrow(/append-only/);
    await expect(sql`delete from lead_events`).rejects.toThrow(/append-only/);
    await sql.end();
  });
  it("leads cannot be deleted by the app role", async () => {
    const lead = await withCtx(env.sys, (tx) => createLead(tx, env.sys, baseLead));
    await rejectsWith(withCtx(env.sys, (tx) => tx.delete(leads).where(eq(leads.id, lead.id))), /permission denied/);
  });
});

describe("RLS", () => {
  it("staff see their own leads plus unassigned ones; owners/managers see all", async () => {
    const staff = await addUser(env.orgId, "Priya", "staff");
    const manager = await addUser(env.orgId, "Dev", "manager");
    const mine = await withCtx(env.sys, (tx) => createLead(tx, env.sys, { ...baseLead, ownerId: staff.id }));
    const theirs = await withCtx(env.sys, (tx) => createLead(tx, env.sys, { ...baseLead, ownerId: env.sameer.id }));
    const nobody = await withCtx(env.sys, (tx) => createLead(tx, env.sys, { ...baseLead }));
    const visible = async (ctx: any) => (await withCtx(ctx, (tx) => tx.select({ id: leads.id }).from(leads))).map((r) => r.id);
    const s = await visible(env.as(staff));
    expect(s).toContain(mine.id);
    expect(s).toContain(nobody.id);
    expect(s).not.toContain(theirs.id);
    expect(await visible(env.as(manager))).toContain(theirs.id);
    // staff can't see the other lead's events either
    const ev = await withCtx(env.as(staff), (tx) => tx.select().from(leadEvents).where(eq(leadEvents.leadId, theirs.id)));
    expect(ev).toEqual([]);
    // and can't update it
    await expect(withCtx(env.as(staff), (tx) => updateLead(tx, env.as(staff), theirs.id, { guestCount: 1 }))).rejects.toThrow(/not found/);
  });
  it("another org's data is invisible", async () => {
    const sql = ownerSql();
    const [other] = await sql`insert into orgs (slug, name) values ('other', 'Other') returning id`;
    await sql.end();
    const ctx = { orgId: other.id, userId: null, role: "system" as const, actorKind: "system" as const };
    const rows = await withCtx(ctx, (tx) => tx.select().from(leads));
    expect(rows).toEqual([]);
  });
  it("no context = no rows", async () => {
    const sql = (await import("postgres")).default(process.env.TEST_DATABASE_URL!, { max: 1 });
    const rows = await sql`select count(*)::int as c from leads`;
    expect(rows[0].c).toBe(0);
    await sql.end();
  });
});

describe("single write path", () => {
  it("only src/server/leads/service.ts updates the leads table", async () => {
    const { execSync } = await import("node:child_process");
    const hits = execSync(`grep -rlE "update\\((leads|schema\\.leads)\\)" src || true`).toString().trim().split("\n").filter(Boolean);
    expect(hits).toEqual(["src/server/leads/service.ts"]);
  });
});
