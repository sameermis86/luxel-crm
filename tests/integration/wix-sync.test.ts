import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { withCtx, closeDb } from "@/db/client";
import { leads, leadEvents } from "@/db/schema";
import { runWixSync, getSyncState, type WixClient } from "@/server/intake/wix-sync";
import type { WixFormSubmission, QuoteLeadItem } from "@/lib/wix-sources";
import { freshOrg } from "../helpers";

let env: Awaited<ReturnType<typeof freshOrg>>;
beforeAll(async () => (env = await freshOrg()));
afterAll(closeDb);

const forms = [
  { id: "ecf", name: "Event Contact Form", labels: {} },
  { id: "job", name: "Job Application", labels: {} },
];
const subs: WixFormSubmission[] = [
  { id: "old-future", formId: "ecf", createdDate: "2026-09-01T15:00:00Z", submissions: { first_name_70be: "Ava Old", email_b935: "ava.old@example.com", phone_a204: "+14165550101", event_date: "2027-07-10" } },
  { id: "old-past", formId: "ecf", createdDate: "2026-02-01T15:00:00Z", submissions: { first_name_70be: "Past Person", email_b935: "past@example.com", event_date: "2026-06-01" } },
  { id: "job-1", formId: "job", createdDate: "2026-11-01T15:00:00Z", submissions: { first_name: "Applicant", email: "job@example.com", start_date: "2027-01-01" } },
];
const quotes: QuoteLeadItem[] = [
  { _id: "q-old", _createdDate: { $date: "2026-10-10T12:00:00Z" }, name: "Quinn Old", email: "quinn@example.com", phone: "+16475550199", eventType: "Weddings", eventDate: "2027-09-18", tier: "Elevated", estimateLow: 12000, estimateHigh: 15000, status: "full_submission" },
];

function fakeClient(): WixClient & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async listForms() {
      return forms;
    },
    async submissionsSince(since) {
      calls.push(`subs>=${since}`);
      return subs.filter((s) => s.createdDate >= since);
    },
    async quoteLeadsSince(since) {
      calls.push(`quotes>=${since}`);
      return quotes.filter((q) => ((q._createdDate as any).$date as string) >= since);
    },
  };
}

describe("scheduled Wix sync", () => {
  const FIRST_RUN = new Date("2026-11-23T17:00:00Z");

  it("first run imports history as a backfill: future events only, lead forms only, Quote Builder included", async () => {
    const c = fakeClient();
    const r = await runWixSync(env.orgId, c, FIRST_RUN);
    expect(r).toMatchObject({ created: 2, backfilled: 2, skippedPastEvent: 1, skippedNotLead: 1, failed: 0 });
    const rows = await withCtx(env.sys, (tx) => tx.select().from(leads));
    const qb = rows.find((l) => l.email === "quinn@example.com")!;
    expect(qb).toMatchObject({ source: "quote_builder", tierInterest: "elevated", estimateTotal: 13500, ownerId: null, nextFollowUpAt: null });
    expect(qb.createdAt.toISOString()).toBe("2026-10-10T12:00:00.000Z");
    const state = await getSyncState(env.orgId);
    expect(state.liveSince).toBe(FIRST_RUN.toISOString());
    expect(state.formsCursor).toBe("2026-11-01T15:00:00Z");
  });

  it("re-running imports nothing twice", async () => {
    const r = await runWixSync(env.orgId, fakeClient(), new Date("2026-11-23T17:15:00Z"));
    expect(r.created).toBe(0);
    const n = (await withCtx(env.sys, (tx) => tx.select().from(leads))).length;
    expect(n).toBe(2);
  });

  it("anything submitted after the sync was switched on arrives as a live lead (assigned, follow-up, real submission time)", async () => {
    subs.push({ id: "new-1", formId: "ecf", createdDate: "2026-11-23T17:20:00Z", submissions: { first_name_70be: "Nina New", email_b935: "nina@example.com", phone_a204: "+14165550177", event_date: "2027-08-21", colors_or_theme: "Wedding in sage" } });
    quotes.push({ _id: "q-new", _createdDate: { $date: "2026-11-23T17:25:00Z" }, submittedAt: "2026-11-23T17:25:00Z", name: "Quentin New", email: "quentin@example.com", eventDate: "2027-10-02", eventType: "Weddings", status: "gate_captured" });
    const c = fakeClient();
    const r = await runWixSync(env.orgId, c, new Date("2026-11-23T17:30:00Z"));
    expect(r).toMatchObject({ created: 2, backfilled: 0 });
    // queried from the cursor minus the overlap window, not from the beginning
    expect(c.calls[0]).toBe("subs>=2026-11-01T09:00:00.000Z");
    const [nina] = await withCtx(env.sys, (tx) => tx.select().from(leads).where(eq(leads.email, "nina@example.com")));
    expect(nina.ownerId).not.toBeNull();
    expect(nina.nextFollowUpAt).not.toBeNull();
    expect(nina.createdAt.toISOString()).toBe("2026-11-23T17:20:00.000Z");
    const [ev] = await withCtx(env.sys, (tx) => tx.select().from(leadEvents).where(eq(leadEvents.leadId, nina.id)));
    expect(ev.actorKind).toBe("webhook");
  });

  it("a Wix error keeps the old cursors and records the error", async () => {
    const before = await getSyncState(env.orgId);
    const broken: WixClient = { ...fakeClient(), async submissionsSince() { throw new Error("Wix 503"); } };
    await expect(runWixSync(env.orgId, broken, new Date("2026-11-23T17:45:00Z"))).rejects.toThrow("Wix 503");
    const after = await getSyncState(env.orgId);
    expect(after.formsCursor).toBe(before.formsCursor);
    expect(after.lastError).toBe("Wix 503");
  });
});
