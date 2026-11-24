import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { and, eq, isNull, sql } from "drizzle-orm";
import { withCtx, closeDb } from "@/db/client";
import { leads, leadEvents, importBatches } from "@/db/schema";
import { previewImport, commitImport, undoImport } from "@/server/import/csv";
import { INTERIM_TRACKER, autoMap } from "@/lib/csv-import";
import { createLead, addNote } from "@/server/leads/service";
import { freshOrg } from "../helpers";

let env: Awaited<ReturnType<typeof freshOrg>>;
beforeAll(async () => (env = await freshOrg()));
afterAll(closeDb);

const tracker = [
  { client: "Olivia & Daniel Park", lead_date: "2026-03-02", event_date: "2026-10-10", event_type: "Wedding", source: "Instagram", stage: "Booked", tier: "Elegant", quote_value: "9,500", contract_value: "$9,800", collected: "9800", notes: "Ballroom, blush palette" },
  { client: "Hannah Silva", lead_date: "2026-04-11", event_date: "2027-05-15", event_type: "Wedding", source: "Referral", stage: "Quote sent", tier: "Elevated", quote_value: "14200", contract_value: "", collected: "", notes: "" },
  { client: "Noor Haddad", lead_date: "2026-05-20", event_date: "2026-12-05", event_type: "Corporate", source: "Google", stage: "Lost – after quote", tier: "", quote_value: "6000", contract_value: "", collected: "", notes: "Went cheaper" },
  { client: "Rachel Cohen", lead_date: "2026-06-01", event_date: "2027-02-14", event_type: "Social", source: "Wedding show", stage: "Consult", tier: "Effortless", quote_value: "", contract_value: "", collected: "", notes: "" },
  { client: "Maya Gill", lead_date: "2026-07-07", event_date: "2027-07-07", event_type: "Wedding", source: "Instagram", stage: "Lost – no consult", tier: "", quote_value: "", contract_value: "", collected: "", notes: "" },
  { client: "Grace Chen", lead_date: "2026-08-08", event_date: "2027-08-08", event_type: "Wedding", source: "Website", stage: "Booked", tier: "", quote_value: "", contract_value: "", collected: "", notes: "" }, // booked: won even without values
  { client: "", lead_date: "2026-08-09", event_date: "", event_type: "", source: "", stage: "New lead", tier: "", quote_value: "", contract_value: "", collected: "", notes: "" }, // error: no name
];
const opts = { fileName: "tracker.csv", mapping: INTERIM_TRACKER.mapping, preset: INTERIM_TRACKER, onDuplicate: "skip" as const };

describe("CSV import with the interim tracker preset", () => {
  it("auto-maps the tracker's headers the same as the preset", () => {
    expect(autoMap(Object.keys(tracker[0]))).toEqual(INTERIM_TRACKER.mapping);
  });

  it("previews new / duplicate / error counts (Booked rows no longer need amounts)", async () => {
    const p = await withCtx(env.as(env.sameer), (tx) => previewImport(tx, env.as(env.sameer), tracker, opts));
    expect({ total: p.total, newCount: p.newCount, dup: p.duplicateCount, err: p.errorCount }).toEqual({ total: 7, newCount: 6, dup: 0, err: 1 });
    expect(p.rows.find((r) => r.rowNumber === 7)!.reasons[0]).toMatch(/No name/);
  });

  let batchId = "";
  it("imports with stage mapping, original dates and an imported event per lead", async () => {
    const ctx = env.as(env.sameer);
    const r = await withCtx(ctx, (tx) => commitImport(tx, ctx, tracker, opts));
    batchId = r.batchId;
    expect(r).toMatchObject({ created: 6, merged: 0, skipped: 0 });
    expect(r.errors.map((e) => e.row)).toEqual([7]);

    const rows = await withCtx(env.sys, (tx) => tx.select().from(leads).where(eq(leads.importBatchId, batchId)));
    const by = Object.fromEntries(rows.map((l) => [l.lastName, l]));
    expect(by.Park).toMatchObject({ status: "won", quoteValue: 9500, partnerName: "Daniel Park", source: "instagram", tierInterest: "elegant", furthestStage: 5 });
    expect(by.Park.createdAt.toISOString().slice(0, 10)).toBe("2026-03-02");
    expect(by.Silva).toMatchObject({ status: "proposal_sent", quoteValue: 14200, source: "referral" });
    expect(by.Haddad).toMatchObject({ status: "lost", lostReason: "other", furthestStage: 4, eventType: "corporate" });
    expect(by.Cohen).toMatchObject({ status: "consult_held", source: "wedding_show" });
    expect(by.Gill).toMatchObject({ status: "lost", lostReason: "no_response", furthestStage: 1 });

    const ev = await withCtx(env.sys, (tx) => tx.select().from(leadEvents).where(eq(leadEvents.type, "imported")));
    expect(ev.length).toBe(6);
    expect(ev.every((e) => (e.payload as any).importBatchId === batchId && e.actorKind === "import")).toBe(true);
  });

  it("acceptance: importing the same CSV twice creates zero new leads", async () => {
    const ctx = env.as(env.sameer);
    const before = (await withCtx(env.sys, (tx) => tx.select({ n: sql<number>`count(*)::int` }).from(leads)))[0].n;
    const p = await withCtx(ctx, (tx) => previewImport(tx, ctx, tracker, opts));
    expect(p.newCount).toBe(0);
    const r = await withCtx(ctx, (tx) => commitImport(tx, ctx, tracker, opts));
    expect(r.created).toBe(0);
    expect(r.skipped).toBe(6);
    const after = (await withCtx(env.sys, (tx) => tx.select({ n: sql<number>`count(*)::int` }).from(leads)))[0].n;
    expect(after).toBe(before);
  });

  it("undo archives the batch's leads (never deletes them)", async () => {
    const ctx = env.as(env.sameer);
    const r = await withCtx(ctx, (tx) => undoImport(tx, ctx, batchId));
    expect(r.archived).toBe(6);
    const live = await withCtx(env.sys, (tx) => tx.select().from(leads).where(and(eq(leads.importBatchId, batchId), isNull(leads.archivedAt))));
    expect(live.length).toBe(0);
    const all = await withCtx(env.sys, (tx) => tx.select().from(leads).where(eq(leads.importBatchId, batchId)));
    expect(all.length).toBe(6);
    const [b] = await withCtx(env.sys, (tx) => tx.select().from(importBatches).where(eq(importBatches.id, batchId)));
    expect(b.undoneAt).toBeTruthy();
    await expect(withCtx(ctx, (tx) => undoImport(tx, ctx, batchId))).rejects.toThrow(/already undone/);
  });

  it("after an undo the same file can be imported again", async () => {
    const ctx = env.as(env.sameer);
    const r = await withCtx(ctx, (tx) => commitImport(tx, ctx, tracker, opts));
    expect(r.created).toBe(6);
    batchId = r.batchId;
  });

  it("undo is blocked once a lead from the batch has been edited", async () => {
    const ctx = env.as(env.mansi);
    const [one] = await withCtx(env.sys, (tx) => tx.select().from(leads).where(and(eq(leads.importBatchId, batchId), isNull(leads.archivedAt))).limit(1));
    await new Promise((r) => setTimeout(r, 1100)); // edits must be after the batch time
    await withCtx(ctx, (tx) => addNote(tx, ctx, one.id, "Called them"));
    await expect(withCtx(env.as(env.sameer), (tx) => undoImport(tx, env.as(env.sameer), batchId))).rejects.toThrow(/edited after the import/);
  });
});

