import { describe, it, expect } from "vitest";
import { bookingToRow, matchLead, pickValue, plannedConsultStatus, statusForNewLead, matchLeadByName } from "@/lib/setmore";

const cust = { id: "c1", first_name: "Sofia", last_name: "Rossi", email_addresses: [{ value: "old@x.com", deleted: true }, { value: "Sofia.Rossi@Gmail.com", primary: true }], phone_numbers: [{ value: "905-555-0123" }] };

describe("setmore mapping", () => {
  it("picks the primary, non-deleted contact value", () => {
    expect(pickValue(cust.email_addresses)).toBe("Sofia.Rossi@Gmail.com");
    expect(pickValue([{ value: "a@x.com", deleted: true }])).toBeNull();
    expect(pickValue(undefined)).toBeNull();
  });
  it("maps an appointment with customer, service and staff names", () => {
    const r = bookingToRow(
      { id: "b1", type: "APPOINTMENT", consumer_ids: ["c1"], service_id: "s1", provider_id: "p1", start_at: "2026-12-01T15:00:00Z", end_at: "2026-12-01T16:00:00Z", status: "CONFIRMED" },
      cust, { id: "s1", name: "Wedding consultation" }, { id: "p1", first_name: "Mansi" },
    )!;
    expect(r).toMatchObject({ externalId: "b1", customerName: "Sofia Rossi", emailNormalized: "sofiarossi@gmail.com", phoneE164: "+19055550123", serviceName: "Wedding consultation", staffName: "Mansi", status: "confirmed" });
    expect(r.startsAt.toISOString()).toBe("2026-12-01T15:00:00.000Z");
  });
  it("cancelled stays cancelled; class sessions and events are skipped", () => {
    expect(bookingToRow({ id: "b2", start_at: "2026-12-01T15:00:00Z", status: "CANCELLED" }, cust)!.status).toBe("cancelled");
    expect(bookingToRow({ id: "b3", type: "SESSION", start_at: "2026-12-01T15:00:00Z" }, cust)).toBeNull();
    expect(bookingToRow({ id: "b4", type: "EVENT", start_at: "2026-12-01T15:00:00Z" }, undefined)).toBeNull();
  });
  it("matches a lead by email first, then phone", () => {
    const leads = [{ id: "L1", emailNormalized: "sofiarossi@gmail.com", phoneE164: null }, { id: "L2", emailNormalized: null, phoneE164: "+19055550123" }];
    expect(matchLead({ emailNormalized: "sofiarossi@gmail.com", phoneE164: "+19055550123" }, leads)).toBe("L1");
    expect(matchLead({ emailNormalized: "x@y.com", phoneE164: "+19055550123" }, leads)).toBe("L2");
    expect(matchLead({ emailNormalized: null, phoneE164: null }, leads)).toBeNull();
  });
});

describe("plannedConsultStatus (forward only)", () => {
  const now = new Date("2026-11-24T15:00:00Z");
  const past = { startsAt: new Date("2026-11-20T15:00:00Z"), endsAt: new Date("2026-11-20T16:00:00Z"), status: "confirmed" };
  const ahead = { startsAt: new Date("2026-12-01T15:00:00Z"), endsAt: null, status: "confirmed" };
  const cxl = { ...past, status: "cancelled" };
  it("a booking ahead moves new/contacted/not reachable to Consult scheduled", () => {
    for (const s of ["new", "contacted", "not_reachable"] as const) expect(plannedConsultStatus(s, [ahead], now)?.to).toBe("consult_scheduled");
    expect(plannedConsultStatus("consult_scheduled", [ahead], now)).toBeNull();
  });
  it("a booking that has ended moves to Consult held, even with another one ahead", () => {
    expect(plannedConsultStatus("new", [past], now)?.to).toBe("consult_held");
    expect(plannedConsultStatus("consult_scheduled", [past, ahead], now)).toMatchObject({ to: "consult_held", startsAt: past.startsAt });
  });
  it("a meeting in progress isn't held yet", () => {
    const now2 = new Date("2026-11-20T15:30:00Z");
    expect(plannedConsultStatus("new", [past], now2)?.to).toBe("consult_scheduled");
  });
  it("never moves backwards, never touches decided leads, ignores cancelled bookings", () => {
    for (const s of ["consult_held", "proposal_sent", "won", "lost", "unqualified", "on_hold"] as const) expect(plannedConsultStatus(s, [past, ahead], now)).toBeNull();
    expect(plannedConsultStatus("new", [cxl], now)).toBeNull();
    expect(plannedConsultStatus("new", [], now)).toBeNull();
  });
});

describe("leads created from bookings", () => {
  const now = new Date("2026-11-24T15:00:00Z");
  const rules = { wonServices: ["existing booking"], proposalServices: ["quote review"] };
  const b = (serviceName: string, at: string, status = "confirmed") => ({ serviceName, startsAt: new Date(at), endsAt: null, status });
  it("takes the furthest stage the bookings show, by booking type", () => {
    expect(statusForNewLead([b("In-Person Consultation - New Booking", "2026-12-01T15:00:00Z")], now, rules)).toBe("consult_scheduled");
    expect(statusForNewLead([b("Phone Consultation", "2026-11-20T15:00:00Z")], now, rules)).toBe("consult_held");
    expect(statusForNewLead([b("Phone Consultation", "2026-11-20T15:00:00Z"), b("Quote Review Call", "2026-12-02T15:00:00Z")], now, rules)).toBe("proposal_sent");
    expect(statusForNewLead([b("Review Meeting at the Studio - Existing Booking", "2026-12-02T15:00:00Z")], now, rules)).toBe("won");
  });
  it("ignores cancelled bookings", () => {
    expect(statusForNewLead([b("Review Meeting - Existing Booking", "2026-11-20T15:00:00Z", "cancelled")], now, rules)).toBeNull();
  });
  it("matches by full name only when exactly one lead has it", () => {
    const leads = [{ id: "a", firstName: "Sofía", lastName: "Rossi" }, { id: "b", firstName: "Ana", lastName: "Silva" }, { id: "c", firstName: "Ana", lastName: "Silva" }];
    expect(matchLeadByName("sofia  rossi", leads)).toBe("a");
    expect(matchLeadByName("Ana Silva", leads)).toBeNull(); // ambiguous
    expect(matchLeadByName("Sofia", leads)).toBeNull(); // first name alone
    expect(matchLeadByName(null, leads)).toBeNull();
  });
});
