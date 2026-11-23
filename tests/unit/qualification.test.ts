import { describe, it, expect } from "vitest";
import { qualify } from "@/lib/qualification";
import { DEFAULT_SETTINGS } from "@/lib/config/defaults";

const NOW = new Date("2026-11-23T15:00:00Z");
const cfg = DEFAULT_SETTINGS.qualification;
const good = {
  eventDate: "2027-08-14", budgetMin: null, budgetMax: 8000, estimateTotal: null,
  venueCity: "Woodbridge, ON", email: "a@b.com", phoneE164: null,
};

describe("qualify", () => {
  it("qualified when no hard rule fails, score >= 50 and event date known", () => {
    expect(qualify(good, 72, cfg, NOW)).toEqual({ qualification: "qualified", reasons: [] });
  });
  it("needs info below the score threshold", () => {
    const r = qualify(good, 49, cfg, NOW);
    expect(r.qualification).toBe("needs_info");
    expect(r.reasons).toContain("Score 49 is below 50");
  });
  it("needs info with no event date", () => {
    const r = qualify({ ...good, eventDate: null }, 80, cfg, NOW);
    expect(r.qualification).toBe("needs_info");
    expect(r.reasons).toContain("No event date");
  });
  it("mentions missing budget as info", () => {
    const r = qualify({ ...good, budgetMax: null }, 40, cfg, NOW);
    expect(r.reasons).toContain("No budget");
  });
  it("unqualified: past event", () => {
    const r = qualify({ ...good, eventDate: "2026-11-01" }, 80, cfg, NOW);
    expect(r).toEqual({ qualification: "unqualified", reasons: ["Event date is in the past"] });
  });
  it("unqualified: fewer than 14 days out (boundary)", () => {
    expect(qualify({ ...good, eventDate: "2026-12-06" }, 80, cfg, NOW).qualification).toBe("unqualified"); // 13 days
    expect(qualify({ ...good, eventDate: "2026-12-07" }, 80, cfg, NOW).qualification).toBe("qualified"); // 14 days
  });
  it("unqualified: known budget below $2,000", () => {
    const r = qualify({ ...good, budgetMax: 1500 }, 80, cfg, NOW);
    expect(r.qualification).toBe("unqualified");
    expect(r.reasons[0]).toMatch(/below \$2,000/);
    expect(qualify({ ...good, budgetMax: 2000 }, 80, cfg, NOW).qualification).toBe("qualified");
  });
  it("unqualified: outside service area", () => {
    const r = qualify({ ...good, venueCity: "Ottawa" }, 80, cfg, NOW);
    expect(r.qualification).toBe("unqualified");
    expect(r.reasons[0]).toMatch(/Ottawa.*outside the service area/);
  });
  it("service area matching is forgiving", () => {
    for (const city of ["toronto", "Vaughan, Ontario", "St Catharines", "Niagara on the Lake", "Richmond Hill ON"]) {
      expect(qualify({ ...good, venueCity: city }, 80, cfg, NOW).qualification).toBe("qualified");
    }
  });
  it("unqualified: no valid email and no valid phone", () => {
    const r = qualify({ ...good, email: "nope", phoneE164: null }, 80, cfg, NOW);
    expect(r.qualification).toBe("unqualified");
    expect(r.reasons).toContain("No valid email or phone");
  });
  it("collects every failing hard rule", () => {
    const r = qualify({ ...good, eventDate: "2026-01-01", budgetMax: 500, email: null }, 10, cfg, NOW);
    expect(r.reasons.length).toBe(3);
  });
});
