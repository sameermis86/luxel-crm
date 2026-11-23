import { describe, it, expect } from "vitest";
import { formSubmissionToPayload, quoteLeadToPayload, shouldImport, isLeadForm, submissionEventDate } from "@/lib/wix-sources";
import { mapWixPayload } from "@/lib/wix-mapping";

const NOW = new Date("2026-11-23T17:00:00Z");

describe("import rule", () => {
  it("skips past events, keeps today and later", () => {
    expect(shouldImport("2026-11-22", null, "2026-11-23", NOW)).toBe(false);
    expect(shouldImport("2026-11-23", null, "2026-11-23", NOW)).toBe(true);
    expect(shouldImport("2027-06-12", null, "2026-11-23", NOW)).toBe(true);
  });
  it("no event date: only recent submissions", () => {
    expect(shouldImport(null, "2026-10-01T00:00:00Z", "2026-11-23", NOW)).toBe(true);
    expect(shouldImport(null, "2026-03-01T00:00:00Z", "2026-11-23", NOW)).toBe(false);
  });
  it("lead forms", () => {
    expect(isLeadForm("Event Contact Form")).toBe(true);
    expect(isLeadForm("Job Application")).toBe(false);
    expect(isLeadForm("Subscriptions")).toBe(false);
  });
});

describe("form submissions", () => {
  it("Event Contact Form: defaults to wedding, tier from the budget label, opaque keys use labels", () => {
    const s = {
      id: "s1",
      formId: "f",
      createdDate: "2026-11-20T15:00:00Z",
      submissions: { first_name_70be: "Priya Patel", email_b935: "p@example.com", event_date: "2027-05-22", budget_1: "$7500-$15000(Elegant)", dropdown_90ef: "Instagram" },
    };
    expect(submissionEventDate(s)).toBe("2027-05-22");
    const p = formSubmissionToPayload(s, "Event Contact Form", { dropdown_90ef: "How did you hear about us?" });
    const m = mapWixPayload(p);
    expect(m.input).toMatchObject({ firstName: "Priya", lastName: "Patel", eventType: "wedding", tierInterest: "elegant", budgetMin: 7500, budgetMax: 15000, sourceDetail: "Instagram" });
    expect(m.submissionId).toBe("s1");
    expect(m.submittedAt?.toISOString()).toBe("2026-11-20T15:00:00.000Z");
  });
  it("explicit words beat the default", () => {
    const p = formSubmissionToPayload({ id: "s2", formId: "f", createdDate: "x", submissions: { colors_or_theme: "Blue for my son's baptism" } }, "Event Contact Form");
    expect(mapWixPayload(p).input.eventType).toBe("social");
  });
  it("an occasion question is used when present", () => {
    const p = formSubmissionToPayload({ id: "s3", formId: "f", createdDate: "x", submissions: { multi_choice_d611: "Corporate Events" } }, "Event Contact Form", { multi_choice_d611: "What's the occasion?" });
    expect(mapWixPayload(p).input.eventType).toBe("corporate");
  });
});

describe("Quote Builder (QuoteLeads)", () => {
  it("maps a full submission", () => {
    const p = quoteLeadToPayload({
      _id: "abc",
      _createdDate: { $date: "2026-11-10T20:00:00Z" },
      submittedAt: "2026-11-10T19:59:00Z",
      name: "Sofia Rossi & Marco Bianchi",
      email: "sofia@example.com",
      phone: "+19055550123",
      eventType: "Weddings",
      eventDate: "2027-06-12",
      venue: "Paradise Banquet Hall",
      guests: "180",
      tier: "Elegant",
      estimateLow: 8000,
      estimateHigh: 10000,
      vision: "Ivory and sage",
      itemsList: "Centerpieces, Ceremony arch",
      status: "full_submission",
    });
    const m = mapWixPayload(p);
    expect(m.form).toBe("quote_builder");
    expect(m.submissionId).toBe("ql_abc");
    expect(m.submittedAt?.toISOString()).toBe("2026-11-10T19:59:00.000Z");
    expect(m.input).toMatchObject({
      fullName: "Sofia Rossi & Marco Bianchi", email: "sofia@example.com", eventType: "wedding",
      eventDate: "2027-06-12", venueName: "Paradise Banquet Hall", guestCount: 180, tierInterest: "elegant", estimateTotal: 9000,
    });
    expect(m.input.servicesRequested).toEqual(expect.arrayContaining(["centerpieces", "ceremony"]));
    expect(m.input.message).toContain("Quote Builder estimate: $8,000–$10,000");
  });
  it("flags partial (gate-only) submissions", () => {
    const m = mapWixPayload(quoteLeadToPayload({ _id: "g1", name: "Ana", email: "ana@example.com", eventDate: "2027-01-01", eventType: "Social Events", status: "gate_captured" }));
    expect(m.input.eventType).toBe("social");
    expect(m.input.message).toMatch(/partial estimate/);
  });
});
