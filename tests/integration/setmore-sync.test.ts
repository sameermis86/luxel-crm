import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { withCtx, closeDb } from "@/db/client";
import { appointments, leads } from "@/db/schema";
import { createLead } from "@/server/leads/service";
import { runSetmoreSync, getSetmoreState, setmoreRestClient, planConsultStatuses, applyConsultStatuses, applyBookings, type SetmoreClient } from "@/server/integrations/setmore";
import { leadEvents, followUps } from "@/db/schema";
import { and, isNull } from "drizzle-orm";
import { listLeads } from "@/server/leads/queries";
import { getSettings } from "@/server/settings";
import { leadsHref, parseLeadFilter, parseListParams } from "@/lib/lead-filters";
import { freshOrg } from "../helpers";

let env: Awaited<ReturnType<typeof freshOrg>>;
const NOW = new Date("2026-11-24T15:00:00Z");
let rossi: string;
let customerCalls = 0;

const client: SetmoreClient = {
  staff: async () => [{ id: "p1", first_name: "Mansi" }],
  services: async () => [{ id: "s1", name: "Wedding consultation" }],
  bookings: async (_staff, startAt, endAt) =>
    [
      { id: "b-up", type: "APPOINTMENT", consumer_ids: ["c1"], service_id: "s1", provider_id: "p1", start_at: "2026-12-01T15:00:00Z", status: "CONFIRMED" },
      { id: "b-past", type: "APPOINTMENT", consumer_ids: ["c2"], service_id: "s1", provider_id: "p1", start_at: "2026-11-20T15:00:00Z", status: "CONFIRMED" },
      { id: "b-cxl", type: "APPOINTMENT", consumer_ids: ["c1"], service_id: "s1", provider_id: "p1", start_at: "2026-12-05T15:00:00Z", status: "CANCELLED" },
      { id: "b-evt", type: "EVENT", provider_id: "p1", start_at: "2026-12-02T15:00:00Z" },
    ].filter((b) => b.start_at >= startAt && b.start_at < endAt),
  customer: async (id) => {
    customerCalls++;
    return id === "c1"
      ? { id, first_name: "Sofia", last_name: "Rossi", email_addresses: [{ value: "sofia@example.com", primary: true }] }
      : { id, first_name: "New", last_name: "Person", phone_numbers: [{ value: "416-555-0111" }] };
  },
};

beforeAll(async () => {
  env = await freshOrg();
  rossi = (await withCtx(env.sys, (tx) => createLead(tx, env.sys, { firstName: "Sofia", lastName: "Rossi", email: "sofia@example.com", eventType: "wedding" }))).id;
});
afterAll(closeDb);

