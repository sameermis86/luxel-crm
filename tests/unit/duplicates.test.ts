import { describe, it, expect } from "vitest";
import { trigramSimilarity, classifyMatch } from "@/lib/duplicates";

let n = 0;
const lead = (o: any) => ({
  id: o.id ?? `l${++n}`, emailNormalized: null, phoneE164: null, firstName: null, lastName: null, partnerName: null, eventDate: null, ...o,
});

describe("trigramSimilarity (pg_trgm compatible)", () => {
  it("identical = 1, disjoint = 0", () => {
    expect(trigramSimilarity("sofia rossi", "sofia rossi")).toBe(1);
    expect(trigramSimilarity("abc", "xyz")).toBe(0);
  });
  it("matches pg_trgm values", () => {
    // values from: select similarity('sofia rossi','sophia rossi') etc.
    expect(trigramSimilarity("sofia rossi", "sophia rossi")).toBeCloseTo(0.5625, 3);
    expect(trigramSimilarity("katherine smith", "katharine smith")).toBeCloseTo(0.6842, 3);
  });
});

describe("classifyMatch", () => {
  it("exact email = high", () => {
    const r = classifyMatch(lead({ emailNormalized: "a@b.com" }), lead({ emailNormalized: "a@b.com" }));
    expect(r).toMatchObject({ confidence: "high", reasons: ["same_email"] });
  });
  it("exact phone = high", () => {
    expect(classifyMatch(lead({ phoneE164: "+1416" }), lead({ phoneE164: "+1416" }))?.confidence).toBe("high");
  });
  it("same last name + same event date = medium", () => {
    const r = classifyMatch(
      lead({ firstName: "Sofia", lastName: "Rossi", eventDate: "2027-06-12" }),
      lead({ firstName: "Marco", lastName: "rossi", eventDate: "2027-06-12" }),
    );
    expect(r).toMatchObject({ confidence: "medium", reasons: ["same_last_name_and_date"] });
  });
  it("partner name crosses over", () => {
    const r = classifyMatch(
      lead({ firstName: "Sofia", lastName: "Rossi", partnerName: "Marco Bianchi", eventDate: "2027-06-12" }),
      lead({ firstName: "Marco", lastName: "Bianchi", eventDate: "2027-06-12" }),
    );
    expect(r?.reasons).toContain("partner_name_and_date");
  });
  it("fuzzy full name >= 0.8 + same event month = medium", () => {
    const r = classifyMatch(
      lead({ firstName: "Alexandra", lastName: "Konstantinou", eventDate: "2027-06-05" }),
      lead({ firstName: "Alexandra", lastName: "Konstantinu", eventDate: "2027-06-26" }),
    );
    expect(r).toMatchObject({ confidence: "medium" });
    expect(r?.reasons).toContain("similar_name_and_month");
  });
  it("similar name in a different month is not a match", () => {
    expect(
      classifyMatch(
        lead({ firstName: "Alexandra", lastName: "Konstantinou", eventDate: "2027-06-05" }),
        lead({ firstName: "Alexandra", lastName: "Konstantinou", eventDate: "2027-09-05" }),
      ),
    ).toBeNull();
  });
  it("same last name, different dates = no match", () => {
    expect(
      classifyMatch(lead({ lastName: "Patel", eventDate: "2027-06-12" }), lead({ lastName: "Patel", eventDate: "2027-07-12" })),
    ).toBeNull();
  });
  it("never matches a lead with itself", () => {
    expect(classifyMatch(lead({ id: "1", emailNormalized: "a@b.com" }), lead({ id: "1", emailNormalized: "a@b.com" }))).toBeNull();
  });
});
