import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { withCtx, closeDb } from "@/db/client";
import { appointments, leads } from "@/db/schema";
import { createLead } from "@/server/leads/service";
import { runSetmoreSync, getSetmoreState, setmoreRestClient, planConsultStatuses, applyConsultStatuses, applyBookings, undoBookingWins, markPlanner, type SetmoreClient } from "@/server/integrations/setmore";
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
    expect(grace.status).toBe("proposal_sent"); // existing booking: never Won from a booking
    expect(grace.createdAt.toISOString()).toBe("2026-11-18T15:00:00.000Z"); // dated at the first booking
    expect(leo.status).toBe("consult_held");
    expect(all.some((l) => l.email === "cx@example.com")).toBe(false);

    // Rossi has a meeting ahead and no follow-up: the meeting becomes the next follow-up
    const fus = await withCtx(env.sys, (tx) => tx.select().from(followUps).where(and(eq(followUps.leadId, rossi), isNull(followUps.doneAt))));
    expect(fus.map((f) => f.dueAt.toISOString())).toEqual(["2026-12-01T15:00:00.000Z"]);

    // idempotent
    expect(await applyBookings(env.sys, NOW)).toMatchObject({ linkedByName: 0, created: 0, statusesApplied: 0, followUpsMoved: 0 });
  });

  it("undoes wins the booking sync made, through updateLead; owners only by hand", async () => {
    const won = (await withCtx(env.sys, (tx) => createLead(tx, env.sys, { firstName: "Was", lastName: "Won", email: "waswon@example.com", status: "won", sourceDetail: "Setmore booking" }))).id;
    const keep = (await withCtx(env.sys, (tx) => createLead(tx, env.sys, { firstName: "Signed", lastName: "Gs", email: "gs@example.com", status: "won", sourceDetail: "Setmore booking" }))).id;
    const { updateLead } = await import("@/server/leads/service");
    await withCtx(env.sys, (tx) => updateLead(tx, env.sys, keep, { goodshuffleStatus: "signed" }));
    await withCtx(env.sys, (tx) =>
      tx.insert(appointments).values({ orgId: env.orgId, source: "setmore", externalId: "w1", leadId: won, customerName: "Was Won", serviceName: "Review Meeting - Existing Booking", startsAt: new Date("2026-11-10T15:00:00Z"), status: "confirmed" }),
    );
    const r = await undoBookingWins(env.sys, NOW);
    expect(r.moved.map((m) => m.to)).toEqual(["proposal_sent"]);
    const after = await withCtx(env.sys, (tx) => tx.select().from(leads));
    expect(after.find((l) => l.id === won)!.status).toBe("proposal_sent");
    expect(after.find((l) => l.id === won)!.wonAt).toBeNull();
    expect(after.find((l) => l.id === keep)!.status).toBe("won");
    expect((await undoBookingWins(env.sys, NOW)).moved).toEqual([]); // idempotent

    // by hand: an owner can undo a win, a non-owner can't
    const staffLike = { ...env.as(env.mansi), role: "staff" as const };
    await expect(withCtx(staffLike, (tx) => updateLead(tx, staffLike, keep, { status: "proposal_sent" }))).rejects.toThrow(/Only an owner/);
    const owner = { ...env.as(env.sameer), role: "owner" as const };
    await withCtx(owner, (tx) => updateLead(tx, owner, keep, { status: "proposal_sent" }));
  });

  it("planners: their bookings make no lead and no follow-up; marking one archives the lead and closes its follow-ups", async () => {
    await withCtx(env.sys, (tx) =>
      tx.insert(appointments).values([
        { orgId: env.orgId, source: "setmore", externalId: "p1", customerName: "Kate Planner", email: "kate@plannerco.ca", emailNormalized: "kate@plannerco.ca", serviceName: "Phone Consultation - New Booking", startsAt: new Date("2026-11-22T15:00:00Z"), status: "confirmed" },
        { orgId: env.orgId, source: "setmore", externalId: "p2", customerName: "Tom Planner", email: "tom@plannerco.ca", emailNormalized: "tom@plannerco.ca", serviceName: "Phone Consultation - New Booking", startsAt: new Date("2026-12-08T15:00:00Z"), status: "confirmed" },
      ]),
    );
    // the sync already made a lead for Kate before anyone marked her
    await applyBookings(env.sys, NOW);
    const kate = (await withCtx(env.sys, (tx) => tx.select().from(leads).where(eq(leads.emailNormalized, "kate@plannerco.ca"))))[0];
    expect(kate.status).toBe("consult_held");
    await withCtx(env.sys, async (tx) => {
      const { setFollowUp } = await import("@/server/leads/service");
      await setFollowUp(tx, env.sys, kate.id, { dueAt: new Date("2026-11-23T15:00:00Z") }, NOW);
    });

    // marking the company archives every lead the sync made for it (Kate and Tom) and closes follow-ups
    const owner = { ...env.as(env.sameer), role: "owner" as const };
    const r = await markPlanner(owner, { email: "kate@plannerco.ca", scope: "domain", leadId: kate.id }, NOW);
    expect(r).toEqual({ entry: "@plannerco.ca", archived: 2 });
    const after = await withCtx(env.sys, (tx) => tx.select().from(leads).where(eq(leads.sourceDetail, "Setmore booking")));
    expect(after.filter((l) => l.email?.endsWith("@plannerco.ca")).every((l) => l.archivedAt)).toBe(true);
    const open = await withCtx(env.sys, (tx) => tx.select().from(followUps).where(and(eq(followUps.leadId, kate.id), isNull(followUps.doneAt))));
    expect(open).toEqual([]);
    const settings = await withCtx(env.sys, (tx) => getSettings(tx, env.orgId));
    expect(settings.setmore.excludeContacts).toEqual(["@plannerco.ca"]);
    expect(settings.followUps.digestHour).toBe(8); // the rest of the settings untouched

    // a new booking from that company makes nothing
    await withCtx(env.sys, (tx) =>
      tx.insert(appointments).values({ orgId: env.orgId, source: "setmore", externalId: "p3", customerName: "Ana Planner", email: "ana@plannerco.ca", emailNormalized: "ana@plannerco.ca", serviceName: "Phone Consultation - New Booking", startsAt: new Date("2026-12-09T15:00:00Z"), status: "confirmed" }),
    );
    expect(await applyBookings(env.sys, NOW)).toMatchObject({ created: 0, linkedByName: 0, followUpsMoved: 0 });
    expect((await withCtx(env.sys, (tx) => tx.select().from(appointments).where(eq(appointments.externalId, "p3"))))[0].leadId).toBeNull();
    // public email domains can't be marked as a company
    await expect(markPlanner(owner, { email: "someone@gmail.com", scope: "domain" }, NOW)).rejects.toThrow(/public email provider/);
  });

  it("records a failure (e.g. bad token) without throwing away the last good numbers", async () => {
    const bad = setmoreRestClient("nope", (async () => new Response("{}", { status: 401 })) as unknown as typeof fetch);
    await expect(runSetmoreSync(env.orgId, bad, { now: NOW })).rejects.toThrow(/token exchange failed \(401\)/);
    const st = await getSetmoreState(env.orgId);
    expect(st.lastError).toMatch(/401/);
    expect(st.fetched).toBe(3);
  });
});