describe("generic CSV with duplicates", () => {
  it("skips duplicates by default and can merge into existing leads (fill blanks only)", async () => {
    const ctx = env.as(env.sameer);
    const existing = await withCtx(env.sys, (tx) =>
      createLead(tx, env.sys, { firstName: "Leah", lastName: "Martin", email: "leah.martin@example.com", eventType: "wedding", guestCount: null, venueName: "Old venue" }),
    );
    const rows = [
      { Name: "Leah Martin", "E-mail": "Leah.Martin@example.com", Guests: "150", Venue: "New venue", Phone: "416-555-0111" },
      { Name: "Ava Romano", "E-mail": "ava@example.com", Guests: "90", Venue: "Casa Loma", Phone: "" },
      { Name: "Ava Romano", "E-mail": "ava@example.com", Guests: "90", Venue: "Casa Loma", Phone: "" }, // same person twice in the file
    ];
    const mapping = autoMap(Object.keys(rows[0]));
    expect(mapping).toEqual({ Name: "fullName", "E-mail": "email", Guests: "guestCount", Venue: "venueName", Phone: "phone" });

    const p = await withCtx(ctx, (tx) => previewImport(tx, ctx, rows, { fileName: "x.csv", mapping, onDuplicate: "skip", defaultSource: "contact_us_form" }));
    expect([p.newCount, p.duplicateCount]).toEqual([1, 2]);
    expect(p.rows[0].match?.recordId).toBe(existing.recordId);

    const r = await withCtx(ctx, (tx) => commitImport(tx, ctx, rows, { fileName: "x.csv", mapping, onDuplicate: "merge_blanks", defaultSource: "contact_us_form" }));
    expect(r).toMatchObject({ created: 1, merged: 1 });
    const [l] = await withCtx(env.sys, (tx) => tx.select().from(leads).where(eq(leads.id, existing.id)));
    expect(l.guestCount).toBe(150); // was blank → filled
    expect(l.venueName).toBe("Old venue"); // not blank → kept
    expect(l.phoneE164).toBe("+14165550111");

    const [ava] = await withCtx(env.sys, (tx) => tx.select().from(leads).where(eq(leads.email, "ava@example.com")));
    expect(ava.source).toBe("contact_us_form"); // batch default source

    // undo reverts the blank-fills too
    const u = await withCtx(ctx, (tx) => undoImport(tx, ctx, r.batchId));
    expect(u).toMatchObject({ archived: 1, reverted: 1 });
    const [l2] = await withCtx(env.sys, (tx) => tx.select().from(leads).where(eq(leads.id, existing.id)));
    expect(l2.guestCount).toBeNull();
    expect(l2.venueName).toBe("Old venue");
  });
});
