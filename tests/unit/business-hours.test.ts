import { describe, it, expect } from "vitest";
import { addBusinessHours, suggestNextFollowUp } from "@/lib/business-hours";
import { DEFAULT_SETTINGS } from "@/lib/config/defaults";

const bh = DEFAULT_SETTINGS.businessHours;
// Toronto is UTC-5 in late November (EST)
describe("addBusinessHours", () => {
  it("adds within the same day", () => {
    expect(addBusinessHours(new Date("2026-11-23T15:00:00Z"), 2, bh).toISOString()).toBe("2026-11-23T17:00:00.000Z"); // Mon 10:00 → 12:00
  });
  it("rolls over the end of day", () => {
    // Mon 16:00 Toronto + 2h → Tue 10:00
    expect(addBusinessHours(new Date("2026-11-23T21:00:00Z"), 2, bh).toISOString()).toBe("2026-11-24T15:00:00.000Z");
  });
  it("submissions after hours start the clock next morning", () => {
    // Mon 21:30 Toronto → Tue 11:00
    expect(addBusinessHours(new Date("2026-11-24T02:30:00Z"), 2, bh).toISOString()).toBe("2026-11-24T16:00:00.000Z");
  });
  it("skips weekends", () => {
    // Fri 16:30 Toronto + 2h → Mon 10:30
    expect(addBusinessHours(new Date("2026-11-27T21:30:00Z"), 2, bh).toISOString()).toBe("2026-11-30T15:30:00.000Z");
    // Sat noon → Mon 11:00
    expect(addBusinessHours(new Date("2026-11-28T17:00:00Z"), 2, bh).toISOString()).toBe("2026-11-30T16:00:00.000Z");
  });
  it("handles DST change (Mar 14 2027: EST→EDT)", () => {
    // Fri Mar 12 2027 16:00 EST + 2h → Mon Mar 15 10:00 EDT = 14:00Z
    expect(addBusinessHours(new Date("2027-03-12T21:00:00Z"), 2, bh).toISOString()).toBe("2027-03-15T14:00:00.000Z");
  });
});

describe("suggestNextFollowUp", () => {
  const f = DEFAULT_SETTINGS.followUps;
  const now = new Date("2026-11-23T15:00:00Z");
  it("2 days after contacted", () =>
    expect(suggestNextFollowUp("contacted", now, f).toISOString()).toBe("2026-11-25T15:00:00.000Z"));
  it("3 days after a proposal", () =>
    expect(suggestNextFollowUp("proposal_sent", now, f).toISOString()).toBe("2026-11-26T15:00:00.000Z"));
  it("1 day before a consult", () =>
    expect(suggestNextFollowUp("consult_scheduled", now, f, new Date("2026-12-01T18:00:00Z")).toISOString()).toBe("2026-11-30T18:00:00.000Z"));
  it("consult tomorrow: follow up now-ish rather than in the past", () =>
    expect(suggestNextFollowUp("consult_scheduled", now, f, new Date("2026-11-23T20:00:00Z")).getTime()).toBeGreaterThanOrEqual(now.getTime()));
});