describe("Setmore sync", () => {
  it("stores appointments, links them to leads by email/phone, and leaves lead statuses alone", async () => {
    const s = await runSetmoreSync(env.orgId, client, { now: NOW });
    expect(s).toMatchObject({ fetched: 3, upcoming: 1, matched: 2, unmatched: 1, lastError: null });
    const rows = await withCtx(env.sys, (tx) => tx.select().from(appointments).orderBy(appointments.startsAt));
    expect(rows.map((r) => [r.externalId, r.status, r.leadId === rossi])).toEqual([
      ["b-past", "confirmed", false],
      ["b-up", "confirmed", true],
      ["b-cxl", "cancelled", true],
    ]);
    expect(rows[0].serviceName).toBe("Wedding consultation");
    const [l] = await withCtx(env.sys, (tx) => tx.select().from(leads).where(eq(leads.id, rossi)));
    expect(l.status).toBe("new");
    expect((await getSetmoreState(env.orgId)).fetched).toBe(3);
  });

  it("is idempotent and reuses stored customers instead of fetching them again", async () => {
    const before = customerCalls;
    await runSetmoreSync(env.orgId, client, { now: NOW });
    expect(customerCalls).toBe(before);
    const rows = await withCtx(env.sys, (tx) => tx.select().from(appointments));
    expect(rows.length).toBe(3);
  });

  it("the leads list shows the next consultation, and the 'consultation booked' filter finds it", async () => {
    const settings = await withCtx(env.sys, (tx) => getSettings(tx, env.orgId));
    const wc = { now: NOW, userId: null, settings };
    const href = leadsHref({ consult: "upcoming" });
    const sp = new URLSearchParams(href.split("?")[1]);
    const { rows, total } = await withCtx(env.sys, (tx) => listLeads(tx, parseLeadFilter(sp), wc, parseListParams(sp)));
    expect(total).toBe(1);
    expect(rows[0].id).toBe(rossi);
    expect(rows[0].nextConsultAt).toBeTruthy();
  });

  it("previews forward-only moves from bookings, and applies them through updateLead", async () => {
    // link the past booking to a second lead that is already further along: it must be left alone
    const ahead = (await withCtx(env.sys, (tx) => createLead(tx, env.sys, { firstName: "Ahead", lastName: "Lead", email: "ahead@example.com", status: "proposal_sent" }))).id;
    await withCtx(env.sys, (tx) => tx.update(appointments).set({ leadId: ahead }).where(eq(appointments.externalId, "b-past")));
    const plan = await withCtx(env.sys, (tx) => planConsultStatuses(tx, NOW));
    expect(plan.map((c) => [c.leadId === rossi, c.from, c.to])).toEqual([[true, "new", "consult_scheduled"]]);

    const r = await applyConsultStatuses(env.sys, NOW);
    expect(r).toMatchObject({ planned: 1, applied: 1, errors: [] });
    const [l] = await withCtx(env.sys, (tx) => tx.select().from(leads).where(eq(leads.id, rossi)));
    expect(l.status).toBe("consult_scheduled");
    const evs = await withCtx(env.sys, (tx) => tx.select().from(leadEvents).where(eq(leadEvents.leadId, rossi)));
    expect(evs.some((e) => e.field === "status" && (e.payload as { via?: string })?.via === "setmore")).toBe(true);
    expect(await withCtx(env.sys, (tx) => planConsultStatuses(tx, NOW))).toEqual([]); // nothing left to do
  });

  it("links bookings by unique name, creates leads for new people by booking type, and moves stale follow-ups to the meeting", async () => {
    const appt = (externalId: string, customerName: string, email: string, serviceName: string, startsAt: string, status = "confirmed") => ({
      orgId: env.orgId, source: "setmore", externalId, customerName, email, emailNormalized: email, serviceName, startsAt: new Date(startsAt), status,
    });
    await withCtx(env.sys, (tx) =>
      tx.insert(appointments).values([
        appt("n1", "Sofia Rossi", "sofia.other@example.com", "Quote Review Call", "2026-12-03T15:00:00Z"), // same person, other email
        appt("n2", "Grace Kim", "grace@example.com", "Review Meeting at the Luxel Studio - Existing Booking", "2026-11-18T15:00:00Z"),
        appt("n3", "Grace Kim", "grace@example.com", "In-Person Consultation - New Booking", "2026-12-04T15:00:00Z"),
        appt("n4", "Leo Park", "leo@example.com", "Phone Consultation - New Booking", "2026-11-19T15:00:00Z"),
        appt("n5", "Cancelled Only", "cx@example.com", "Phone Consultation - New Booking", "2026-11-21T15:00:00Z", "cancelled"),
      ]),
    );
    const r = await applyBookings(env.sys, NOW);
    expect(r).toMatchObject({ linkedByName: 1, created: 2, errors: [] });

    const rows = await withCtx(env.sys, (tx) => tx.select().from(appointments));
    const by = (id: string) => rows.find((x) => x.externalId === id)!;
    expect(by("n1").leadId).toBe(rossi);
    expect(by("n2").leadId).toBeTruthy();
    expect(by("n3").leadId).toBe(by("n2").leadId); // one lead per person
    expect(by("n5").leadId).toBeNull();
    const all = await withCtx(env.sys, (tx) => tx.select().from(leads));
    const grace = all.find((l) => l.id === by("n2").leadId)!;
    const leo = all.find((l) => l.id === by("n4").leadId)!;
    expect(grace.status).toBe("won");
    expect(grace.createdAt.toISOString()).toBe("2026-11-18T15:00:00.000Z"); // dated at the first booking
    expect(leo.status).toBe("consult_held");
    expect(all.some((l) => l.email === "cx@example.com")).toBe(false);

    // Rossi has a meeting ahead and no follow-up: the meeting becomes the next follow-up
    const fus = await withCtx(env.sys, (tx) => tx.select().from(followUps).where(and(eq(followUps.leadId, rossi), isNull(followUps.doneAt))));
    expect(fus.map((f) => f.dueAt.toISOString())).toEqual(["2026-12-01T15:00:00.000Z"]);

    // idempotent
    expect(await applyBookings(env.sys, NOW)).toMatchObject({ linkedByName: 0, created: 0, statusesApplied: 0, followUpsMoved: 0 });
  });

  it("records a failure (e.g. bad token) without throwing away the last good numbers", async () => {
    const bad = setmoreRestClient("nope", (async () => new Response("{}", { status: 401 })) as unknown as typeof fetch);
    await expect(runSetmoreSync(env.orgId, bad, { now: NOW })).rejects.toThrow(/token exchange failed \(401\)/);
    const st = await getSetmoreState(env.orgId);
    expect(st.lastError).toMatch(/401/);
    expect(st.fetched).toBe(3);
  });
});
