import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { eq, and, isNull, sql } from "drizzle-orm";
import { withCtx, closeDb } from "@/db/client";
import { leads, leadEvents, followUps, duplicateCandidates } from "@/db/schema";
import { POST } from "@/app/api/intake/wix/route";
import { sign } from "@/server/intake/wix";
import { freshOrg } from "../helpers";

let env: Awaited<ReturnType<typeof freshOrg>>;
beforeAll(async () => (env = await freshOrg()));
afterAll(closeDb);

const SECRET = "test-secret-0123456789"; // set below
const post = (body: unknown, auth: "hmac" | "bearer" | "query" | "none" | "bad" = "hmac") => {
  const raw = JSON.stringify(body);
  const headers: Record<string, string> = { "content-type": "application/json" };
  let url = "http://localhost/api/intake/wix";
  if (auth === "hmac") headers["x-luxel-signature"] = sign(raw, SECRET);
  if (auth === "bearer") headers.authorization = `Bearer ${SECRET}`;
  if (auth === "bad") headers["x-luxel-signature"] = sign(raw, "wrong-secret-0123456789");
  if (auth === "query") url += `?token=${SECRET}`;
  return POST(new NextRequest(url, { method: "POST", body: raw, headers }));
};

const quote = (id: string, over: Record<string, unknown> = {}) => ({
  form: "quote_builder",
  submission_id: id,
  first_name: "Sofia",
  last_name: "Rossi",
  email: "sofia.rossi@gmail.com",
  phone: "905-555-0123",
  event_type: "Wedding",
  event_date: "2027-08-14",
  venue_city: "Vaughan",
  tier: "Elegant",
  estimate_total: 8450,
  utm_source: "google",
  utm_medium: "cpc",
  utm_campaign: "Spring-Bridal-2027",
  ...over,
});

beforeAll(() => {
  process.env.WIX_INTAKE_SECRET = SECRET;
});

describe("POST /api/intake/wix", () => {
  it("rejects unsigned / badly signed requests", async () => {
    expect((await post(quote("x1"), "none")).status).toBe(401);
    expect((await post(quote("x1"), "bad")).status).toBe(401);
  });

  it("acceptance: a Quote Builder submission becomes a scored, assigned lead with a follow-up", async () => {
    const t0 = Date.now();
    const res = await post(quote("qb-1"));
    const json = await res.json();
    expect(res.status).toBe(201);
    expect(json).toMatchObject({ ok: true, outcome: "created" });
    expect(Date.now() - t0).toBeLessThan(3000);

    const [lead] = await withCtx(env.sys, (tx) => tx.select().from(leads).where(eq(leads.id, json.leadId)));
    expect(lead.recordId).toMatch(/^LX-\d{6}$/);
    expect(lead.source).toBe("google_ads"); // origin from UTM
    expect(lead.captureChannel).toBe("quote_builder"); // channel from form
    expect(lead.score).toBeGreaterThan(0);
    expect(lead.qualification).toBe("qualified");
    expect([env.sameer.id, env.mansi.id]).toContain(lead.ownerId);
    expect(lead.nextFollowUpAt).toBeTruthy();
    const fus = await withCtx(env.sys, (tx) => tx.select().from(followUps).where(and(eq(followUps.leadId, lead.id), isNull(followUps.doneAt))));
    expect(fus.length).toBe(1);

    // utm_campaign is no longer stored as a field (it stays in the raw payload only)
    expect("utmCampaign" in lead).toBe(false);

    // raw payload stored on the created event, actor = webhook
    const [created] = await withCtx(env.sys, (tx) => tx.select().from(leadEvents).where(and(eq(leadEvents.leadId, lead.id), eq(leadEvents.type, "created"))));
    expect(created.actorKind).toBe("webhook");
    expect((created.payload as any).raw.submission_id).toBe("qb-1");
  });

  it("acceptance: posting the same submission_id again creates nothing new", async () => {
    const count = async () =>
      (await withCtx(env.sys, (tx) => tx.select({ n: sql<number>`count(*)::int` }).from(leads)))[0].n;
    const evCount = async () =>
      (await withCtx(env.sys, (tx) => tx.select({ n: sql<number>`count(*)::int` }).from(leadEvents)))[0].n;
    const before = [await count(), await evCount()];
    const res = await post(quote("qb-1"));
    expect(res.status).toBe(200);
    expect((await res.json()).outcome).toBe("duplicate_submission");
    expect([await count(), await evCount()]).toEqual(before);
  });

  it("a new submission from the same person attaches to the existing lead as a returning inquiry", async () => {
    const res = await post(quote("qb-2", { email: "Sofia.Rossi+again@gmail.com", message: "Following up!" }), "bearer");
    const json = await res.json();
    expect(json.outcome).toBe("attached");
    const rows = await withCtx(env.sys, (tx) => tx.select().from(leads).where(eq(leads.emailNormalized, "sofiarossi@gmail.com")));
    expect(rows.length).toBe(1);
    expect(rows[0].returningInquiry).toBe(true);
    const ev = await withCtx(env.sys, (tx) => tx.select().from(leadEvents).where(and(eq(leadEvents.leadId, rows[0].id), eq(leadEvents.type, "returning_inquiry"))));
    expect(ev.length).toBe(1);
  });

  it("medium-confidence matches create a lead plus a duplicate candidate", async () => {
    const res = await post({ form: "contact_us", submission_id: "cu-1", first_name: "Marco", last_name: "Rossi", email: "marco@example.com", event_date: "2027-08-14" }, "query");
    const json = await res.json();
    expect(json.outcome).toBe("created");
    const d = await withCtx(env.sys, (tx) => tx.select().from(duplicateCandidates));
    expect(d.some((x) => x.matchReasons.includes("same_last_name_and_date"))).toBe(true);
  });

  it("Contact Us via Automation (no submission id, nested data) is idempotent too", async () => {
    const body = { data: { "First name": "Emma", "Last name": "Kim", Email: "emma.kim@example.com", "Leave us a message...": "Prom decor", "Event Date": "2027-05-01" } };
    const a = await (await post(body, "query")).json();
    const b = await (await post(body, "query")).json();
    expect(a.outcome).toBe("created");
    expect(b.outcome).toBe("duplicate_submission");
    const [lead] = await withCtx(env.sys, (tx) => tx.select().from(leads).where(eq(leads.id, a.leadId)));
    expect(lead.source).toBe("contact_us_form");
  });

  it("bad JSON is a 400", async () => {
    const raw = "{nope";
    const res = await POST(new NextRequest("http://localhost/api/intake/wix", { method: "POST", body: raw, headers: { "x-luxel-signature": sign(raw, SECRET) } }));
    expect(res.status).toBe(400);
  });
});

