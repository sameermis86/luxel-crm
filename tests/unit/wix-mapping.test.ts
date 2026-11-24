import { describe, it, expect } from "vitest";
import { mapWixPayload, mapEventType, mapServices } from "@/lib/wix-mapping";

describe("mapWixPayload", () => {
  it("canonical Quote Builder payload (Velo snippet)", () => {
    const m = mapWixPayload({
      form: "quote_builder",
      submission_id: "qb_123",
      submitted_at: "2026-11-23T15:00:00Z",
      first_name: "Sofia",
      last_name: "Rossi",
      partner_name: "Marco Bianchi",
      email: "sofia@example.com",
      phone: "905-555-0123",
      event_type: "Wedding",
      event_date: "2027-06-12",
      venue_name: "Paradise Banquet Hall",
      venue_city: "Vaughan",
      guest_count: "180",
      tier: "Elegant",
      estimate_total: 8450,
      services: ["Centerpieces", "Ceremony arch"],
      message: "Blush and ivory",
      utm_source: "google",
      utm_medium: "cpc",
      utm_campaign: "spring-bridal-2027",
      landing_page: "https://www.luxeldecor.com/estimate",
      referrer: "https://www.google.com/",
    });
    expect(m.form).toBe("quote_builder");
    expect(m.submissionId).toBe("qb_123");
    expect(m.submittedAt?.toISOString()).toBe("2026-11-23T15:00:00.000Z");
    expect(m.input).toMatchObject({
      firstName: "Sofia", lastName: "Rossi", partnerName: "Marco Bianchi", email: "sofia@example.com", phone: "905-555-0123",
      eventType: "wedding", eventDate: "2027-06-12", venueName: "Paradise Banquet Hall", venueCity: "Vaughan", guestCount: 180,
      tierInterest: "elegant", estimateTotal: 8450, utmSource: "google", utmMedium: "cpc",
      landingPage: "https://www.luxeldecor.com/estimate", referrerUrl: "https://www.google.com/",
    });
    expect(m.input.servicesRequested).toEqual(expect.arrayContaining(["centerpieces", "ceremony"]));
  });

  it("Wix Forms submission from the REST API (Luxel 'Event Contact Form' targets)", () => {
    const m = mapWixPayload({
      id: "6f1c0d7e-0000-4000-8000-000000000001",
      formId: "0915908c-cd04-43b4-a532-a1a3a8819af0",
      namespace: "wix.form_app.form",
      createdDate: "2026-09-02T18:21:00Z",
      submissions: {
        first_name_70be: "Priya Patel",
        email_b935: "priya@example.com",
        phone_a204: "(416) 555-0199",
        event_date: "2027-05-22",
        colors_or_theme: "Dusty rose, gold",
        event_venue_1: "Chateau Le Parc",
        budget_1: "$7500-$15000",
        service_type: "Event Design, Decor and Florals",
      },
    }, { defaultForm: "contact_us" });
    expect(m.form).toBe("contact_us");
    expect(m.submissionId).toBe("6f1c0d7e-0000-4000-8000-000000000001");
    expect(m.submittedAt?.toISOString()).toBe("2026-09-02T18:21:00.000Z");
    expect(m.input).toMatchObject({
      firstName: "Priya", lastName: "Patel", email: "priya@example.com", phone: "(416) 555-0199", eventDate: "2027-05-22",
      venueName: "Chateau Le Parc", budgetMin: 7500, budgetMax: 15000,
    });
    expect(m.input.servicesRequested).toEqual(expect.arrayContaining(["florals", "centerpieces"]));
    expect(m.input.message).toContain("Dusty rose");
  });

  it("Wix Forms 'Contact' form targets", () => {
    const m = mapWixPayload({
      id: "sub-2", formId: "47b92fa2-8332-464b-b91f-a4173019c848",
      submissions: { first_name_b06c: "Emma", last_name_6124: "Kim", email_6645: "emma@ex.com", phone_f8b4: "6475550100", leave_us_a_message: "Prom decor?", event_venue: "Liberty Grand", event_date_1: "2027-06-01" },
    });
    expect(m.input).toMatchObject({ firstName: "Emma", lastName: "Kim", email: "emma@ex.com", message: "Prom decor?", venueName: "Liberty Grand", eventDate: "2027-06-01" });
  });

  it("Automation body nested under data, with labels as keys and no submission id", () => {
    const body = { data: { "Full Name": "Chloe Nguyen", Email: "chloe@ex.com", "Event Date": "06/20/2027", "What's the occasion?": "Corporate Events", "Expected number of guests": "250", "Approximate Budget for Decor and/or Florals": "$10000-$20000" } };
    const a = mapWixPayload(body);
    const b = mapWixPayload(body);
    expect(a.input).toMatchObject({ fullName: "Chloe Nguyen", email: "chloe@ex.com", eventDate: "2027-06-20", eventType: "corporate", guestCount: 250, budgetMin: 10000, budgetMax: 20000 });
    expect(a.submissionId).toMatch(/^fp_/);
    expect(a.submissionId).toBe(b.submissionId); // retries are idempotent
  });

  it("keeps fields it can't place", () => {
    const m = mapWixPayload({ form: "contact_us", email: "a@b.com", delivery_method: "Pickup" });
    expect(m.unmapped).toEqual({ delivery_method: "Pickup" });
  });

  it("never treats secrets as data", () => {
    const m = mapWixPayload({ form: "contact_us", email: "a@b.com", token: "s3cret" });
    expect(JSON.stringify(m)).not.toContain("s3cret");
  });
});

describe("helpers", () => {
  it("event type", () => {
    expect(mapEventType("Wedding")).toBe("wedding");
    expect(mapEventType("Corporate Events")).toBe("corporate");
    expect(mapEventType("Social Events")).toBe("social");
    expect(mapEventType("Prom")).toBe("corporate");
    expect(mapEventType("Rentals")).toBe("rental_only");
  });
  it("services", () => {
    expect(mapServices("Event Rentals")).toEqual(["rentals"]);
    expect(mapServices("Florals, Decor")).toEqual(["florals"]);
  });
});
