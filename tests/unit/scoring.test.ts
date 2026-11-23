import { describe, it, expect } from "vitest";
import { scoreLead, scoreBand } from "@/lib/scoring";
import { DEFAULT_SETTINGS } from "@/lib/config/defaults";

const NOW = new Date("2026-11-23T15:00:00Z");
const cfg = DEFAULT_SETTINGS.scoring;
const base: Parameters<typeof scoreLead>[0] = {
  eventType: "wedding" as const,
  eventDate: "2027-08-14", // ~8.7 months out
  budgetMin: null, budgetMax: 12000, estimateTotal: null,
  source: "referral" as const, captureChannel: null,
  email: "a@b.com", phoneE164: "+14165550100",
};
const noActivity = { repliedToFirstContact: false, consultBookedOrHeld: false };

describe("scoreLead", () => {
  it("scores a perfect lead at 90 without engagement and 100 with it", () => {
    expect(scoreLead(base, noActivity, cfg, NOW).score).toBe(90);
    expect(scoreLead(base, { repliedToFirstContact: true, consultBookedOrHeld: true }, cfg, NOW).score).toBe(100);
  });

  it("event fit", () => {
    const pts = (eventType: any) => scoreLead({ ...base, eventType }, noActivity, cfg, NOW).breakdown.eventFit.points;
    expect([pts("wedding"), pts("corporate"), pts("social"), pts("rental_only"), pts("other")]).toEqual([25, 20, 15, 8, 5]);
  });

  it("budget bands use budget_max, then budget_min, then quote builder estimate", () => {
    const pts = (b: Partial<typeof base>) => scoreLead({ ...base, ...b }, noActivity, cfg, NOW).breakdown.budget.points;
    expect(pts({ budgetMax: 10000 })).toBe(25);
    expect(pts({ budgetMax: 9999 })).toBe(20);
    expect(pts({ budgetMax: 6000 })).toBe(20);
    expect(pts({ budgetMax: 5999 })).toBe(14);
    expect(pts({ budgetMax: 3500 })).toBe(14);
    expect(pts({ budgetMax: 3499 })).toBe(7);
    expect(pts({ budgetMax: 2000 })).toBe(7);
    expect(pts({ budgetMax: 1999 })).toBe(0);
    expect(pts({ budgetMax: null, budgetMin: 7000 })).toBe(20);
    expect(pts({ budgetMax: null, budgetMin: null, estimateTotal: 4200 })).toBe(14);
    expect(pts({ budgetMax: null, budgetMin: null, estimateTotal: null })).toBe(8);
  });

  it("budget label is human readable", () => {
    expect(scoreLead({ ...base, budgetMax: 7500 }, noActivity, cfg, NOW).breakdown.budget.label).toBe("$7,500");
  });

  it("timing bands", () => {
    const pts = (eventDate: string | null) => scoreLead({ ...base, eventDate }, noActivity, cfg, NOW).breakdown.timing.points;
    expect(pts("2027-08-14")).toBe(15); // ~9 months
    expect(pts("2027-03-30")).toBe(15); // ~4.2 months
    expect(pts("2027-02-15")).toBe(10); // ~2.8 months
    expect(pts("2028-03-01")).toBe(8); // ~15 months
    expect(pts("2026-12-20")).toBe(4); // < 2 months
    expect(pts(null)).toBe(5);
    expect(pts("2026-10-01")).toBe(0); // past
  });

  it("source intent takes the stronger of origin and capture channel", () => {
    const pts = (source: any, captureChannel: any = null) =>
      scoreLead({ ...base, source, captureChannel }, noActivity, cfg, NOW).breakdown.sourceIntent.points;
    expect(pts("referral")).toBe(15);
    expect(pts("venue_partner")).toBe(15);
    expect(pts("quote_builder")).toBe(12);
    expect(pts("phone")).toBe(10);
    expect(pts("google_ads")).toBe(9);
    expect(pts("google_business_profile")).toBe(9);
    expect(pts("contact_us_form")).toBe(8);
    expect(pts("wedding_show")).toBe(8);
    expect(pts("instagram")).toBe(6);
    expect(pts("facebook")).toBe(6);
    expect(pts("other")).toBe(5);
    expect(pts("google_ads", "quote_builder")).toBe(12);
  });

  it("contactability", () => {
    const pts = (email: string | null, phoneE164: string | null) =>
      scoreLead({ ...base, email, phoneE164 }, noActivity, cfg, NOW).breakdown.contactability.points;
    expect(pts("a@b.com", "+14165550100")).toBe(10);
    expect(pts("a@b.com", null)).toBe(5);
    expect(pts("garbage", "+14165550100")).toBe(5);
    expect(pts(null, null)).toBe(0);
  });

  it("engagement", () => {
    const pts = (a: any) => scoreLead(base, a, cfg, NOW).breakdown.engagement.points;
    expect(pts({ repliedToFirstContact: true, consultBookedOrHeld: false })).toBe(5);
    expect(pts({ repliedToFirstContact: false, consultBookedOrHeld: true })).toBe(5);
  });

  it("never exceeds 100 or goes below 0 and respects custom weights", () => {
    const tuned = { ...cfg, eventFit: { ...cfg.eventFit, wedding: 40 }, max: { ...cfg.max, eventFit: 40 } };
    const r = scoreLead(base, { repliedToFirstContact: true, consultBookedOrHeld: true }, tuned, NOW);
    expect(r.score).toBe(100);
  });

  it("only looks at fit/budget/timing/intent/contactability/engagement (no personal attributes)", () => {
    const a = scoreLead({ ...base, firstName: "Sofia", lastName: "Rossi" } as any, noActivity, cfg, NOW);
    const b = scoreLead({ ...base, firstName: "Priya", lastName: "Patel" } as any, noActivity, cfg, NOW);
    expect(a).toEqual(b);
    expect(Object.keys(a.breakdown).sort()).toEqual(
      ["budget", "contactability", "engagement", "eventFit", "sourceIntent", "timing"].sort(),
    );
  });
});

describe("scoreBand", () => {
  it("bands", () => {
    expect(scoreBand(70, cfg)).toBe("hot");
    expect(scoreBand(69, cfg)).toBe("warm");
    expect(scoreBand(45, cfg)).toBe("warm");
    expect(scoreBand(44, cfg)).toBe("cold");
  });
});
