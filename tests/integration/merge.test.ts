import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, and, isNull, sql } from "drizzle-orm";
import { withCtx, closeDb } from "@/db/client";
import { leads, leadEvents, followUps, duplicateCandidates } from "@/db/schema";
import { createLead, setFollowUp, addNote, updateLead, LeadError } from "@/server/leads/service";
import { ingestLead } from "@/server/leads/intake";
import { mergeLeads } from "@/server/leads/merge";
import { getTimeline } from "@/server/leads/queries";
import { freshOrg } from "../helpers";

let env: Awaited<ReturnType<typeof freshOrg>>;
beforeAll(async () => (env = await freshOrg()));
afterAll(closeDb);

describe("merge", () => {
  it("merges field by field, moves follow-ups, keeps history readable and the merged record read-only", async () => {
    const ctx = env.as(env.sameer);
    const a = await withCtx(env.sys, (tx) => createLead(tx, env.sys, { firstName: "Sofia", lastName: "Rossi", email: "sofia@a.com", eventType: "wedding", eventDate: "2027-06-12", guestCount: null, venueName: "Old Hall" }));
    const b = await withCtx(env.sys, (tx) =>
      ingestLead(tx, env.sys, { firstName: "Sofia", lastName: "Rossi", email: "sofia.rossi@b.com", phone: "905-555-0123", eventType: "wedding", eventDate: "2027-06-12", guestCount: 180, venueName: "Paradise Banquet Hall" }, { mode: "webhook", form: "contact_us", submissionId: "wix-77" }),
    );
    expect(b.outcome).toBe("created");
    const B = b.lead!;
    // there is a duplicate candidate (same last name + date)
    const cands = await withCtx(env.sys, (tx) => tx.select().from(duplicateCandidates));
    expect(cands.length).toBe(1);
    await withCtx(ctx, (tx) => addNote(tx, ctx, B.id, "Note on the duplicate"));

    const r = await withCtx(ctx, (tx) => mergeLeads(tx, ctx, a.id, B.id, { venueName: "merged" }));
    expect(r.survivor).toMatchObject({ guestCount: 180, venueName: "Paradise Banquet Hall", email: "sofia@a.com", phoneE164: "+19055550123" });
    expect(r.movedFollowUps).toBe(1);

    const [m] = await withCtx(env.sys, (tx) => tx.select().from(leads).where(eq(leads.id, B.id)));
    expect(m.duplicateOfId).toBe(a.id);
    expect(m.recordId).toBe(B.recordId); // keeps its record ID so links work
    await expect(withCtx(ctx, (tx) => updateLead(tx, ctx, B.id, { guestCount: 1 }))).rejects.toThrow(/merged into another record/);

    const fus = await withCtx(env.sys, (tx) => tx.select().from(followUps).where(and(eq(followUps.leadId, a.id), isNull(followUps.doneAt))));
    expect(fus.length).toBe(1);

    // the survivor's timeline includes the merged lead's events (read in place, never moved)
    const tl = await withCtx(ctx, (tx) => getTimeline(tx, a.id));
    expect(tl.some((t) => t.recordId === B.recordId && t.e.type === "note_added")).toBe(true);
    expect(tl.some((t) => t.e.type === "merged" && t.e.leadId === a.id)).toBe(true);

    const [cand] = await withCtx(env.sys, (tx) => tx.select().from(duplicateCandidates));
    expect(cand.status).toBe("merged");

    // a repeat of the merged lead's webhook resolves to the survivor
    const again = await withCtx(env.sys, (tx) => ingestLead(tx, env.sys, { email: "sofia.rossi@b.com" }, { mode: "webhook", submissionId: "wix-77" }));
    expect(again).toMatchObject({ outcome: "duplicate_submission" });
    expect(again.lead!.id).toBe(a.id);

    // a new submission matching the merged lead's email attaches to the survivor
    const fresh = await withCtx(env.sys, (tx) => ingestLead(tx, env.sys, { email: "Sofia.Rossi@b.com", firstName: "Sofia" }, { mode: "webhook", submissionId: "wix-78" }));
    expect(fresh.outcome).toBe("attached");
    expect(fresh.lead!.id).toBe(a.id);
  });

  it("refuses to merge a lead twice", async () => {
    const ctx = env.as(env.sameer);
    const x = await withCtx(env.sys, (tx) => createLead(tx, env.sys, { firstName: "X", email: "x@x.com" }));
    const y = await withCtx(env.sys, (tx) => createLead(tx, env.sys, { firstName: "Y", email: "y@y.com" }));
    const z = await withCtx(env.sys, (tx) => createLead(tx, env.sys, { firstName: "Z", email: "z@z.com" }));
    await withCtx(ctx, (tx) => mergeLeads(tx, ctx, x.id, y.id));
    await expect(withCtx(ctx, (tx) => mergeLeads(tx, ctx, z.id, y.id))).rejects.toThrow(LeadError);
  });

  it("acceptance: record IDs are unique, sequential and never reused, including after merges", async () => {
    const all = await withCtx(env.sys, (tx) => tx.select({ r: leads.recordId }).from(leads));
    const nums = all.map((x) => Number(x.r.slice(3))).sort((p, q) => p - q);
    expect(new Set(nums).size).toBe(nums.length);
    const next = await withCtx(env.sys, (tx) => createLead(tx, env.sys, { firstName: "After", email: "after@merge.com" }));
    expect(Number(next.recordId.slice(3))).toBeGreaterThan(nums[nums.length - 1]);
    const [{ dupes }] = await withCtx(env.sys, (tx) =>
      tx.select({ dupes: sql<number>`count(*) - count(distinct ${leads.recordId})` }).from(leads),
    );
    expect(Number(dupes)).toBe(0);
    // and the audit trail still has every merged record's events
    const ev = await withCtx(env.sys, (tx) => tx.select().from(leadEvents).where(eq(leadEvents.type, "merged")));
    expect(ev.length).toBeGreaterThanOrEqual(4);
  });
});