describe("backfill mode", () => {
  it("keeps the original submission time, records an import, no follow-up, no owner", async () => {
    const raw = JSON.stringify({ id: "hist-1", formId: "f1", createdDate: "2025-06-02T15:00:00Z", submissions: { first_name_70be: "Old Inquiry", email_b935: "old.inquiry@example.com", event_date: "2025-09-20" } });
    const res = await POST(new NextRequest("http://localhost/api/intake/wix?backfill=1&form=contact_us", { method: "POST", body: raw, headers: { "x-luxel-signature": sign(raw, SECRET) } }));
    const json = await res.json();
    expect(json.outcome).toBe("created");
    const [lead] = await withCtx(env.sys, (tx) => tx.select().from(leads).where(eq(leads.id, json.leadId)));
    expect(lead.createdAt.toISOString()).toBe("2025-06-02T15:00:00.000Z");
    expect(lead.ownerId).toBeNull();
    expect(lead.nextFollowUpAt).toBeNull();
    expect(lead.qualification).toBe("unqualified"); // event date has passed
    const [ev] = await withCtx(env.sys, (tx) => tx.select().from(leadEvents).where(and(eq(leadEvents.leadId, lead.id), eq(leadEvents.type, "created"))));
    expect(ev.actorKind).toBe("import");
  });
  it("is ignored when authenticated with the URL token", async () => {
    const raw = JSON.stringify({ id: "hist-2", submissions: { email_b935: "tok@example.com" }, createdDate: "2025-01-01T00:00:00Z" });
    const res = await POST(new NextRequest(`http://localhost/api/intake/wix?backfill=1&token=${SECRET}`, { method: "POST", body: raw }));
    const json = await res.json();
    const [lead] = await withCtx(env.sys, (tx) => tx.select().from(leads).where(eq(leads.id, json.leadId)));
    expect(lead.createdAt.getFullYear()).toBeGreaterThan(2025);
  });
});
