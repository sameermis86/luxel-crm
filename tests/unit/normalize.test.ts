import { describe, it, expect } from "vitest";
import {
  normalizeEmail, isValidEmail, normalizePhone, splitFullName, parseMoney, parseBudgetRange, parseDateLoose,
  normalizeCity,
} from "@/lib/normalize";

describe("normalizeEmail", () => {
  it("lowercases and trims", () => expect(normalizeEmail("  Sofia.Rossi@Example.COM ")).toBe("sofia.rossi@example.com"));
  it("strips gmail dots and +tags", () => {
    expect(normalizeEmail("Sofia.Rossi+wedding@gmail.com")).toBe("sofiarossi@gmail.com");
    expect(normalizeEmail("s.o.f.i.a@googlemail.com")).toBe("sofia@gmail.com");
  });
  it("strips +tags but keeps dots on other domains", () =>
    expect(normalizeEmail("first.last+crm@luxeldecor.com")).toBe("first.last@luxeldecor.com"));
  it("returns null for empty / invalid", () => {
    expect(normalizeEmail("")).toBeNull();
    expect(normalizeEmail(null)).toBeNull();
    expect(normalizeEmail("not-an-email")).toBeNull();
  });
  it("validates", () => {
    expect(isValidEmail("a@b.co")).toBe(true);
    expect(isValidEmail("a@b")).toBe(false);
  });
});

describe("normalizePhone", () => {
  it("formats Canadian numbers to E.164", () => {
    expect(normalizePhone("(905) 555-0123")).toBe("+19055550123");
    expect(normalizePhone("416.555.0199")).toBe("+14165550199");
    expect(normalizePhone("1-647-555-0100")).toBe("+16475550100");
  });
  it("keeps international numbers", () => expect(normalizePhone("+44 20 7946 0958")).toBe("+442079460958"));
  it("returns null for junk", () => {
    expect(normalizePhone("123")).toBeNull();
    expect(normalizePhone("")).toBeNull();
  });
});

describe("splitFullName", () => {
  it("splits first / last", () => expect(splitFullName("Sofia Rossi")).toEqual({ firstName: "Sofia", lastName: "Rossi" }));
  it("handles multi-part last names", () =>
    expect(splitFullName("Maria de la Cruz")).toEqual({ firstName: "Maria", lastName: "de la Cruz" }));
  it("handles 'Last, First'", () => expect(splitFullName("Rossi, Sofia")).toEqual({ firstName: "Sofia", lastName: "Rossi" }));
  it("handles couples", () =>
    expect(splitFullName("Sofia Rossi & Marco Bianchi")).toEqual({ firstName: "Sofia", lastName: "Rossi", partnerName: "Marco Bianchi" }));
  it("handles single names", () => expect(splitFullName("Sofia")).toEqual({ firstName: "Sofia", lastName: null }));
});

describe("money parsing", () => {
  it("parses common formats", () => {
    expect(parseMoney("$7,500")).toBe(7500);
    expect(parseMoney("7.5k")).toBe(7500);
    expect(parseMoney("CAD 12000.50")).toBe(12000.5);
    expect(parseMoney("")).toBeNull();
    expect(parseMoney("ask me")).toBeNull();
  });
  it("parses ranges", () => {
    expect(parseBudgetRange("$5,000 - $8,000")).toEqual({ min: 5000, max: 8000 });
    expect(parseBudgetRange("5k–8k")).toEqual({ min: 5000, max: 8000 });
    expect(parseBudgetRange("Under $3,000")).toEqual({ min: null, max: 3000 });
    expect(parseBudgetRange("$10,000+")).toEqual({ min: 10000, max: null });
    expect(parseBudgetRange("6000")).toEqual({ min: 6000, max: 6000 });
  });
});

describe("parseDateLoose", () => {
  it("parses ISO and common formats", () => {
    expect(parseDateLoose("2027-06-12")).toBe("2027-06-12");
    expect(parseDateLoose("06/12/2027")).toBe("2027-06-12");
    expect(parseDateLoose("June 12, 2027")).toBe("2027-06-12");
    expect(parseDateLoose("12 Jun 2027")).toBe("2027-06-12");
    expect(parseDateLoose("2027-06-12T14:00:00Z")).toBe("2027-06-12");
    expect(parseDateLoose("sometime next year")).toBeNull();
  });
});

describe("normalizeCity", () => {
  it("strips province and punctuation", () => {
    expect(normalizeCity("Woodbridge, ON")).toBe("woodbridge");
    expect(normalizeCity("St Catharines, Ontario")).toBe("st catharines");
    expect(normalizeCity("Niagara-on-the-Lake")).toBe("niagara on the lake");
  });
});
